import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const sessions = new Map() // sid -> { formKey, authed, hitsLeft }
const GOOD = { user: 'dealer@example.com', pass: 's3cret' }

const cookiesOf = (req) => Object.fromEntries((req.headers.cookie ?? '').split(';').map(c => {
  const i = c.indexOf('='); return i === -1 ? [c.trim(), ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()]
}).filter(([k]) => k))

const loginHtml = (formKey, error) => `<html><body>
${error ? `<div data-ui-id="message-error">${error}</div>` : ''}
<form id="login-form" action="/customer/account/loginPost/" method="post">
<input name="form_key" type="hidden" value="${formKey}"/>
<input name="login[username]"/><input name="login[password]" type="password"/></form></body></html>`

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const jar = cookiesOf(req)
  let sid = jar['PHPSESSID']
  let session = sid ? sessions.get(sid) : undefined
  const setCookies = []

  if (!session) {
    sid = randomUUID()
    session = { formKey: randomUUID().slice(0, 16), authed: false, hitsLeft: Infinity }
    sessions.set(sid, session)
    setCookies.push(`PHPSESSID=${sid}; Path=/; HttpOnly`)
    setCookies.push(`form_key=${session.formKey}; Path=/`)
  }
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/html', ...headers, 'set-cookie': setCookies })
    res.end(body)
  }

  if (url.pathname === '/customer/account/login/' && req.method === 'GET') {
    const error = session.flash; session.flash = undefined
    // El input va DESFASADO respecto a la cookie a propósito: prueba que gana la cookie.
    return send(200, loginHtml('stale-cached-key', error))
  }

  if (url.pathname === '/customer/account/loginPost/' && req.method === 'POST') {
    let raw = ''
    req.on('data', c => { raw += c })
    return req.on('end', () => {
      const form = new URLSearchParams(raw)
      if (form.get('form_key') !== session.formKey) {
        session.flash = 'Invalid Form Key. Please refresh the page.'
        return send(302, '', { location: '/customer/account/login/' })
      }
      if (form.get('login[username]') !== GOOD.user || form.get('login[password]') !== GOOD.pass) {
        session.flash = 'The account sign-in was incorrect or your account is disabled temporarily.'
        return send(302, '', { location: '/customer/account/login/' })
      }
      session.authed = true
      session.hitsLeft = Number(process.env.EXPIRE_AFTER ?? Infinity)
      return send(302, '', { location: '/customer/account/' })
    })
  }

  const isPrivate = url.pathname.startsWith('/customer/account/') || url.pathname.startsWith('/customer/section/load')
  if (isPrivate) {
    if (!session.authed) return send(302, '', { location: '/customer/account/login/' })
    if (session.hitsLeft-- <= 0) { session.authed = false; return send(302, '', { location: '/customer/account/login/' }) }
    if (url.pathname.startsWith('/customer/section/load')) {
      return send(200, JSON.stringify({ customer: { firstname: 'Fabri' } }), { 'content-type': 'application/json' })
    }
    return send(200, `<html><body><div id="authenticationPopup"><form action="/customer/account/loginPost/"></form></div>
<h1><span class="base">Mi cuenta</span></h1></body></html>`)
  }
  send(404, 'not found')
}).listen(8731, () => console.error('fake magento en :8731'))
