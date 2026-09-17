import * as cheerio from 'cheerio'
import type { HttpResponse } from '../http/client.js'

/**
 * Decide si una respuesta corresponde a una sesión autenticada. Lo usan tanto la
 * verificación del login como la detección de caducidad, para que ambas apliquen
 * exactamente el mismo criterio.
 */
export function isSessionAlive(response: HttpResponse, loginPath: string): boolean {
  if (response.location !== null && pointsToLogin(response.location, loginPath)) return false
  if (response.status === 200 && containsLoginForm(response.body)) return false
  return true
}

function pointsToLogin(location: string, loginPath: string): boolean {
  return normalise(pathOf(location)) === normalise(loginPath)
}

function pathOf(location: string): string {
  try {
    // La base sólo sirve para admitir Location relativos; el host da igual aquí.
    return new URL(location, 'https://base.invalid').pathname
  } catch {
    return location
  }
}

function normalise(path: string): string {
  return path.replace(/\/+$/, '').toLowerCase()
}

/**
 * Luma renderiza un formulario de login oculto en `#authenticationPopup` en páginas
 * en las que sí estamos autenticados, así que sólo cuenta el formulario principal.
 */
function containsLoginForm(html: string): boolean {
  const $ = cheerio.load(html)
  return $('form')
    .toArray()
    .some((element) => {
      const form = $(element)
      const action = form.attr('action') ?? ''
      if (!action.includes('/customer/account/loginPost')) return false
      return form.closest('#authenticationPopup').length === 0
    })
}
