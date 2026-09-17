import { SessionExpiredError } from '../errors.js'
import type { HttpClient, HttpRequestOptions, HttpResponse } from '../http/client.js'
import type { Logger } from '../logging/logger.js'
import { authenticate } from './auth.js'
import { isSessionAlive } from './session-state.js'
import type { MagentoCredentials, MagentoPaths } from './types.js'

/**
 * Sesión autenticada reutilizable: hace login perezosamente, detecta cuando la
 * tienda nos devuelve al formulario y reautentica un número acotado de veces.
 */

export interface MagentoSession {
  /** Petición que garantiza estar autenticada, con reintento tras reautenticar. */
  request(target: string, options?: HttpRequestOptions): Promise<HttpResponse>
  /** Fuerza tener sesión válida antes de empezar a trabajar. */
  ensureAuthenticated(): Promise<void>
}

export function createMagentoSession(dependencies: {
  readonly http: HttpClient
  readonly logger: Logger
  readonly credentials: MagentoCredentials
  readonly paths: MagentoPaths
  readonly maxReauthAttempts: number
}): MagentoSession {
  const { http, credentials, paths, maxReauthAttempts } = dependencies
  const logger = dependencies.logger.child('session')

  let loginInFlight: Promise<void> | null = null
  let generation = 0

  /**
   * `generation` evita la estampida: si varias peticiones concurrentes caducan a la
   * vez, sólo la primera dispara el login y el resto reutiliza ese resultado.
   */
  const login = async (observedGeneration: number): Promise<void> => {
    if (generation > observedGeneration) return
    loginInFlight ??= authenticate({ http, logger, credentials, paths })
      .then(() => {
        generation += 1
      })
      .finally(() => {
        loginInFlight = null
      })
    await loginInFlight
  }

  const ensureAuthenticated = async (): Promise<void> => {
    if (generation === 0) await login(0)
  }

  return {
    ensureAuthenticated,

    async request(target, options) {
      await ensureAuthenticated()

      for (let attempt = 0; ; attempt += 1) {
        const observedGeneration = generation
        const response = await http.request(target, options)
        if (isSessionAlive(response, paths.loginPage)) return response

        if (attempt >= maxReauthAttempts) {
          throw new SessionExpiredError(
            `La sesión sigue caducando tras ${String(attempt)} reautenticación(es)`,
            response.url,
          )
        }
        logger.warn('sesión caducada, reautenticando', { path: target, attempt: attempt + 1 })
        await login(observedGeneration)
      }
    },
  }
}
