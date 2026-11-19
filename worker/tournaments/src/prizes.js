import { requireThat, standings } from './core.js';

export const PRIZE_BODY_LIMIT = 65536;
const TYPE_NAMES = { general: 'Clasificación general', elo: 'Tramos por ELO', age: 'Tramos por edades', local: 'Jugadores locales', female: 'Mejor femenina', senior: 'Veteranos', custom: 'Personalizado' };
const TYPES = new Set(Object.keys(TYPE_NAMES));
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const within = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const fold = value => value.trim().normalize('NFC').toLocaleLowerCase('es');

function clean(value, max, label, required = false) {
  requireThat(typeof value === 'string' && value.length <= max, `${label}: usa hasta ${max} caracteres.`);
  const result = value.trim();
  requireThat(!required || result, `${label}: completa este campo.`);
  return result;
}

// Como en RondaSwiss: los tramos (ELO y edades) son puestos con su propio límite.
//  · Tramos por ELO: «< 1.400», «< 1.600»… Cada tramo es un rango cerrado: desde el límite
//    del tramo anterior (0 en el primero) hasta su límite menos uno. Sin ELO no se opta.
//  · Tramos por edades: «Sub 18» (edad ≤ 18). Veteranos: «Supra 50» (edad ≥ 50).
//  · Cada tramo puede tener varios premiados (1.º Sub 15, 2.º Sub 15…), en el orden de la lista.
//  · La edad es el año de inicio del torneo menos el año de nacimiento.
export const TIERED = new Set(['elo', 'age', 'senior']);
const LIMITS = { elo: [1, 4000], age: [1, 120], senior: [1, 120] };

// Configuraciones guardadas con el modelo anterior (un solo ELO máximo o una sola edad por categoría).
function upgrade(category) {
  const { min, max, age, accumulates, includeUnrated, ...rest } = category;
  if (!TIERED.has(category.type)) return rest;
  const limit = category.type === 'elo' ? (max ?? 1799) + 1 : age ?? (category.type === 'senior' ? 50 : 18);
  // Los puestos 1.º, 2.º… del modelo anterior pasan a ser varios premiados del mismo tramo.
  return { ...rest, positions: category.positions.map(position => Number.isInteger(position.limit) ? position : { ...position, limit }) };
}

export function savedPrizes(tournament) {
  const prizes = isRecord(tournament.prizes) ? tournament.prizes : {};
  return {
    version: tournament.prizeVersion || 0,
    notes: typeof tournament.prizes === 'string' ? tournament.prizes : prizes.notes || '',
    // «Premios acumulativos» vale para todas las categorías (antes se marcaba en cada una).
    accumulates: prizes.accumulates ?? (prizes.categories || []).some(category => category.accumulates === true),
    categories: (prizes.categories || []).map(upgrade),
  };
}

export function validatePrizes(input, players) {
  requireThat(isRecord(input) && Array.isArray(input.categories) && input.categories.length <= 20, 'Puedes guardar hasta 20 categorías.');
  // Cada plantilla se usa una sola vez: las categorías no se duplican.
  const repeated = [...TYPES].find(type => input.categories.filter(category => category?.type === type).length > 1);
  requireThat(!repeated, `Solo puede haber una categoría «${TYPE_NAMES[repeated]}».`);
  const notes = clean(input.notes ?? '', 600, 'Notas');
  const accumulates = input.accumulates === true;
  let count = 0;
  const roster = new Set(players.map(player => player.id));
  const manualWinners = new Set();
  const names = new Set();
  const categories = input.categories.map(raw => {
    requireThat(isRecord(raw) && TYPES.has(raw.type), 'Elige una plantilla de premios válida.');
    const name = clean(raw.name, 60, 'Nombre de la categoría', true);
    requireThat(!names.has(fold(name)), `Ya hay una categoría llamada «${name}».`);
    names.add(fold(name));
    const category = { type: raw.type, name };
    if (raw.type === 'local') category.club = clean(raw.club, 80, `Club de «${name}»`, true);
    requireThat(Array.isArray(raw.positions) && raw.positions.length >= 1 && raw.positions.length <= 20, `«${name}»: añade entre 1 y 20 puestos.`);
    count += raw.positions.length;
    requireThat(count <= 100, 'Puedes guardar hasta 100 puestos premiados en total.');
    const tiered = TIERED.has(raw.type);
    const inCategory = new Set();
    category.positions = raw.positions.map((entry, index) => {
      const label = `«${name}», puesto ${index + 1}`;
      requireThat(isRecord(entry) && within(entry.cents, 0, 10000000), `${label}: revisa el importe.`);
      const item = clean(entry.item ?? '', 100, label);
      requireThat(entry.cents > 0 || item, `${label}: añade un importe o un premio en especie.`);
      const position = { cents: entry.cents, item };
      if (tiered) {
        const [min, max] = LIMITS[raw.type];
        requireThat(within(entry.limit, min, max), raw.type === 'elo'
          ? `«${name}»: cada tramo necesita un ELO entre ${min} y ${max}.`
          : `«${name}»: cada tramo necesita una edad entre ${min} y ${max} años.`);
        position.limit = entry.limit;
      } else {
        requireThat(index === 0 || entry.cents <= raw.positions[index - 1].cents, `«${name}»: ordena los importes de mayor a menor.`);
      }
      // Ganador elegido a mano (en cualquier puesto, como en RondaSwiss): manda sobre el automático.
      if (entry.winnerId) {
        requireThat(roster.has(entry.winnerId), `${label}: el ganador ya no está en el torneo.`);
        requireThat(!inCategory.has(entry.winnerId), `«${name}»: el mismo jugador figura en dos puestos.`);
        requireThat(accumulates || !manualWinners.has(entry.winnerId), 'Un jugador tiene dos premios manuales no acumulables.');
        inCategory.add(entry.winnerId);
        manualWinners.add(entry.winnerId);
        position.winnerId = entry.winnerId;
      } else if (entry.vacant === true) {
        // En blanco a propósito: no se asigna automáticamente y en la hoja queda el hueco para escribirlo a mano.
        position.vacant = true;
      } else if (entry.winnerName) {
        // Nombre escrito a mano que no es de ningún inscrito: se muestra tal cual y no quita premios a nadie.
        const winnerName = clean(entry.winnerName, 100, `${label}: ganador`);
        if (winnerName) position.winnerName = winnerName;
      }
      return position;
    });
    if (tiered) {
      // Los tramos van siempre de menor a mayor; dentro de un tramo se respeta el orden (1.º, 2.º…).
      category.positions.sort((a, b) => a.limit - b.limit);
    }
    return category;
  });
  return { accumulates, categories, notes };
}

// Rango cerrado de un tramo de ELO: [límite del tramo anterior, límite − 1].
export function eloRange(category, position) {
  const lower = Math.max(0, ...category.positions.map(other => other.limit).filter(limit => limit < position.limit));
  return [lower, position.limit - 1];
}

function eligible(player, category, position, year, club) {
  const age = player.birth && player.birth <= year ? year - player.birth : null;
  switch (category.type) {
    case 'general': return true;
    case 'elo': {
      if (!player.rating) return false; // sin ELO no optan a los tramos
      const [min, max] = eloRange(category, position);
      return player.rating >= min && player.rating <= max;
    }
    case 'age': return age !== null && age <= position.limit;
    case 'senior': return age !== null && age >= position.limit;
    case 'female': return player.sex === 'F';
    case 'local': return fold(club || '') === fold(category.club);
    default: return false;
  }
}

// Año con el que se calculan las edades: el de inicio del torneo.
export const prizeYear = tournament => new Date(tournament.startsAt || tournament.createdAt).getUTCFullYear();

export function prizeResults(tournament, config) {
  const players = new Map(tournament.players.map(player => [player.id, player]));
  const ranked = tournament.status === 'waiting' ? [] : standings(tournament).filter(player => player.played > 0 || player.byes > 0 && player.points > 0);
  const year = prizeYear(tournament);
  const accumulates = config.accumulates === true;
  const taken = new Set();
  const byCategory = config.categories.map(() => new Set());
  const rows = config.categories.flatMap((category, group) => category.positions.map((entry, place) => {
    const manual = entry.winnerId ? players.get(entry.winnerId) : null;
    if (manual) (accumulates ? byCategory[group] : taken).add(manual.id);
    const written = !manual && entry.winnerName ? entry.winnerName : '';
    const vacant = !manual && !written && entry.vacant === true;
    return { group, place, cents: entry.cents, item: entry.item, winner: manual?.name || written, winnerId: manual?.id || '', skipped: 0, manual: !!(manual || written || vacant), vacant };
  }));
  // Los puestos con ganador a mano ya están asignados; «Personalizado» solo se asigna a mano.
  const automatic = rows.filter(row => !row.manual && config.categories[row.group].type !== 'custom');
  // Acumulativos: cada categoría por su orden de puestos y nadie repite dentro de la misma.
  // No acumulativos: un premio por jugador, el de mayor importe; con el mismo importe, el de la
  // categoría que va antes en la lista configurada (el orden se cambia arrastrando).
  automatic.sort((a, b) => accumulates
    ? a.group - b.group || a.place - b.place
    : b.cents - a.cents || a.group - b.group || a.place - b.place);
  for (const row of automatic) {
    const category = config.categories[row.group], position = category.positions[row.place];
    const excluded = accumulates ? byCategory[row.group] : taken;
    for (const player of ranked) {
      if (!eligible(player, category, position, year, players.get(player.id)?.club)) continue;
      if (excluded.has(player.id)) {
        if (!accumulates && !byCategory[row.group].has(player.id)) row.skipped++;
        continue;
      }
      row.winner = player.name; row.winnerId = player.id;
      excluded.add(player.id);
      byCategory[row.group].add(player.id);
      break;
    }
  }
  return rows;
}
