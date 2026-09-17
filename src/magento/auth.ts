import * as cheerio from 'cheerio'
import { AuthenticationError, HttpError } from '../errors.js'
import type { HttpClient } from '../http/client.js'
import type { Logger } from '../logging/logger.js'
import { extractFormKey } from './form-key.js'
import { isSessionAlive } from './session-state.js'
import type { MagentoCredentials, MagentoPaths } from './types.js'

/**
 * Ejecuta el flujo de login de Magento 2 frontend y no vuelve hasta haber
 * comprobado, contra una página privada, que la sesión existe de verdad.
 * Al terminar, las cookies de sesión están en el jar del cliente HTTP.
 */
export async function authenticate(dependencies: {
  readonly http: HttpClient
  readonly logger: Logger
  readonly credentials: MagentoCredentials
  readonly paths: MagentoPaths
}): Promise<void> {
  const { http, credentials, paths } = dependencies
  const logger = dependencies.logger.child('auth')

  const loginPage = await http.request(paths.loginPage)
  if (!loginPage.ok) {
    throw new HttpError('No se pudo cargar el formulario de login', loginPage.status, loginPage.url)
  }

  const formKey = resolveFormKey(http, loginPage.body, logger)

  const loginPageUrl = http.resolve(paths.loginPage).toString()
  const response = await http.request(paths.loginPost, {
    method: 'POST',
    form: {
      'login[username]': credentials.username,
      'login[password]': credentials.password,
      form_key: formKey,
    },
    headers: {
      referer: loginPageUrl,
      origin: http.resolve('/').origin,
    },
    // Unas credenciales rechazadas no mejoran repitiendo el POST.
    maxRetries: 0,
  })

  if (response.status >= 500) {
    throw new HttpError('La tienda falló al procesar el login', response.status, response.url)
  }

  if (response.location === null) {
    // Magento siempre redirige tras el loginPost; un 200 aquí es el formulario
    // re-renderizado con el mensaje de error (o una pantalla de CAPTCHA).
    throw new AuthenticationError(
      `Login rechazado sin redirect: ${errorMessageFrom(response.body) ?? 'sin mensaje en la página'}`,
    )
  }

  // Un 302 no prueba nada: el login fallido también redirige, de vuelta al formulario.
  if (!isSessionAlive(response, paths.loginPage)) {
    throw new AuthenticationError(`Login rechazado: ${await reasonFromLoginPage(http, paths)}`)
  }

  const accountPage = await http.request(paths.accountPage)
  if (!isSessionAlive(accountPage, paths.loginPage)) {
    throw new AuthenticationError(
      'El POST redirigió como si hubiera funcionado, pero la página privada rebota al login ' +
        '(sesión no persistida: revisa cookies, dominio o prefijo de store view)',
    )
  }
  if (!accountPage.ok) {
    throw new HttpError('La página privada no respondió correctamente', accountPage.status, accountPage.url)
  }

  logger.info('sesión autenticada', { cookieNames: http.jar.names() })
}

/**
 * Magento valida el form_key comparando el campo del POST con la cookie homónima.
 * Si el HTML llega de caché (FPC o CDN) el input puede ir desfasado respecto a la
 * cookie que acabamos de recibir, así que manda la cookie cuando existe.
 */
function resolveFormKey(http: HttpClient, html: string, logger: Logger): string {
  const fromHtml = extractFormKey(html)
  const fromCookie = http.jar.valueOf('form_key')

  if (fromCookie === null) {
    logger.warn('no llegó cookie form_key; el POST puede ser rechazado por CSRF')
    return fromHtml
  }
  if (fromCookie !== fromHtml) {
    logger.warn('form_key de la cookie y del HTML no coinciden; se usa el de la cookie')
  }
  return fromCookie
}

/** Tras un login fallido el mensaje viaja en la sesión y se pinta al recargar el formulario. */
async function reasonFromLoginPage(http: HttpClient, paths: MagentoPaths): Promise<string> {
  const page = await http.request(paths.loginPage)
  return errorMessageFrom(page.body) ?? 'la tienda no dio motivo (¿CAPTCHA o cuenta pendiente de aprobación?)'
}

function errorMessageFrom(html: string): string | null {
  const $ = cheerio.load(html)
  const message = $('[data-ui-id="message-error"], .message-error, .message.error').first().text().trim()
  return message.length === 0 ? null : message.replace(/\s+/g, ' ')
}
