// Informe federativo: separado del TRF interno de swiss-dutch.js.
// https://tec.fide.com/trf-2026/ (TRF16 y TRF26, posiciones 1-indexadas).
import { closedPairs, requireThat, standings, tournamentTrfDetails } from './core.js';
import { isForfeit } from './results.js';

export const TRF_BODY_LIMIT = 128 * 1024;
const clean = (value, max = 120) => String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const ascii = value => clean(value, 500).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]/g, '?');
const num = (value, width) => { const s = String(value ?? ''); requireThat(s.length <= width, `El valor ${s} no cabe en el campo TRF de ${width} caracteres.`); return s.padStart(width); };
const text = (value, width) => ascii(value).slice(0, width).padEnd(width);
const iso = time => time ? new Date(time).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : '';
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validBirth = value => !value || /^\d{4}$/.test(value) || date(value);
const rating = value => { const n = Number(value); requireThat(Number.isInteger(n) && n >= 0 && n <= 4000, 'El Elo debe estar entre 0 y 4000.'); return n; };
const titles = new Set(['GM', 'IM', 'FM', 'CM', 'WGM', 'WIM', 'WFM', 'WCM']);
const baseRatings = p => ({ standard: p.fide || (p.source === 'FIDE' ? p.rating : 0) || 0, rapid: 0, blitz: 0, fada: p.fada || (p.source === 'FADA' ? p.rating : 0) || 0 });

export function trfDefaults(t) {
  const saved = t.trfReport || {}, list = t.minutes + t.increment <= 10 ? 'blitz' : t.minutes + t.increment < 60 ? 'rapid' : 'standard';
  const report = { format: 'trf16', ratingList: list, ...tournamentTrfDetails(t), ...saved,
    startDate: saved.startDate || iso(t.games[0]?.startedAt || t.startsAt || t.createdAt), endDate: saved.endDate || iso(t.finishedAt),
    players: t.players.map(p => ({ id: p.id, name: p.name, fideId: p.fideId || '', fadaId: p.fadaId || '', fed: p.fed || '', title: titles.has(p.title) ? p.title : '', sex: p.sex || '', birth: p.birth ? String(p.birth) : '',
      ...saved.players?.find(x => x.id === p.id), ratings: { ...baseRatings(p), ...saved.players?.find(x => x.id === p.id)?.ratings } })) };
  const roundStarts = new Map();
  for (const game of t.games) if (game.startedAt && !roundStarts.has(game.round)) roundStarts.set(game.round, game.startedAt);
  report.roundDates = Array.from({ length: t.rounds }, (_, i) => saved.roundDates?.[i]
    || iso(roundStarts.get(i + 1)) || (report.startDate === report.endDate ? report.startDate : ''));
  return report;
}

export function validateTrfReport(t, input) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Datos TRF no válidos.');
  requireThat(['trf16', 'trf26'].includes(input.format), 'Elige TRF-16 o TRF-26.');
  requireThat(['standard', 'rapid', 'blitz', 'fada'].includes(input.ratingList), 'Elige una lista de Elo.');
  requireThat(Array.isArray(input.players) && input.players.length === t.players.length, 'La lista de jugadores ha cambiado. Cierra y vuelve a abrir TRF.', 409);
  const ids = new Set();
  const players = input.players.map(p => {
    requireThat(p && t.players.some(x => x.id === p.id) && !ids.has(p.id), 'Lista de jugadores TRF no válida.'); ids.add(p.id);
    const fideId = clean(p.fideId, 20), fadaId = clean(p.fadaId, 20), birth = clean(p.birth, 20);
    requireThat(!fideId || /^\d{1,11}$/.test(fideId), 'El ID FIDE debe tener como máximo 11 cifras.');
    requireThat(!fadaId || /^\d{1,11}$/.test(fadaId), 'El ID FADA debe tener como máximo 11 cifras.');
    requireThat(validBirth(birth), 'Escribe una fecha de nacimiento válida o solo el año.');
    return { id: p.id, name: clean(p.name, 80), fideId, fadaId, birth, fed: clean(p.fed, 3).toUpperCase(), title: titles.has(p.title) ? p.title : '', sex: ['M', 'F'].includes(p.sex) ? p.sex : '',
      ratings: Object.fromEntries(['standard', 'rapid', 'blitz', 'fada'].map(k => [k, rating(p.ratings?.[k] || 0)])) };
  });
  const rounds = t.rounds;
  requireThat(!input.roundDates || Array.isArray(input.roundDates) && input.roundDates.length <= rounds, 'Fechas de ronda no válidas.');
  const roundDates = Array.from({ length: rounds }, (_, i) => clean(input.roundDates?.[i], 10) || (input.startDate === input.endDate ? clean(input.startDate, 10) : ''));
  requireThat(roundDates.every(d => !d || date(d)), 'Hay fechas de ronda no válidas.');
  return { format: input.format, ratingList: input.ratingList, city: clean(input.city), federation: clean(input.federation, 3).toUpperCase(), chiefArbiter: clean(input.chiefArbiter), deputyArbiters: String(input.deputyArbiters || '').split(/[;\r\n]/).slice(0, 12).map(x => clean(x)).filter(Boolean).join('; '),
    startDate: clean(input.startDate, 10), endDate: clean(input.endDate, 10), roundDates, players };
}

function reportGames(t) {
  if (t.format !== 'closed') return t.games;
  const schedule = new Map();
  return t.games.map(g => {
    if (!g.bye || g.rest) return g;
    if (!schedule.has(g.round)) schedule.set(g.round, closedPairs(t.players, g.round));
    const pair = schedule.get(g.round).find(([white, black]) => white && black && (white.id === g.white || black.id === g.white));
    if (!pair) return g;
    const [white, black] = pair;
    // El torneo anota este punto como bye; el TRF conserva el rival y el color programados.
    return { ...g, white: white.id, black: black.id, bye: false, result: white.id === g.white ? '+-' : '-+' };
  });
}

function tournamentErrors(t) {
  const errors = [];
  if (t.mode !== 'presencial' || t.challenge || !['swiss', 'closed'].includes(t.format)) errors.push(t.format === 'double-closed' ? 'La exportación TRF está deshabilitada en doble vuelta.' : 'El informe TRF está disponible para torneos presenciales suizos y Round-Robin a una vuelta.');
  if (t.status === 'cancelled') errors.push('El torneo está cancelado.');
  else if (!t.games.length || t.round < t.rounds || t.status !== 'finished') errors.push('Termina todas las rondas antes de exportar el informe.');
  if (t.games.some(g => !g.bye && !g.result)) errors.push('Hay partidas sin resultado.');
  if (new Set(t.players.map(p => p.seed)).size !== t.players.length || t.players.some(p => !Number.isInteger(p.seed) || p.seed < 1 || p.seed > 9999)) errors.push('La numeración inicial de jugadores no es válida.');
  return errors;
}

function reportFields(t, report) {
  const errors = [], warnings = [];
  if (!report.city) errors.push('Falta la ciudad del torneo.');
  if (!/^[A-Z]{3}$/.test(report.federation)) errors.push('Falta el código de tres letras de la federación del torneo.');
  if (!report.chiefArbiter) errors.push('Falta el árbitro principal.');
  if (!date(report.startDate) || !date(report.endDate)) errors.push('Completa las fechas de inicio y fin del torneo.');
  else if (report.endDate < report.startDate) errors.push('La fecha de fin es anterior a la de inicio.');
  const seen = new Set();
  for (const p of report.players) {
    if (!p.name) errors.push('Hay un jugador sin nombre.');
    if (!/^[A-Z]{3}$/.test(p.fed)) errors.push(`${p.name}: falta la federación de tres letras.`);
    if (!p.fideId && report.ratingList !== 'fada') errors.push(`${p.name}: falta el ID FIDE.`);
    if (p.fideId.length > 11) errors.push(`${p.name}: el ID FIDE debe tener como máximo 11 cifras.`);
    if (p.fideId && seen.has(p.fideId)) errors.push(`${p.name}: ID FIDE repetido.`);
    if (p.fideId) seen.add(p.fideId);
    if (!p.sex) warnings.push(`${p.name}: sin sexo indicado.`);
    if (!p.birth || p.birth.length === 4) warnings.push(`${p.name}: ${p.birth ? 'solo consta el año de nacimiento; el campo del TRF queda vacío' : 'falta la fecha de nacimiento'}.`);
    if (ascii(p.name).length > 33) warnings.push(`${p.name}: el nombre se recorta a 33 caracteres en el TRF.`);
    if (report.ratingList === 'fada' && !p.fideId && !p.fadaId) warnings.push(`${p.name}: sin ID FIDE ni ID FADA.`);
  }
  const roundDates = Array.from({ length: t.rounds }, (_, i) => report.roundDates[i] || (report.startDate === report.endDate ? report.startDate : ''));
  if (report.roundDates.some(d => d && (d < report.startDate || d > report.endDate))) errors.push('Hay fechas de ronda fuera de las fechas del torneo.');
  if (t.status === 'finished' && roundDates.some(d => !d)) errors.push('Completa las fechas de todas las rondas del torneo.');
  return { errors, warnings, roundDates };
}

export function trfAvailability(t) {
  const [blocker] = tournamentErrors(t);
  if (blocker) return { blocker, needsData: false };
  const { errors } = reportFields(t, trfDefaults(t));
  return { blocker: errors[0] || '', needsData: errors.length > 0 };
}

export function previewTrf(t, report) {
  const blockers = tournamentErrors(t);
  const { errors: fieldErrors, warnings, roundDates } = reportFields(t, report);
  const errors = [...blockers, ...fieldErrors], total = t.rounds;
  if (blockers.length) return { errors, warnings, content: '', rounds: total };
  const games = reportGames(t);
  const national = report.format === 'trf26' && report.ratingList === 'fada';
  const playerRating = national ? 'standard' : report.ratingList;
  const rank = standings(t), byId = new Map(t.players.map(p => [p.id, p]));
  const lines = [], header = (code, value) => lines.push(`${code} ${ascii(value)}`);
  header('012', t.title); header('022', report.city); header('032', report.federation);
  header('042', report.startDate.replaceAll('-', '/')); header('052', report.endDate.replaceAll('-', '/'));
  header('062', report.players.length); header('072', report.players.filter(p => p.ratings[playerRating] > 0).length); header('082', 0);
  header('092', t.format === 'swiss' ? 'Individual: Swiss-System' : 'Individual: Round-Robin');
  header('102', report.chiefArbiter);
  report.deputyArbiters.split(';').map(x => x.trim()).filter(Boolean).forEach(a => header('112', a));
  header('122', `${t.minutes} min + ${t.increment} sec`);
  if (roundDates.some(Boolean)) lines.push('132'.padEnd(91) + roundDates.map(d => d ? d.slice(2).replaceAll('-', '/').padEnd(10) : ' '.repeat(10)).join('').trimEnd());
  if (report.format === 'trf26') {
    // Un torneo anterior puede guardar solo el sistema de la última ronda.
    const dutch = t.format === 'swiss' && t.scoring !== '3' && games.every(g => g.pairingCode === 'FIDE_DUTCH_2025');
    const system = dutch ? 'FIDE_DUTCH_2025' : t.format === 'swiss' ? 'CUSTOM_SWISS' : 'CUSTOM_ROUNDROBIN';
    header('142', total);
    if (report.ratingList === 'fada') header('172', 'ESP OTHER');
    header('182', dutch ? 'Apejupo Chess Club (BBP Pairings)' : 'Apejupo Chess Club');
    header('192', system);
    header('222', `${t.minutes * 60}${t.increment ? '+' + t.increment : ''}`);
    if (t.scoring === '2' || t.scoring === '3') lines.push(`162  W${num(Number(t.scoring).toFixed(1), 4)}    D 1.0`);
  }
  if (report.format === 'trf26' || report.ratingList === 'fada') {
    header('###', `Rating list: ${report.ratingList === 'fada' ? 'FADA (regional report)' : 'FIDE ' + report.ratingList}`);
  }
  const playerLines = [];
  for (const p of [...t.players].sort((a, b) => a.seed - b.seed)) {
    const data = report.players.find(x => x.id === p.id), place = rank.findIndex(x => x.id === p.id), points = rank[place].score ?? rank[place].points;
    const birth = date(data.birth) ? data.birth.replaceAll('-', '/') : '';
    const fideRating = data.ratings[playerRating];
    const fideId = data.fideId.length <= 11 ? data.fideId : '';
    let line = '001 ' + num(p.seed, 4) + ' ' + (data.sex === 'F' ? 'w' : data.sex === 'M' ? 'm' : ' ') + text(data.title, 3) + ' ' + text(data.name, 33) + ' ' + num(fideRating || '', 4) + ' ' + text(data.fed, 3) + ' ' + num(fideId, 11) + ' ' + text(birth, 10) + ' ' + num(points.toFixed(1), 4) + ' ' + num(place + 1, 4);
    for (let round = 1; round <= total; round++) {
      const g = games.find(g => g.round === round && (g.white === p.id || g.black === p.id));
      if (!g || g.bye) { line += `  0000 - ${g && !g.rest ? 'U' : 'Z'}`; continue; }
      const white = g.white === p.id, rival = byId.get(white ? g.black : g.white);
      requireThat(rival, 'Hay una partida con un rival desconocido.');
      const score = g.result === '1/2-1/2' ? .5 : (g.result === '1-0' || g.result === '+-') === white ? 1 : 0;
      line += `  ${num(rival.seed, 4)} ${white ? 'w' : 'b'} ${isForfeit(g.result) ? score ? '+' : '-' : score === .5 ? '=' : String(score)}`;
    }
    playerLines.push(line);
    if (national) playerLines.push('ESP ' + num(p.seed, 4) + ' '.repeat(40) + num(data.ratings.fada || '', 4) + ' '.repeat(5) + num(data.fadaId, 11));
    else if (report.ratingList === 'fada' && data.fadaId) playerLines.push(`### FADA ID ${p.seed} ${data.fadaId}`);
  }
  const content = [...lines, ...playerLines].join('\r\n') + '\r\n';
  return { errors, warnings, ...(errors.length ? { content: '', draft: content } : { content }), rounds: total,
    filename: `${ascii(t.title).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 65) || 'torneo'}-${report.ratingList}-${report.format}.trf` };
}

export function trfView(t, report = trfDefaults(t)) {
  return { report, version: t.trfVersion || 0, revision: t.revision, title: t.title, status: t.status,
    ...previewTrf(t, report) };
}
