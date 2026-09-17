/** Tipos del dominio Magento. Módulo sin runtime: sólo contratos entre capas. */

export interface MagentoCredentials {
  readonly username: string
  readonly password: string
}

export interface MagentoPaths {
  /** Formulario de login, de donde salen el form_key y su cookie. */
  readonly loginPage: string
  /** Endpoint que procesa el POST del formulario. */
  readonly loginPost: string
  /** Página privada que sirve para comprobar si la sesión sigue viva. */
  readonly accountPage: string
}
