import { api, session, openAuth, refresh } from './cuenta.js?v=20261117-admin1';

const button = document.getElementById('base-datos-button');
const dialog = document.getElementById('base-datos-dialog');
const status = document.getElementById('base-datos-status');
const links = document.getElementById('base-datos-link');
const retry = document.getElementById('base-datos-retry');
const desktopOrTablet = matchMedia('(min-width: 768px)');
let requestId = 0, shownSession = '', waitingForAuth = false, refreshingExpired = false;

function clearLink() { links.replaceChildren(); shownSession = ''; }
function askRegistration() {
  if (waitingForAuth) return;
  const previousSession = session();
  waitingForAuth = true;
  openAuth('registro');
  // Se conserva el aviso de confirmación del correo al registrarse. Al cerrar,
  // se retoma la descarga, también si se ha elegido la pestaña «Entrar».
  document.getElementById('cu-dialog').addEventListener('close', () => {
    waitingForAuth = false;
    if (session() && session() !== previousSession) showDownload();
    else button.focus();
  }, { once: true });
}

async function showDownload() {
  if (!desktopOrTablet.matches) return;
  if (!session()) { askRegistration(); return; }
  const id = ++requestId, token = session();
  clearLink(); retry.hidden = true;
  status.textContent = 'Comprobando tu acceso…';
  if (!dialog.open) dialog.showModal();
  try {
    // El enlace solo lo entrega el servidor tras validar una sesión real.
    const { url } = await api('base-datos', {}, { auth: true });
    if (id !== requestId || !dialog.open || session() !== token) return;
    const destination = new URL(url);
    if (destination.origin !== 'https://mega.nz') throw new Error('El enlace de descarga no está disponible.');
    const link = document.createElement('a');
    link.className = 'base-datos-mega'; link.href = destination.href;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    const label = document.createElement('strong'); label.textContent = 'Abrir MEGA para descargar';
    const address = document.createElement('span'); address.textContent = destination.href;
    link.append(label, address); links.append(link); shownSession = token;
    status.textContent = 'Pulsa el enlace para abrir MEGA en una pestaña nueva y bajar el fichero.';
  } catch (error) {
    if (id !== requestId || !dialog.open || session() !== token) return;
    if (error.status === 401) {
      // La actualización limpia la sesión caducada; este flujo abre después el alta.
      refreshingExpired = true;
      try { await refresh(); } finally { refreshingExpired = false; }
      if (id !== requestId || !dialog.open) return;
      dialog.close(); askRegistration();
    } else {
      status.textContent = error.message || 'No se pudo comprobar el acceso. Inténtalo de nuevo.';
      retry.hidden = false;
    }
  }
}

button.addEventListener('click', showDownload);
retry.addEventListener('click', showDownload);
dialog.addEventListener('click', event => {
  if (event.target === dialog || event.target.closest('[data-base-close]')) dialog.close();
});
dialog.addEventListener('close', () => { ++requestId; clearLink(); });
addEventListener('apejupo:cuenta', () => {
  if (refreshingExpired) return;
  if (!session() || (shownSession && shownSession !== session())) {
    ++requestId; clearLink();
    if (dialog.open) dialog.close();
  }
});
desktopOrTablet.addEventListener('change', () => {
  if (!desktopOrTablet.matches) {
    ++requestId; clearLink();
    if (dialog.open) dialog.close();
    if (waitingForAuth) document.getElementById('cu-dialog')?.close();
  }
});
// Al regresar con Atrás no se conserva en pantalla un enlace de una sesión cerrada.
addEventListener('pagehide', () => { ++requestId; clearLink(); if (dialog.open) dialog.close(); });
