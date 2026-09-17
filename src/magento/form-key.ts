import * as cheerio from 'cheerio'
import { FormKeyError } from '../errors.js'

/** Extrae el form_key del input oculto del formulario de Magento. */
export function extractFormKey(html: string): string {
  const $ = cheerio.load(html)
  const value = $('input[name="form_key"]').first().attr('value')?.trim()

  if (value === undefined || value.length === 0) {
    throw new FormKeyError(
      'No hay input form_key en el HTML: la respuesta no es el formulario de login esperado ' +
        '(¿WAF, prefijo de store view incorrecto o markup distinto?)',
    )
  }
  return value
}
