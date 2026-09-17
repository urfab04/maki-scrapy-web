import * as cheerio from 'cheerio'
import { loadConfig } from '../config.js'
import {
  AuthenticationError,
  ConfigError,
  FormKeyError,
  HttpError,
  NetworkError,
  SessionExpiredError,
} from '../errors.js'
import { createHttpClient } from '../http/client.js'
import { createLogger } from '../logging/logger.js'
import { createMagentoSession } from '../magento/session.js'

/** Hace login, pide dos páginas privadas y confirma que la misma sesión sigue viva. */
async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger({ level: config.logLevel, scope: 'check' })
  const http = createHttpClient({ options: config.http, logger })
  const session = createMagentoSession({
    http,
    logger,
    credentials: config.magento.credentials,
    paths: config.magento.paths,
    maxReauthAttempts: config.session.maxReauthAttempts,
  })

  await session.ensureAuthenticated()

  const account = await session.request(config.magento.paths.accountPage)
  if (!account.ok) {
    throw new HttpError('La página de cuenta no respondió 200', account.status, account.url)
  }
  const $ = cheerio.load(account.body)
  const pageTitle = $('.page-title span, h1').first().text().trim()

  // Segunda petición con la misma sesión: si se reutiliza, no vuelve a loguear.
  const customerSection = await session.request('/customer/section/load/?sections=customer')
  const customerName = firstNameFromSection(customerSection.body)

  console.log('Sesión autenticada ✔')
  console.log(`  base            : ${config.http.baseUrl}`)
  console.log(`  página privada  : ${account.url} (${String(account.status)})`)
  console.log(`  título          : ${pageTitle.length > 0 ? pageTitle : '(sin título detectado)'}`)
  console.log(`  cliente         : ${customerName ?? '(sección customer no disponible)'}`)
  console.log(`  cookies en jar  : ${http.jar.names().join(', ')}`)
}

/** Señal secundaria: Magento sólo rellena esta sección para clientes autenticados. */
function firstNameFromSection(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return null
    const customer: unknown = (parsed as Record<string, unknown>)['customer']
    if (typeof customer !== 'object' || customer === null) return null
    const firstname: unknown = (customer as Record<string, unknown>)['firstname']
    return typeof firstname === 'string' && firstname.length > 0 ? firstname : null
  } catch {
    return null
  }
}

try {
  await main()
} catch (error) {
  process.exitCode = 1
  if (error instanceof ConfigError) {
    console.error(`[config] ${error.message}`)
  } else if (error instanceof AuthenticationError) {
    console.error(`[auth] ${error.message}`)
  } else if (error instanceof FormKeyError) {
    console.error(`[form-key] ${error.message}`)
  } else if (error instanceof SessionExpiredError) {
    console.error(`[session] ${error.message}`)
  } else if (error instanceof HttpError) {
    console.error(`[http ${String(error.status)}] ${error.message}`)
  } else if (error instanceof NetworkError) {
    console.error(`[red] ${error.message}`)
  } else {
    console.error('[desconocido]', error)
  }
}
