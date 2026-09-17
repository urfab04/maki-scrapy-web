import { z } from 'zod'
import { ConfigError } from './errors.js'
import type { LogLevel } from './logging/logger.js'
import type { HttpClientOptions } from './http/client.js'
import type { MagentoCredentials, MagentoPaths } from './magento/types.js'

/**
 * Único punto donde se lee el entorno. Valida al arrancar y falla rápido:
 * ningún otro módulo toca `process.env`.
 */

export interface AppConfig {
  readonly logLevel: LogLevel
  readonly http: HttpClientOptions
  readonly magento: {
    readonly credentials: MagentoCredentials
    readonly paths: MagentoPaths
  }
  readonly session: {
    readonly maxReauthAttempts: number
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  loadDotEnvIfPresent()

  const result = EnvSchema.safeParse(env)
  if (!result.success) {
    // Sólo ruta y motivo: el valor recibido podría ser una credencial.
    const detail = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n')
    throw new ConfigError(`Configuración inválida:\n${detail}`)
  }

  const parsed = result.data
  return {
    logLevel: parsed.LOG_LEVEL,
    http: {
      baseUrl: parsed.MAGENTO_BASE_URL,
      userAgent: parsed.HTTP_USER_AGENT,
      acceptLanguage: parsed.HTTP_ACCEPT_LANGUAGE,
      timeoutMs: parsed.HTTP_TIMEOUT_MS,
      maxRetries: parsed.HTTP_MAX_RETRIES,
      retryBaseDelayMs: parsed.HTTP_RETRY_BASE_DELAY_MS,
      minDelayMs: parsed.HTTP_MIN_DELAY_MS,
      maxConcurrency: parsed.HTTP_MAX_CONCURRENCY,
    },
    magento: {
      credentials: {
        username: parsed.MAGENTO_USERNAME,
        password: parsed.MAGENTO_PASSWORD,
      },
      paths: {
        loginPage: parsed.MAGENTO_LOGIN_PATH,
        loginPost: parsed.MAGENTO_LOGIN_POST_PATH,
        accountPage: parsed.MAGENTO_ACCOUNT_PATH,
      },
    },
    session: {
      maxReauthAttempts: parsed.SESSION_MAX_REAUTH_ATTEMPTS,
    },
  }
}

const absoluteUrl = z
  .string()
  .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), {
    message: 'debe ser una URL http(s) absoluta',
  })

const path = z.string().startsWith('/', 'debe empezar por /')

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback)

const EnvSchema = z.object({
  MAGENTO_BASE_URL: absoluteUrl,
  MAGENTO_USERNAME: z.string().min(1, 'obligatorio'),
  MAGENTO_PASSWORD: z.string().min(1, 'obligatorio'),

  MAGENTO_LOGIN_PATH: path.default('/customer/account/login/'),
  MAGENTO_LOGIN_POST_PATH: path.default('/customer/account/loginPost/'),
  MAGENTO_ACCOUNT_PATH: path.default('/customer/account/'),

  HTTP_USER_AGENT: z
    .string()
    .min(1)
    .default(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ),
  HTTP_ACCEPT_LANGUAGE: z.string().min(1).default('es-ES,es;q=0.9,en;q=0.8'),
  HTTP_TIMEOUT_MS: positiveInt(20_000),
  HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  HTTP_RETRY_BASE_DELAY_MS: positiveInt(600),
  HTTP_MIN_DELAY_MS: z.coerce.number().int().min(0).default(1_200),
  HTTP_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),

  SESSION_MAX_REAUTH_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(1),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
})

/** Node carga el .env sin dependencias desde 20.12; si no existe, mandan las variables del entorno. */
function loadDotEnvIfPresent(): void {
  const loader = (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile
  if (typeof loader !== 'function') return
  try {
    loader.call(process)
  } catch {
    // Sin fichero .env: no es un error, las variables pueden venir del entorno real.
  }
}
