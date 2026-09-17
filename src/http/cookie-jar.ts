/**
 * Node no mantiene cookies entre llamadas a `fetch`, así que las guardamos nosotros.
 * Implementa el subconjunto de RFC 6265 que necesita una sesión de Magento:
 * ámbito por dominio y path, caducidad y flag Secure.
 */

export interface CookieJar {
  /** Valor para la cabecera `Cookie` de esa URL, o `null` si no aplica ninguna. */
  headerFor(url: URL): string | null
  /** Incorpora las cabeceras `Set-Cookie` de una respuesta. */
  absorb(setCookieHeaders: readonly string[], requestUrl: URL): void
  /** Valor de una cookie concreta (la de path más específico si hay varias). */
  valueOf(name: string): string | null
  /** Nombres almacenados. Pensado para logs: nunca expone valores. */
  names(): readonly string[]
  clear(): void
}

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, StoredCookie>()

  const keyOf = (cookie: StoredCookie): string => `${cookie.domain}|${cookie.path}|${cookie.name}`

  const dropExpired = (now: number): void => {
    for (const [key, cookie] of cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) cookies.delete(key)
    }
  }

  return {
    headerFor(url) {
      const now = Date.now()
      dropExpired(now)
      const applicable = [...cookies.values()]
        .filter((cookie) => domainMatches(url.hostname, cookie.domain))
        .filter((cookie) => pathMatches(url.pathname, cookie.path))
        .filter((cookie) => !cookie.secure || url.protocol === 'https:')
        .sort((a, b) => b.path.length - a.path.length)

      if (applicable.length === 0) return null
      return applicable.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
    },

    absorb(setCookieHeaders, requestUrl) {
      for (const raw of setCookieHeaders) {
        const cookie = parseSetCookie(raw, requestUrl)
        if (cookie === null) continue
        // Un servidor borra una cookie reenviándola ya caducada.
        if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
          cookies.delete(keyOf(cookie))
          continue
        }
        cookies.set(keyOf(cookie), cookie)
      }
    },

    valueOf(name) {
      dropExpired(Date.now())
      const matches = [...cookies.values()]
        .filter((cookie) => cookie.name === name)
        .sort((a, b) => b.path.length - a.path.length)
      return matches[0]?.value ?? null
    },

    names() {
      dropExpired(Date.now())
      return [...new Set([...cookies.values()].map((cookie) => cookie.name))].sort()
    },

    clear() {
      cookies.clear()
    },
  }
}

interface StoredCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly secure: boolean
  readonly expiresAt: number | null
}

function parseSetCookie(raw: string, requestUrl: URL): StoredCookie | null {
  const segments = raw.split(';')
  const pair = segments[0]
  if (pair === undefined) return null

  const separator = pair.indexOf('=')
  if (separator <= 0) return null

  const name = pair.slice(0, separator).trim()
  const value = pair.slice(separator + 1).trim()
  if (name.length === 0) return null

  let domain = requestUrl.hostname.toLowerCase()
  let path = defaultPath(requestUrl)
  let secure = false
  let expiresAt: number | null = null
  let maxAgeSeen = false

  for (const segment of segments.slice(1)) {
    const separatorIndex = segment.indexOf('=')
    const attribute = (separatorIndex === -1 ? segment : segment.slice(0, separatorIndex)).trim().toLowerCase()
    const attributeValue = separatorIndex === -1 ? '' : segment.slice(separatorIndex + 1).trim()

    switch (attribute) {
      case 'domain':
        if (attributeValue.length > 0) domain = attributeValue.replace(/^\./, '').toLowerCase()
        break
      case 'path':
        if (attributeValue.startsWith('/')) path = attributeValue
        break
      case 'secure':
        secure = true
        break
      case 'max-age': {
        const seconds = Number(attributeValue)
        if (Number.isFinite(seconds)) {
          expiresAt = Date.now() + seconds * 1000
          maxAgeSeen = true
        }
        break
      }
      case 'expires': {
        const timestamp = Date.parse(attributeValue)
        // Max-Age tiene prioridad sobre Expires llegue en el orden que llegue.
        if (!Number.isNaN(timestamp) && !maxAgeSeen) expiresAt = timestamp
        break
      }
      default:
        break
    }
  }

  return { name, value, domain, path, secure, expiresAt }
}

function defaultPath(url: URL): string {
  const pathname = url.pathname
  if (!pathname.startsWith('/')) return '/'
  const lastSlash = pathname.lastIndexOf('/')
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash)
}

function domainMatches(host: string, cookieDomain: string): boolean {
  const target = host.toLowerCase()
  return target === cookieDomain || target.endsWith(`.${cookieDomain}`)
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/'
}
