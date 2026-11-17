// Buscador de jugadores en las listas FIDE y FADA para los torneos presenciales.
// Usa las mismas bases SQLite que la página de Elo (data/elo/*.db), leídas por partes desde el navegador.
const LIB_VERSION = '2'; // la misma que en js/tabla.js
const BASES = { fide: 'RondaSwissFIDE.db', fada: 'RondaSwissFADA.db' };
let metaPromise = null, libPromise = null;
const dbs = {};

function loadMeta() {
  return metaPromise ||= fetch('data/elo/meta.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null);
}
function loadLib() {
  return libPromise ||= new Promise((resolve, reject) => {
    if (window.createDbWorker) return resolve();
    const s = document.createElement('script');
    s.src = 'assets/sqljs/index.js';
    s.onload = resolve; s.onerror = () => { libPromise = null; reject(new Error('No se pudo cargar el buscador.')); };
    document.head.append(s);
  });
}
function getDb(kind) {
  return dbs[kind] ||= Promise.all([loadMeta(), loadLib()]).then(([meta]) => {
    const file = BASES[kind], info = meta?.bases_de_datos?.[file];
    const config = { serverMode: 'full', url: new URL('data/elo/' + file, location.href).href + '?v=' + (meta?.construido || ''), requestChunkSize: 16384 };
    if (info?.bytes) config.databaseLengthBytes = info.bytes;
    return window.createDbWorker([{ from: 'inline', config }],
      new URL('assets/sqljs/sqlite.worker.js?v=' + LIB_VERSION, location.href).href,
      new URL('assets/sqljs/sql-wasm.wasm?v=' + LIB_VERSION, location.href).href).then(w => w.db);
  }).catch(e => { delete dbs[kind]; throw e; });
}
/** Empieza a preparar las bases (la primera búsqueda tarda unos segundos). */
export function warmUp() { getDb('fada').catch(() => {}); getDb('fide').catch(() => {}); }

const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
const clean = s => String(s || '').trim().replace(/[^\p{L}\p{N} ,.'\-]/gu, '').replace(/\s+/g, ' ');
function prefix(text) {
  const lo = text.toLowerCase(), hi = lo.slice(0, -1) + String.fromCharCode(lo.charCodeAt(lo.length - 1) + 1);
  return `nombre COLLATE NOCASE >= ${lit(lo)} AND nombre COLLATE NOCASE < ${lit(hi)}`;
}
// En las listas va primero el apellido («Moreno Alberti, Manuel»); si se escribe «Manuel Moreno» se prueban los cortes.
function variants(text) {
  const v = [{ pref: text, given: '' }], p = text.replace(/,/g, ' ').split(' ').filter(Boolean);
  if (!text.includes(',') && p.length >= 2) for (let k = 1; k < p.length; k++) v.push({ pref: p.slice(k).join(' '), given: p.slice(0, k).join(' ') });
  return v;
}
const SQL = {
  fide: 'SELECT fide_id, nombre, federacion, titulo, elo_standard AS elo, anio_nacimiento AS nac FROM jugadores_fide',
  fada: 'SELECT id, nombre, club, provincia, titulo, elo_fada AS elo, fide_id, anio_nacimiento AS nac FROM jugadores_fada'
};
async function query(kind, text, limit, exact = false) {
  const db = await getDb(kind);
  if (/^\d{3,}$/.test(text)) return db.query(`${SQL[kind]} WHERE ${kind === 'fada' ? 'id' : 'fide_id'} = ${parseInt(text, 10)} LIMIT ${limit}`);
  for (const v of variants(text)) {
    const w = exact ? [v.given ? `nombre COLLATE NOCASE = ${lit(v.pref + ', ' + v.given)}` : `nombre COLLATE NOCASE = ${lit(v.pref)}`]
      : [prefix(v.pref), ...(v.given ? [`nombre LIKE ${lit('%, ' + v.given + '%')}`] : [])];
    const rows = await db.query(`${SQL[kind]} WHERE ${w.join(' AND ')} ORDER BY ${exact ? 'elo DESC' : 'nombre COLLATE NOCASE'} LIMIT ${limit}`);
    if (rows.length) return rows;
  }
  return [];
}
// Un jugador de la FADA con número FIDE se junta con su ficha FIDE: una sola sugerencia con los dos Elo.
function merge(fada, fide) {
  const out = [], byFide = new Map();
  for (const r of fada) {
    const item = { name: r.nombre, fada: r.elo || null, fadaId: r.id, fideId: r.fide_id ? String(r.fide_id) : null, fed: 'ESP', place: r.provincia || r.club || '', title: r.titulo || '', birth: r.nac || null };
    out.push(item); if (item.fideId) byFide.set(item.fideId, item);
  }
  for (const r of fide) {
    const id = String(r.fide_id), known = byFide.get(id);
    if (known) { known.fide = r.elo || null; known.title ||= r.titulo || ''; known.fed = r.federacion || known.fed; known.birth ||= r.nac || null; continue; }
    out.push({ name: r.nombre, fide: r.elo || null, fideId: id, fed: r.federacion || null, place: window.U?.pais ? window.U.pais(r.federacion) : r.federacion || '', title: r.titulo || '', birth: r.nac || null });
  }
  return out;
}
// Para el torneo manda el Elo FIDE estándar; si no tiene, el FADA. A los de la FADA con número FIDE
// que no salieron en la búsqueda por nombre se les pide su ficha FIDE por número (consulta con índice).
async function finish(items) {
  const missing = items.filter(p => p.fideId && p.fide === undefined);
  if (missing.length) {
    try {
      const rows = await (await getDb('fide')).query(`SELECT fide_id, elo_standard AS elo, titulo, anio_nacimiento AS nac FROM jugadores_fide WHERE fide_id IN (${missing.map(p => parseInt(p.fideId, 10)).join(',')})`);
      for (const r of rows) { const p = missing.find(p => p.fideId === String(r.fide_id)); if (p) { p.fide = r.elo || null; p.title ||= r.titulo || ''; p.birth ||= r.nac || null; } }
    } catch {}
  }
  for (const p of items) { p.rating = p.fide || p.fada || null; p.source = p.fide ? 'FIDE' : p.fada ? 'FADA' : null; }
  return items;
}
/** Sugerencias para un texto: hasta 8, de la FADA (con tildes) y de la FIDE. */
export async function searchPlayers(text) {
  text = clean(text);
  if (text.length < 3) return [];
  const [fada, fide] = await Promise.all([query('fada', text, 6).catch(() => []), query('fide', text, 6).catch(() => [])]);
  return finish(merge(fada, fide).slice(0, 8));
}
/** Para la lista pegada: el jugador con ese nombre exacto, solo si no hay dudas (una sola coincidencia por lista). */
export async function findExact(name) {
  const text = clean(name);
  if (text.length < 3) return null;
  const [fada, fide] = await Promise.all([query('fada', text, 2, true).catch(() => []), query('fide', text, 2, true).catch(() => [])]);
  if (fada.length > 1 || fide.length > 1) return null;
  const all = merge(fada, fide);
  return all.length === 1 ? (await finish(all))[0] : null;
}
