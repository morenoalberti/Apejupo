// Administración de cuentas: lista de usuarios registrados, con búsqueda, CSV y acciones
// (confirmar a mano, reenviar el correo de confirmación, borrar). Todo pide la clave CUENTAS_ADMIN,
// que se guarda solo en esta pestaña, o en este dispositivo si se marca «Recordarla».
import { avatar } from './cuenta.js?v=20261116-registro1';

const API = (window.APEJUPO_TORNEOS_API || '').replace(/\/$/, '');
const KEY = 'apejupoAdminCuentas';
const DAY = 86400000;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get() { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set(v, remember) { try { sessionStorage.setItem(KEY, v); if (remember) localStorage.setItem(KEY, v); } catch {} },
  clear() { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch {} } };

let users = [], serverNow = Date.now();

async function call(action, data = {}, key = store.get()) {
  if (!API) throw new Error('El servidor de cuentas todavía no está disponible.');
  const res = await fetch(`${API}/api/cuentas/admin/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error || 'No se pudo completar la operación.'); e.status = res.status; throw e; }
  return body;
}
function note(id, text, error = false) { const el = $(id); el.hidden = !text; el.textContent = text || ''; el.classList.toggle('error', error); }
const fmtDate = t => t ? new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtTime = t => t ? new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
function ago(t) {
  if (!t) return 'Nunca';
  const d = Math.floor((serverNow - t) / DAY);
  return d <= 0 ? 'Hoy' : d === 1 ? 'Ayer' : d < 30 ? `Hace ${d} días` : d < 365 ? `Hace ${Math.floor(d / 30)} ${Math.floor(d / 30) === 1 ? 'mes' : 'meses'}` : 'Hace más de un año';
}

function showLogin(message = '') { $('au-panel').hidden = true; $('au-login').hidden = false; note('au-login-msg', message, true); $('au-key').focus(); }

async function load() {
  try {
    const data = await call('lista');
    users = data.users; serverNow = data.now;
    $('au-login').hidden = true; $('au-panel').hidden = false;
    $('au-updated').textContent = `Actualizado a las ${fmtTime(serverNow)}`;
    render();
  } catch (e) {
    if (e.status === 401 || e.status === 429) { store.clear(); showLogin(e.message); }
    else if ($('au-panel').hidden) showLogin(e.message);
    else note('au-msg', e.message, true);
  }
}

function render() {
  const total = users.length, ok = users.filter(u => u.verified).length;
  const active = users.filter(u => u.lastSeen && serverNow - u.lastSeen < 30 * DAY).length;
  const recent = users.filter(u => serverNow - u.createdAt < 30 * DAY).length;
  $('au-stats').innerHTML = [['Cuentas', total], ['Confirmadas', ok], ['Sin confirmar', total - ok], ['Activas (30 días)', active], ['Altas (30 días)', recent]]
    .map(([t, n]) => `<div><dt>${t}</dt><dd>${n}</dd></div>`).join('');

  const q = $('au-search').value.trim().toLowerCase(), f = $('au-filter').value;
  const list = users.filter(u => (!q || u.nick.toLowerCase().includes(q) || u.email.includes(q))
    && (f === 'todas' || (f === 'confirmadas' && u.verified) || (f === 'pendientes' && !u.verified) || (f === 'inactivas' && (!u.lastSeen || serverNow - u.lastSeen >= 90 * DAY))));
  $('au-rows').innerHTML = list.map(u => `<tr data-id="${esc(u.id)}" role="row">
    <td data-label="Usuario" role="cell"><div class="au-user">${avatar(u)}<span>${esc(u.nick)}</span></div></td>
    <td class="au-mail" data-label="Correo" role="cell"><a href="mailto:${esc(u.email)}">${esc(u.email)}</a></td>
    <td data-label="Estado" role="cell">${u.verified ? '<span class="au-badge ok">Confirmada</span>' : '<span class="au-badge pend">Sin confirmar</span>'}</td>
    <td class="au-date" data-label="Alta" role="cell">${fmtDate(u.createdAt)}<small>${fmtTime(u.createdAt)}</small></td>
    <td class="au-date" data-label="Última actividad" role="cell">${ago(u.lastSeen)}${u.lastSeen ? `<small>${fmtDate(u.lastSeen)}</small>` : ''}</td>
    <td data-label="Acciones" role="cell"><div class="au-acts">${u.verified ? '' : `<button type="button" data-act="confirmar">Confirmar</button><button type="button" data-act="reenviar">Reenviar correo</button>`}<button type="button" class="cu-danger" data-act="borrar">Borrar</button></div></td>
  </tr>`).join('');
  $('au-empty').hidden = list.length > 0;
  $('au-empty').textContent = total ? 'Ninguna cuenta coincide con la búsqueda.' : 'Todavía no se ha registrado nadie.';
}

$('au-rows').addEventListener('click', async ev => {
  const btn = ev.target.closest('button[data-act]'); if (!btn) return;
  const user = users.find(u => u.id === btn.closest('tr').dataset.id); if (!user) return;
  const act = btn.dataset.act;
  if (act === 'borrar' && !confirm(`¿Borrar la cuenta de ${user.nick} (${user.email})?\n\nSe borran su nick, su correo, su contraseña y su foto. No se puede deshacer.`)) return;
  if (act === 'confirmar' && !confirm(`¿Dar por confirmada la cuenta de ${user.nick} sin que abra el enlace del correo?`)) return;
  for (const b of btn.parentNode.querySelectorAll('button')) b.disabled = true;
  try {
    const res = await call(act, { id: user.id });
    note('au-msg', act === 'borrar' ? `Cuenta de ${user.nick} borrada.` : act === 'confirmar' ? `Cuenta de ${user.nick} confirmada.` : `Correo de confirmación reenviado a ${user.email}.${res.enlace ? ' (Local: ' + res.enlace + ')' : ''}`);
    await load();
  } catch (e) {
    note('au-msg', e.message, true);
    if (e.status === 401) { store.clear(); showLogin(e.message); } else await load();
  }
});

$('au-login-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const key = $('au-key').value.trim(); if (!key) return;
  const btn = ev.target.querySelector('button'); btn.disabled = true;
  try { await call('lista', {}, key); store.set(key, $('au-remember').checked); $('au-key').value = ''; note('au-login-msg', ''); await load(); }
  catch (e) { note('au-login-msg', e.message, true); }
  finally { btn.disabled = false; }
});
$('au-search').addEventListener('input', render);
$('au-filter').addEventListener('change', render);
$('au-reload').addEventListener('click', () => { note('au-msg', ''); load(); });
$('au-logout').addEventListener('click', () => { store.clear(); users = []; note('au-msg', ''); showLogin(); });
$('au-csv').addEventListener('click', () => {
  // Punto y coma y BOM: así Excel en español abre bien columnas y acentos.
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = t => t ? new Date(t).toLocaleString('es-ES') : '';
  const rows = [['Nick', 'Correo', 'Confirmada', 'Alta', 'Última actividad', 'Sesiones abiertas'],
    ...users.map(u => [u.nick, u.email, u.verified ? 'Sí' : 'No', iso(u.createdAt), iso(u.lastSeen), u.sessions])];
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `usuarios-apejupo-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

if (store.get()) load(); else showLogin();
