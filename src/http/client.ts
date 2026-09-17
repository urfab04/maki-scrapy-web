import { NetworkError, TimeoutError } from '../errors.js'
import type { Logger } from '../logging/logger.js'
import { createCookieJar, type CookieJar } from './cookie-jar.js'
import { createRateLimiter } from './rate-limiter.js'

/**
 * Cliente HTTP con estado de cookies. No sabe nada de Magento: sólo resuelve URLs
 * contra una base, adjunta cookies y cabeceras, limita el ritmo, aplica timeouts
 * y reintenta lo que es reintentable.
 */

export interface HttpRequestOptions {
  readonly method?: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  /** Si se indica, el cuerpo se envía como application/x-www-form-urlencoded. */
  readonly form?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly maxRetries?: number
}

export interface HttpResponse {
  readonly status: number
  /** `fetch` no lanza en 4xx/5xx: quien llama decide qué hacer mirando esto. */
  readonly ok: boolean
  readonly url: string
  /** Cabecera Location de un 3xx, o `null`. */
  readonly location: string | null
  readonly headers: Headers
  readonly body: string
}

export interface HttpClient {
  request(target: string, options?: HttpRequestOptions): Promise<HttpResponse>
  resolve(target: string): URL
  readonly jar: CookieJar
}

export interface HttpClientOptions {
  readonly baseUrl: string
  readonly userAgent: string
  readonly acceptLanguage: string
  readonly timeoutMs: number
  readonly maxRetries: number
  readonly retryBaseDelayMs: number
  readonly minDelayMs: number
  readonly maxConcurrency: number
}

export function createHttpClient(dependencies: {
  readonly options: HttpClientOptions
  readonly logger: Logger
  readonly jar?: CookieJar
}): HttpClient {
  const { options } = dependencies
  const logger = dependencies.logger.child('http')
  const jar = dependencies.jar ?? createCookieJar()
  const limiter = createRateLimiter({
    minDelayMs: options.minDelayMs,
    maxConcurrency: options.maxConcurrency,
  })

  const resolve = (target: string): URL => new URL(target, options.baseUrl)

  const send = async (url: URL, requestOptions: HttpRequestOptions): Promise<HttpResponse> => {
    const method = requestOptions.method ?? 'GET'
    const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs
    const body = requestOptions.form === undefined ? null : new URLSearchParams(requestOptions.form).toString()

    const headers: Record<string, string> = {
      'user-agent': options.userAgent,
      'accept-language': options.acceptLanguage,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
    }
    if (body !== null) headers['content-type'] = 'application/x-www-form-urlencoded'
    for (const [name, value] of Object.entries(requestOptions.headers ?? {})) {
      headers[name.toLowerCase()] = value
    }
    const cookieHeader = jar.headerFor(url)
    if (cookieHeader !== null) headers['cookie'] = cookieHeader

    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)

    try {
      const response = await fetch(url, {
        method,
        headers,
        // Manual siempre: siguiendo los redirects automáticamente se pierden las
        // cabeceras Set-Cookie intermedias, que es justo donde viaja la sesión.
        redirect: 'manual',
        signal: controller.signal,
        ...(body === null ? {} : { body }),
      })

      jar.absorb(response.headers.getSetCookie(), url)
      const text = await response.text()

      logger.debug('respuesta', {
        method,
        path: url.pathname,
        status: response.status,
        location: response.headers.get('location'),
        bytes: text.length,
        jarNames: jar.names(),
      })

      return {
        status: response.status,
        ok: response.ok,
        url: url.toString(),
        location: response.headers.get('location'),
        headers: response.headers,
        body: text,
      }
    } catch (error) {
      if (controller.signal.aborted) throw new TimeoutError(url.toString(), timeoutMs)
      throw new NetworkError(`Fallo de red contra ${url.toString()}`, url.toString(), { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    resolve,
    jar,

    async request(target, requestOptions = {}) {
      const url = resolve(target)
      const maxRetries = requestOptions.maxRetries ?? options.maxRetries

      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await limiter.run(() => send(url, requestOptions))
          if (!isTransientStatus(response.status) || attempt >= maxRetries) return response
          logger.warn('estado transitorio, reintentando', {
            path: url.pathname,
            status: response.status,
            attempt: attempt + 1,
          })
        } catch (error) {
          if (!(error instanceof NetworkError) || attempt >= maxRetries) throw error
          logger.warn('fallo de red, reintentando', {
            path: url.pathname,
            attempt: attempt + 1,
            reason: error.name,
          })
        }
        await sleep(backoffMs(options.retryBaseDelayMs, attempt))
      }
    },
  }
}

/**
 * 401 y 403 quedan fuera a propósito: son decisiones deliberadas del servidor
 * (credenciales o WAF) y repetirlas sólo empeora el bloqueo.
 */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status)
}

function backoffMs(baseDelayMs: number, attempt: number): number {
  const exponential = baseDelayMs * 2 ** attempt
  return Math.round(exponential * (1 + Math.random() * 0.25))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
