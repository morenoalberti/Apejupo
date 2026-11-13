// Página «Mi cuenta»: confirmar la cuenta y poner contraseña nueva (enlaces del correo), ver tus datos,
// salir y borrar la cuenta.
import { api, currentUser, logout, openAuth, refresh } from './cuenta.js?v=20261113-cuentas6';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URL(location.href).searchParams;
const view = name => { for (const s of document.querySelectorAll('[data-view]')) s.hidden = s.dataset.view !== name; };
function note(id, text, error = false) { const el = $(id); el.hidden = !text; el.textContent = text; el.classList.toggle('error', error); }
// Quita el código del enlace de la barra de direcciones: no se queda en el historial ni se comparte por error.
const cleanUrl = () => history.replaceState(null, '', 'cuenta.html');

function renderAccount() {
  const user = currentUser();
  if (!user) { view('fuera'); return; }
  // Con la sesión abierta no hace falta esta página: se vuelve a la portada (tus opciones están en el menú de tu foto).
  location.replace('index.html'); return;
  view('dentro');
  $('cu-nick-big').textContent = user.nick; $('cu-initial').textContent = user.nick[0].toUpperCase();
  $('cu-email-fact').textContent = user.email;
  $('cu-verify').hidden = !!user.verified;
  $('cu-since').textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
}

async function confirmAccount(token) {
  view('mensaje'); $('cu-msg-title').textContent = 'Confirmando tu cuenta…'; note('cu-msg-text', '');
  try {
    const { nick } = await api('confirmar', { token });
    $('cu-msg-title').textContent = '¡Cuenta confirmada!';
    note('cu-msg-text', `Bienvenido, ${nick}. Ya puedes entrar con tu nick y tu contraseña.`);
    $('cu-msg-enter').hidden = false;
  } catch (e) { $('cu-msg-title').textContent = 'No se pudo confirmar'; note('cu-msg-text', e.message, true); $('cu-msg-enter').hidden = false; }
  cleanUrl();
}

const resetToken = params.get('restablecer'), confirmToken = params.get('confirmar');
if (confirmToken) confirmAccount(confirmToken);
else if (resetToken) { view('restablecer'); cleanUrl(); }
else { renderAccount(); refresh().then(renderAccount); }
// Mientras se muestra el resultado de un enlace del correo, no se cambia de vista hasta que la persona entre.
let locked = !!(confirmToken || resetToken);
addEventListener('apejupo:cuenta', () => { if (!locked) renderAccount(); });

$('cu-reset-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  if ($('cu-reset-pass').value !== $('cu-reset-pass2').value) { note('cu-reset-msg', 'Las dos contraseñas no coinciden.', true); return; }
  button.disabled = true;
  try {
    const { nick } = await api('restablecer', { token: resetToken, password: $('cu-reset-pass').value });
    form.reset(); form.hidden = true;
    note('cu-reset-msg', `Contraseña cambiada, ${nick}. Por seguridad se han cerrado tus sesiones abiertas: vuelve a entrar.`);
    $('cu-reset-enter').hidden = false;
  } catch (e) { note('cu-reset-msg', e.message, true); }
  finally { button.disabled = false; }
});
for (const id of ['cu-msg-enter', 'cu-reset-enter', 'cu-out-enter']) $(id).addEventListener('click', () => { locked = false; openAuth('entrar'); });
$('cu-out-register').addEventListener('click', () => openAuth('registro'));
$('cu-logout').addEventListener('click', async () => { await logout(); renderAccount(); });
$('cu-delete-open').addEventListener('click', () => { $('cu-delete-form').hidden = false; $('cu-delete-pass').focus(); });
$('cu-delete-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    await api('borrar', { password: $('cu-delete-pass').value }, { auth: true });
    await logout(); view('mensaje'); $('cu-msg-title').textContent = 'Cuenta borrada';
    note('cu-msg-text', 'Hemos borrado tu cuenta, tu correo y tu contraseña. Los torneos en los que jugaste conservan tu nombre como alias hasta que caduquen.');
  } catch (e) { note('cu-delete-msg', e.message, true); }
  finally { button.disabled = false; }
});
$('cu-delete-cancel').addEventListener('click', () => { $('cu-delete-form').hidden = true; $('cu-delete-pass').value = ''; note('cu-delete-msg', ''); });
$('cu-resend').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { await api('reenviar', { login: currentUser()?.email || '' }, { auth: true }); button.textContent = 'Correo enviado: revisa tu bandeja'; }
  catch (e) { button.textContent = e.message; button.disabled = false; }
});
