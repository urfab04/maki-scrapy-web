# Handoff — scraper Magento 2 (www.makito.eu): capa de sesión

Documento para el agente/IA que continúe este trabajo. Contiene el estado real
(qué está verificado y qué no), el bloqueo abierto y las tareas pendientes en orden.

---

## 1. Objetivo

Base de un scraper en TypeScript para una tienda Magento 2 con tema Luma
(`https://www.makito.eu`). El foco **no** es todavía extraer datos, sino dejar
montada una **capa de sesión autenticada reutilizable**: login, cookie jar propio,
detección de sesión caducada y reautenticación automática.

## 2. Estado actual

### Hecho y verificado
- Estructura de módulos completa en `src/` (ver mapa en §7).
- `pnpm typecheck` (`tsc --noEmit`) pasa **sin errores** con `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y `verbatimModuleSyntax`.
- Dependencias instaladas: cheerio 1.2.0, zod 4.6.5, tsx, typescript, @types/node.
- Probado en aislamiento y con resultado correcto:
  - cookie jar: parseo de `Set-Cookie`, ámbito por dominio/path, borrado por
    cookie caducada, `Max-Age` con prioridad sobre `Expires`;
  - `extractFormKey` sobre HTML de formulario;
  - `isSessionAlive`: 302 al login → muerta; 302 a la cuenta → viva; formulario de
    login principal → muerta; formulario dentro de `#authenticationPopup` de Luma
    → viva (falso positivo evitado).

### Hecho pero SIN verificar
- **El flujo de login completo no se ha ejecutado nunca**, ni contra la tienda real
  ni contra el servidor falso. `test/fake-magento.mjs` existe y arranca, pero la
  prueba de punta a punta quedó sin lanzar. Es la tarea 3.
- `authenticate()`, `createMagentoSession()` y `src/scripts/check-session.ts`
  sólo tienen garantía de tipos, no de comportamiento.

### Bloqueo abierto
`www.makito.eu` está detrás de **Akamai** y devolvió **403 `Access Denied`
(`errors.edgesuite.net`) a todas las peticiones** desde la máquina de desarrollo
usada hasta ahora: home, `/customer/account/login/` y hasta `/robots.txt`, con
cabeceras de navegador completas (UA de Chrome, `Accept-Language`, `Sec-Fetch-*`).
Otras webs desde la misma máquina respondían con normalidad, así que es bloqueo
específico de ese edge, no falta de salida a internet.

**Hipótesis a contrastar:** el bloqueo es por rango de IP (datacenter/VPN/residencial
ajena). El siguiente paso acordado con el usuario es **repetir las pruebas desde
dentro de la red de la empresa**, donde la IP puede estar permitida.

---

## 3. Tarea 0 — Confirmar acceso desde la red de la empresa

Antes de tocar código. Desde la red corporativa:

```bash
curl -sI https://www.makito.eu/ \
  -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
```

- **200/301** → sigue por la tarea 1.
- **403 otra vez** → el problema no es la IP. Antes de invertir en el scraper,
  revisa la tarea 5.

Si hay 200, comprueba también si el edge suelta cookies de Bot Manager:

```bash
curl -s -c jar.txt -o /dev/null https://www.makito.eu/ -A "<mismo UA>"
grep -Ei '_abck|bm_sz|ak_bmsc' jar.txt
```

Si aparecen, Akamai Bot Manager está activo: puede tolerar `fetch` o empezar a
devolver 403 tras unas cuantas peticiones. Anota el resultado en este fichero.

## 4. Tarea 1 — Verificar los supuestos contra el HTML real

Los supuestos están codificados en la configuración por defecto. Cada uno tiene su
comprobación; **anota el resultado de cada punto aquí mismo**.

```bash
curl -s -c jar.txt -o login.html https://www.makito.eu/customer/account/login/ -A "<UA>"
```

1. **Rutas y prefijo de store view.** Makito es multiidioma; Magento suele exponer
   `/es/customer/account/login/`. Mira el `action` real y el canonical:
   `grep -oE 'action="[^"]*loginPost[^"]*"' login.html` y
   `grep -o '<link rel="canonical"[^>]*>' login.html`.
   Si hay prefijo, ajusta `MAGENTO_LOGIN_PATH`, `MAGENTO_LOGIN_POST_PATH` y
   `MAGENTO_ACCOUNT_PATH` en `.env` — **no toques el código**.
2. **form_key doble.** `grep -o 'name="form_key" value="[^"]*"' login.html` y
   `grep form_key jar.txt`. Deben existir los dos. Si difieren, el código ya manda
   el de la cookie a propósito (`resolveFormKey` en `src/magento/auth.ts`).
3. **Nombres de los campos.** Confirma `login[username]` y `login[password]`.
   Algunos portales B2B usan código de cliente en vez de email.
4. **CAPTCHA / reCAPTCHA.** `grep -iE 'recaptcha|captcha_form_id|captcha\[' login.html`.
   Si hay, el login programático no sale adelante tal cual: párate y repórtalo.
5. **Destino del redirect tras login.** Login manual en el navegador con la pestaña
   Red abierta y "Preserve log" activo; apunta el `Location` del `loginPost` tanto
   con credenciales buenas como con malas.
6. **Página privada de verificación.** Confirma que `/customer/account/` responde 200
   logueado y 302 al login sin sesión, y que
   `/customer/section/load/?sections=customer` devuelve JSON con `firstname`.
7. **Formulario de login en todas las páginas.** Verifica que, ya logueado, el único
   `<form action=".../loginPost">` que aparece está dentro de `#authenticationPopup`.
   Si el tema lo pinta fuera, `isSessionAlive` dará falsos "sesión caducada" y hay
   que afinar el selector en `src/magento/session-state.ts`.

## 5. Tarea 2 — Prueba de punta a punta contra el Magento falso

Esto **no depende de la red** y debería hacerse aunque el 403 siga: valida el flujo
completo sin gastar intentos de login reales.

`test/fake-magento.mjs` levanta en `:8731` una tienda falsa que reproduce lo
importante: cookie `PHPSESSID` + `form_key`, un input `form_key` **desfasado a
propósito** respecto a la cookie (para probar que gana la cookie), rechazo con 302
de vuelta al login cuando las credenciales fallan, y caducidad de sesión mediante
`EXPIRE_AFTER`.

```bash
# 1) Camino feliz
node test/fake-magento.mjs &
MAGENTO_BASE_URL=http://127.0.0.1:8731 \
MAGENTO_USERNAME=dealer@example.com MAGENTO_PASSWORD=s3cret \
HTTP_MIN_DELAY_MS=0 LOG_LEVEL=debug \
pnpm check:session

# 2) Credenciales malas -> AuthenticationError con el mensaje de la tienda, sin reintentos
MAGENTO_BASE_URL=http://127.0.0.1:8731 \
MAGENTO_USERNAME=dealer@example.com MAGENTO_PASSWORD=mala \
HTTP_MIN_DELAY_MS=0 pnpm check:session

# 3) Caducidad: la sesión muere tras 1 petición privada -> debe reautenticar solo
kill %1; EXPIRE_AFTER=1 node test/fake-magento.mjs &
MAGENTO_BASE_URL=http://127.0.0.1:8731 \
MAGENTO_USERNAME=dealer@example.com MAGENTO_PASSWORD=s3cret \
HTTP_MIN_DELAY_MS=0 LOG_LEVEL=debug SESSION_MAX_REAUTH_ATTEMPTS=1 \
pnpm check:session
```

Qué tiene que pasar:
- (1) salida `Sesión autenticada ✔`, con `cliente: Fabri` y `PHPSESSID`/`form_key` en el jar.
- (2) salida `[auth] Login rechazado: The account sign-in was incorrect...` y exit code 1.
- (3) un `warn` de `sesión caducada, reautenticando` y después éxito.
- En ningún log debe aparecer la contraseña ni el valor completo de una cookie.
  **Revísalo explícitamente en la salida con `LOG_LEVEL=debug`.**

Si algo falla, el fallo es del código, no del entorno: arréglalo antes de tocar la
tienda real. Convertir esto en tests de verdad (`node --test`) es bienvenido.

## 6. Tarea 3 — Login real

Sólo con la tarea 0 en verde y la 2 pasando.

```bash
cp .env.example .env    # rellena credenciales reales; .env está en .gitignore
pnpm check:session
```

Empieza con `HTTP_MIN_DELAY_MS=2000` y `HTTP_MAX_CONCURRENCY=1`: un portal B2B tras
Akamai no es sitio para ir a ráfagas, y varios intentos de login fallidos seguidos
pueden bloquear la cuenta. Ojo: cada ejecución consume un intento de login real.

## 7. Tarea 4 — Si el 403 persiste desde la empresa

El problema pasa a ser el bot management, no Magento. Por orden de preferencia:

1. **Preguntar a Makito** por un acceso legítimo: API, feed de productos/precios o
   un CSV para distribuidores. En portales B2B suele existir y ahorra todo esto.
2. Revisar si el contrato de distribuidor o las condiciones del sitio dicen algo
   sobre acceso automatizado, antes de insistir por la vía técnica.
3. Vía técnica: un navegador real (Playwright con contexto persistente) para obtener
   las cookies de Akamai, y después seguir con este cliente `fetch` reusando ese jar.
   Requiere un `CookieJar.import/export`, que hoy **no existe** — sería la primera
   pieza a añadir (ver §9).

No inviertas en trucos de evasión antes de agotar 1 y 2.

## 8. Mapa de ficheros

| Fichero | Papel |
|---|---|
| `src/config.ts` | Único lector de `process.env`. Valida con zod y lanza `ConfigError` al arrancar si falta algo. |
| `src/errors.ts` | Errores del dominio (`HttpError`, `AuthenticationError`, `SessionExpiredError`…) para distinguirlos en el `catch`. |
| `src/logging/logger.ts` | Logger con niveles a stderr. Redacta credenciales y cookies en un único sitio. |
| `src/http/cookie-jar.ts` | Cookie jar propio: Node no persiste cookies entre `fetch`. |
| `src/http/rate-limiter.ts` | Concurrencia máxima y hueco mínimo entre peticiones. |
| `src/http/client.ts` | Cliente HTTP: cookies, cabeceras, timeout con `AbortController`, reintentos con backoff, `redirect: 'manual'`. No sabe nada de Magento. |
| `src/magento/types.ts` | Contratos del dominio (credenciales, rutas). Sin runtime. |
| `src/magento/form-key.ts` | Extrae el `form_key` del input oculto. |
| `src/magento/session-state.ts` | Criterio único de "¿esta respuesta es de una sesión viva?". |
| `src/magento/auth.ts` | Flujo de login y verificación real contra página privada. |
| `src/magento/session.ts` | Sesión reutilizable: login perezoso, detección de caducidad, reautenticación acotada. |
| `src/scripts/check-session.ts` | Script de ejemplo: login + página privada + confirmación. |
| `test/fake-magento.mjs` | Magento falso para probar el flujo sin tocar la tienda. |

## 9. Pendiente después de esto

Por orden sugerido:

1. Tests automáticos del cookie jar, `isSessionAlive` y el flujo de login contra el
   fake (`node --test`), en vez de comprobaciones manuales.
2. **Persistencia del jar en disco** (`import`/`export` de cookies) para no hacer
   login en cada ejecución y para poder inyectar cookies obtenidas con navegador.
3. Capa de extracción: parseo de listados y fichas de producto con cheerio y
   validación de cada producto con zod. Módulo aparte, `src/catalog/`.
4. Paginación y recorrido de categorías.
5. Persistencia de resultados (NDJSON o SQLite) y modo incremental.

## 10. Reglas del proyecto (respetarlas)

- **pnpm siempre**, nunca npm ni yarn. Instalación:
  `pnpm add cheerio zod` y `pnpm add -D typescript tsx @types/node`.
- Node 20.12+ (el `.env` lo carga `process.loadEnvFile`, sin dotenv). ESM puro:
  los imports relativos llevan extensión `.js`.
- TypeScript estricto, **sin `any`**. Lo que cruza un módulo va tipado explícito.
- `fetch` nativo, sin axios. Nada de seguir redirects automáticamente.
- Nunca reintentar 401/403. Sólo 5xx, 408, 425, 429, timeouts y errores de red.
- Credenciales sólo por entorno. **Jamás en logs, commits ni mensajes de error.**
- Comentarios sólo para el *porqué* no evidente; el resto se explica con nombres.
- Una función pública por módulo como punto de entrada (`errors.ts` y `types.ts`
  son la excepción: sólo exportan clases y tipos).
