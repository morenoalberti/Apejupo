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

// Redondel de la cuenta: tu foto si la has subido; si no, la inicial del nick.
export const photoUrl = user => user?.photo ? `${API}/api/cuentas/foto/${user.id}?v=${user.photo}` : '';
export function avatar(user, extra = '') {
  const inner = user.photo ? `<img src="${esc(photoUrl(user))}" alt="" width="64" height="64">` : esc(user.nick[0].toUpperCase());
  return `<span class="cu-avatar${user.photo ? ' has-photo' : ''}" aria-hidden="true">${inner}${extra}</span>`;
}
function renderChip() {
  const chip = document.getElementById('cuenta-chip'); if (!chip) return;
  const user = currentUser();
  // Con sesión: redondel (donde irá la foto, de momento la inicial) y el nick; un punto naranja si falta confirmar el correo.
  chip.innerHTML = user ? `${avatar(user, user.verified ? '' : '<i class="cu-pending"></i>')}<span class="cu-nick">${esc(user.nick)}</span>` : 'Entrar';
  chip.href = 'cuenta.html'; chip.classList.toggle('in', !!user); chip.setAttribute('aria-haspopup', user ? 'menu' : 'dialog');
  chip.setAttribute('aria-label', user ? `Tu cuenta: ${user.nick}${user.verified ? '' : ' (correo sin confirmar)'}` : 'Entrar o crear una cuenta');
  chip.title = user && !user.verified ? 'Confirma tu correo para jugar torneos con tu cuenta' : '';
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
  <form data-cu-form="borrar" novalidate><h3 class="cu-h">Borrar tu cuenta</h3><p class="muted">Se borran tu nick, tu correo y tu contraseña. No se puede deshacer.</p>
    <label for="cu-delpass">Escribe tu contraseña para confirmar</label><input id="cu-delpass" name="password" type="password" autocomplete="current-password" required>
    <button class="btn cu-submit cu-danger-btn" type="submit">Borrar definitivamente</button>
    <button type="button" class="cu-link" data-cu-close>Volver</button></form>
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
  dialog.querySelector('.cu-tabs').hidden = name === 'borrar';
  for (const f of dialog.querySelectorAll('[data-cu-form]')) f.hidden = f.dataset.cuForm !== name;
  for (const b of dialog.querySelectorAll('.cu-tabs [data-cu-tab]')) b.setAttribute('aria-selected', String(b.dataset.cuTab === (name === 'recuperar' ? 'entrar' : name)));
  dialog.querySelector('#cu-title').textContent = { entrar: 'Entrar', registro: 'Crear cuenta', recuperar: 'Recuperar contraseña', borrar: 'Borrar tu cuenta' }[name];
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
  try { const body = await api('reenviar', { login: lastLogin || currentUser()?.email || '' }, { auth: true }); show('Te hemos enviado otro correo de confirmación. Puede tardar un par de minutos.', false, devLink(body) + ' <button type="button" class="btn cu-submit" data-cu-close>Entendido</button>'); }
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
      // Ya has entrado: la cabecera muestra tu nick. Falta confirmar el correo para jugar con la cuenta.
      setAccount(body.session, body.user);
      for (const f of dialog.querySelectorAll('[data-cu-form]')) f.hidden = true;
      dialog.querySelector('.cu-tabs').hidden = true;
      show(`¡Bienvenido, ${body.user.nick}! Ya has entrado con tu cuenta. Último paso: te hemos enviado un correo a ${data.email}. Abre el enlace que contiene para confirmar tu dirección y poder jugar torneos con tu nick. Si no lo ves en unos minutos, mira en «Spam» o «Promociones».`, false,
        devLink(body) + ' <button type="button" class="cu-link" data-cu-resend>Reenviar el correo</button> <button type="button" class="btn cu-submit" data-cu-close>Entendido</button>');
    } else if (kind === 'borrar') {
      await api('borrar', { password: data.password }, { auth: true });
      form.reset(); form.hidden = true; await logout();
      show('Hemos borrado tu cuenta, tu correo y tu contraseña.', false, ' <button type="button" class="btn cu-submit" data-cu-close>Cerrar</button>');
    } else {
      const body = await api('recuperar', { email: data.email });
      show('Si ese correo tiene cuenta, te llegará un enlace en unos minutos. Revisa también el correo no deseado.', false, devLink(body));
    }
  } catch (e) {
    show(e.message, true, e.status === 403 && kind === 'entrar' ? ' <button type="button" class="cu-link" data-cu-resend>Reenviar el correo de confirmación</button>' : '');
  } finally { button.disabled = false; }
}

// Menú de la cuenta, como en Lichess: al pulsar tu foto se abre con tus datos, Salir y Borrar la cuenta.
let menu = null;
function closeMenu() { if (menu) { menu.remove(); menu = null; document.getElementById('cuenta-chip')?.setAttribute('aria-expanded', 'false'); } }
const ICON = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
function openMenu(chip) {
  const user = currentUser(); if (!user) return;
  menu = document.createElement('div'); menu.className = 'cu-menu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = `<div class="cu-menu-head"><button type="button" class="cu-photo-btn" data-cu-act="foto" title="Cambiar tu foto">${avatar(user)}<span class="cu-photo-cam" aria-hidden="true">${ICON('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>')}</span></button><div><b>${esc(user.nick)}</b><small>${esc(user.email)}</small></div></div>`
    + (user.verified ? '' : '<div class="cu-menu-warn">Correo sin confirmar: abre el enlace que te enviamos para jugar torneos con tu nick. <button type="button" data-cu-act="reenviar">Reenviar el correo</button></div>')
    + `<button type="button" role="menuitem" data-cu-act="foto">${ICON('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>')}${user.photo ? 'Cambiar foto' : 'Subir una foto'}</button>`
    + (user.photo ? `<button type="button" role="menuitem" data-cu-act="quitar-foto">${ICON('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>')}Quitar la foto</button>` : '')
    + `<a role="menuitem" href="jugar-torneo.html">${ICON('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>')}Jugar torneos</a>`
    + `<button type="button" role="menuitem" data-cu-act="salir">${ICON('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')}Salir</button>`
    + `<button type="button" role="menuitem" class="cu-menu-danger" data-cu-act="borrar">${ICON('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>')}Borrar mi cuenta</button>`;
  document.body.append(menu);
  const r = chip.getBoundingClientRect();
  menu.style.top = `${r.bottom + 8}px`; menu.style.right = `${Math.max(8, document.documentElement.clientWidth - r.right)}px`;
  chip.setAttribute('aria-expanded', 'true');
  menu.addEventListener('click', async e => {
    const act = e.target.closest('[data-cu-act]')?.dataset.cuAct; if (!act) return;
    if (act === 'salir') { closeMenu(); await logout(); }
    else if (act === 'borrar') { closeMenu(); openAuth('borrar'); }
    else if (act === 'foto') { closeMenu(); pickPhoto(); }
    else if (act === 'quitar-foto') { closeMenu(); try { const { user: u } = await api('foto-quitar', {}, { auth: true }); setAccount(session(), u); } catch (err) { alert(err.message); } }
    else if (act === 'reenviar') {
      const b = e.target.closest('button'); b.disabled = true;
      try { await api('reenviar', { login: user.email }, { auth: true }); b.textContent = 'Enviado: revisa tu correo'; } catch (err) { b.textContent = err.message; b.disabled = false; }
    }
  });
}
// Subir foto: se recorta al cuadrado central y se reduce a 192×192 en JPEG (unos 10-20 KB) antes de enviarla.
async function shrink(file) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(img.width, img.height), size = 192, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  for (const q of [0.86, 0.72, 0.55]) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 60 * 1024) return blob;
  }
  throw new Error('No se ha podido reducir la foto. Prueba con otra imagen.');
}
function pickPhoto() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    try {
      if (!/^image\//.test(file.type)) throw new Error('Elige una imagen (JPG, PNG, WebP…).');
      const blob = await shrink(file);
      const res = await fetch(`${API}/api/cuentas/foto`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + session() }, body: blob, signal: AbortSignal.timeout(20000) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'No se pudo subir la foto.');
      setAccount(session(), body.user);
    } catch (err) { alert(err.message || 'No se pudo subir la foto.'); }
  });
  input.click();
}
document.addEventListener('click', e => {
  const chip = e.target.closest('#cuenta-chip');
  if (chip) { e.preventDefault(); if (!currentUser()) openAuth('entrar'); else if (menu) closeMenu(); else openMenu(chip); return; }
  if (menu && !menu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
addEventListener('resize', closeMenu);
addEventListener('scroll', closeMenu, { passive: true });
addEventListener('storage', e => { if (e.key === SESSION_KEY || e.key === USER_KEY) { renderChip(); dispatchEvent(new CustomEvent('apejupo:cuenta', { detail: currentUser() })); } });
renderChip(); refresh();
