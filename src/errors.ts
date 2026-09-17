/**
 * Errores del dominio. Cada capa lanza el suyo para que el `catch` pueda decidir
 * sin inspeccionar mensajes de texto.
 */

export abstract class ScraperError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = this.constructor.name
  }
}

/** Falta configuración o es inválida. Siempre fatal: se lanza al arrancar. */
export class ConfigError extends ScraperError {}

/** Respuesta recibida pero con un estado que la capa llamante considera inaceptable. */
export class HttpError extends ScraperError {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(`${message} (HTTP ${String(status)} en ${url})`, options)
  }
}

/** Fallo de transporte: DNS, conexión rechazada, socket cortado. Reintentable. */
export class NetworkError extends ScraperError {
  constructor(
    message: string,
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/** La petición superó el tiempo máximo y fue abortada. Reintentable. */
export class TimeoutError extends NetworkError {
  constructor(url: string, readonly timeoutMs: number) {
    super(`La petición a ${url} superó los ${String(timeoutMs)} ms`, url)
  }
}

/** No se encontró el form_key en el HTML: la página no es la esperada o cambió el markup. */
export class FormKeyError extends ScraperError {}

/** Credenciales rechazadas, CAPTCHA, cuenta bloqueada. Nunca reintentable. */
export class AuthenticationError extends ScraperError {}

/** Una petición que debía ir autenticada rebotó al login. */
export class SessionExpiredError extends ScraperError {
  constructor(message: string, readonly url: string) {
    super(message)
  }
}
