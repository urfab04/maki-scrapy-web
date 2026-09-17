export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export interface Logger {
  debug(message: string, meta?: Readonly<Record<string, unknown>>): void
  info(message: string, meta?: Readonly<Record<string, unknown>>): void
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void
  error(message: string, meta?: Readonly<Record<string, unknown>>): void
  child(scope: string): Logger
}

export function createLogger(options: { readonly level: LogLevel; readonly scope?: string }): Logger {
  const threshold = options.level === 'silent' ? Number.POSITIVE_INFINITY : LEVEL_WEIGHT[options.level]
  const scope = options.scope ?? 'app'

  const emit = (level: Exclude<LogLevel, 'silent'>, message: string, meta?: Readonly<Record<string, unknown>>): void => {
    if (LEVEL_WEIGHT[level] < threshold) return
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`
    const details = meta === undefined ? '' : ` ${JSON.stringify(sanitise(meta, 0))}`
    // Todo el log va a stderr para no contaminar la salida útil de los scripts.
    process.stderr.write(`${line}${details}\n`)
  }

  return {
    debug: (message, meta) => { emit('debug', message, meta) },
    info: (message, meta) => { emit('info', message, meta) },
    warn: (message, meta) => { emit('warn', message, meta) },
    error: (message, meta) => { emit('error', message, meta) },
    child: (childScope) => createLogger({ level: options.level, scope: `${scope}:${childScope}` }),
  }
}

const LEVEL_WEIGHT: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/**
 * La redacción vive aquí y no en cada punto de llamada: así ningún módulo puede
 * filtrar una credencial por descuido al añadir un campo nuevo al log.
 */
const SENSITIVE_KEY = /pass|secret|token|cookie|auth|credential|form_?key|session|user(name)?|email/i

/** Los campos `...Names` sólo contienen nombres de cookies, no valores: son seguros. */
const NAMES_ONLY_KEY = /names$/i

const MAX_DEPTH = 3

function sanitise(meta: Readonly<Record<string, unknown>>, depth: number): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(key) && !NAMES_ONLY_KEY.test(key)) {
      output[key] = mask(value)
      continue
    }
    if (isPlainObject(value) && depth < MAX_DEPTH) {
      output[key] = sanitise(value, depth + 1)
      continue
    }
    output[key] = isPlainObject(value) ? '[object]' : value
  }
  return output
}

/** Deja rastro suficiente para depurar (¿ha cambiado el valor?) sin revelar el secreto. */
function mask(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return `${value.slice(0, 3)}…[${String(value.length)} chars]`
  }
  return '[redacted]'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
