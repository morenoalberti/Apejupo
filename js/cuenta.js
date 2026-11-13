// Cuentas de jugador (nick + contraseña + correo), como en Lichess. Módulo compartido:
// pone el botón «Entrar» / tu nick en la cabecera y abre la ventana para entrar o crear la cuenta.
const API = (window.APEJUPO_TORNEOS_API || '').replace(/\/$/, '');
const SESSION_KEY = 'apejupoSesion', USER_KEY = 'apejupoCuenta';
const read = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const session = () => read(SESSION_KEY);
export function currentUser() { try { return session() ? JSON.parse(read(USER_KEY) || 'null') : null; } catch { return null; } }
function setAccount(token, user) {
  write(SESSION_KEY, token || ''); write(USER_KEY, user ? JSON.stringify(user) : '');
  renderChip(); dispatchEvent(new CustomEvent('apejupo:cuenta', { detail: user || null }));
}
export async function api(action, data = {}, { auth = false } = {}) {
  if (!API) throw new Error('Las cuentas todavía no están disponibles.');
  const res = await fetch(`${API}/api/cuentas/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth && session() ? { Authorization: 'Bearer ' + session() } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error || 'No se pudo completar la operación.'); e.status = res.status; throw e; }
  return body;
}
export async function logout() { try { await api('salir', {}, { auth: true }); } catch {} setAccount('', null); }
// Comprueba la sesión guardada (puede haber caducado o cerrado en otro sitio).
export async function refresh() {
  if (!session()) return null;
  try { const { user } = await api('yo', {}, { auth: true }); setAccount(session(), user); return user; }
  catch (e) { if (e.status === 401) setAccount('', null); return currentUser(); }
}

function renderChip() {
  const chip = document.getElementById('cuenta-chip'); if (!chip) return;
  const user = currentUser();
  chip.innerHTML = user ? `<span class="cu-avatar" aria-hidden="true">${esc(user.nick[0].toUpperCase())}</span><span>${esc(user.nick)}</span>` : 'Entrar';
  chip.href = 'cuenta.html'; chip.classList.toggle('in', !!user);
  chip.setAttribute('aria-label', user ? `Tu cuenta: ${user.nick}` : 'Entrar o crear una cuenta');
}

// Ventana de entrar / crear cuenta / recuperar contraseña.
const DIALOG = `<dialog id="cu-dialog" class="cu-dialog" aria-labelledby="cu-title"><div class="cu-box">
  <button type="button" class="cu-close" data-cu-close aria-label="Cerrar">×</button>
  <div class="cu-tabs" role="tablist"><button type="button" role="tab" data-cu-tab="entrar">Entrar</button><button type="button" role="tab" data-cu-tab="registro">Crear cuenta</button></div>
  <h2 id="cu-title" class="cu-sr"></h2>
  <form data-cu-form="entrar" novalidate><label for="cu-login">Nick o correo</label><input id="cu-login" name="login" autocomplete="username" required>
    <label for="cu-pass">Contraseña</label><input id="cu-pass" name="password" type="password" autocomplete="current-password" required>
    <button class="btn cu-submit" type="submit">Entrar</button>
    <button type="button" class="cu-link" data-cu-tab="recuperar">¿Has olvidado la contraseña?</button></form>
  <form data-cu-form="registro" novalidate><label for="cu-nick">Nick</label><input id="cu-nick" name="nick" autocomplete="username" minlength="2" maxlength="20" required placeholder="Así te verán los demás">
    <small class="muted">De 2 a 20 caracteres: letras sin acentos, números, guion o guion bajo. No se puede cambiar después.</small>
    <label for="cu-email">Correo electrónico</label><input id="cu-email" name="email" type="email" autocomplete="email" required>
    <small class="muted">Solo para confirmar la cuenta y recuperar la contraseña. No se muestra a nadie.</small>
    <label for="cu-newpass">Contraseña</label><input id="cu-newpass" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required>
    <label class="cu-check"><input type="checkbox" name="privacy" required> <span>Tengo 14 años o más y he leído la <a href="privacidad.html" target="_blank">política de privacidad</a></span></label>
    <button class="btn cu-submit" type="submit">Crear cuenta</button></form>
  <form data-cu-form="recuperar" novalidate><p class="muted">Escribe el correo de tu cuenta y te mandaremos un enlace para poner una contraseña nueva.</p>
    <label for="cu-remail">Correo electrónico</label><input id="cu-remail" name="email" type="email" autocomplete="email" required>
    <button class="btn cu-submit" type="submit">Enviar enlace</button>
    <button type="button" class="cu-link" data-cu-tab="entrar">Volver a entrar</button></form>
  <div class="cu-msg" role="status" hidden></div>
</div></dialog>`;
let dialog = null;
function show(text, error = false, extra = '') {
  const box = dialog.querySelector('.cu-msg');
  box.hidden = !text; box.classList.toggle('error', error); box.innerHTML = text ? esc(text) + extra : '';
}
// En pruebas locales el servidor devuelve el enlace del correo para poder seguirlo sin buzón.
const devLink = body => body.enlace ? `<br><a href="${esc(body.enlace.replace(/^https?:\/\/[^/]+\//, ''))}">Abrir el enlace del correo (solo en pruebas locales)</a>` : '';
function tab(name) {
  for (const f of dialog.querySelectorAll('[data-cu-form]')) f.hidden = f.dataset.cuForm !== name;
  for (const b of dialog.querySelectorAll('.cu-tabs [data-cu-tab]')) b.setAttribute('aria-selected', String(b.dataset.cuTab === (name === 'recuperar' ? 'entrar' : name)));
  dialog.querySelector('#cu-title').textContent = { entrar: 'Entrar', registro: 'Crear cuenta', recuperar: 'Recuperar contraseña' }[name];
  show('');
  dialog.querySelector(`[data-cu-form="${name}"] input`)?.focus();
}
export function openAuth(name = 'entrar') {
  if (!dialog) {
    document.body.insertAdjacentHTML('beforeend', DIALOG); dialog = document.getElementById('cu-dialog');
    dialog.addEventListener('click', e => {
      if (e.target === dialog || e.target.closest('[data-cu-close]')) dialog.close();
      const t = e.target.closest('[data-cu-tab]'); if (t) tab(t.dataset.cuTab);
      if (e.target.closest('[data-cu-resend]')) resend();
    });
    dialog.addEventListener('submit', submit);
  }
  tab(name); if (!dialog.open) dialog.showModal();
}
let lastLogin = '';
async function resend() {
  try { const body = await api('reenviar', { login: lastLogin }); show('Si la cuenta está pendiente de confirmar, te hemos enviado otro correo.', false, devLink(body)); }
  catch (e) { show(e.message, true); }
}
async function submit(event) {
  event.preventDefault();
  const form = event.target, kind = form.dataset.cuForm, data = Object.fromEntries(new FormData(form)), button = form.querySelector('.cu-submit');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  button.disabled = true; show('');
  try {
    if (kind === 'entrar') {
      lastLogin = data.login;
      const { session: token, user } = await api('entrar', { login: data.login, password: data.password });
      setAccount(token, user); form.reset(); dialog.close();
    } else if (kind === 'registro') {
      const body = await api('registro', { nick: data.nick, email: data.email, password: data.password });
      lastLogin = data.email; form.reset();
      show(`Cuenta creada. Te hemos enviado un correo a ${data.email}: abre el enlace para activarla y después entra.`, false, devLink(body));
    } else {
      const body = await api('recuperar', { email: data.email });
      show('Si ese correo tiene cuenta, te llegará un enlace en unos minutos. Revisa también el correo no deseado.', false, devLink(body));
    }
  } catch (e) {
    show(e.message, true, e.status === 403 && kind === 'entrar' ? ' <button type="button" class="cu-link" data-cu-resend>Reenviar el correo de confirmación</button>' : '');
  } finally { button.disabled = false; }
}

// El botón de la cabecera: sin cuenta abre la ventana; con cuenta lleva a «Mi cuenta».
document.addEventListener('click', e => {
  const chip = e.target.closest('#cuenta-chip');
  if (chip && !currentUser()) { e.preventDefault(); openAuth('entrar'); }
});
addEventListener('storage', e => { if (e.key === SESSION_KEY || e.key === USER_KEY) { renderChip(); dispatchEvent(new CustomEvent('apejupo:cuenta', { detail: currentUser() })); } });
renderChip(); refresh();
