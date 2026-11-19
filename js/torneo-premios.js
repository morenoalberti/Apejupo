const templates = {
  general: ['Clasificación general', 'Premios para los primeros puestos del torneo.', '<path d="M8 21h8m-4-4v4M7 3h10v8a5 5 0 0 1-10 0V3ZM7 5H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4"/>'],
  elo: ['Tramos por ELO', 'Un premio por tramo, p. ej. < 1.400, < 1.600, < 1.800.', '<path d="M3 21h18M5 17v-5m5 5V9m5 8V6m5 11V3"/>'],
  age: ['Tramos por edades', 'Un premio por edad, p. ej. Sub 12, Sub 16, Sub 18.', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h3"/>'],
  local: ['Jugadores locales', 'Reserva premios para los jugadores de un club.', '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>'],
  female: ['Mejor femenina', 'Premia a las jugadoras mejor clasificadas.', '<circle cx="12" cy="8" r="5"/><path d="M12 13v8m-3-3h6"/>'],
  senior: ['Veteranos', 'A partir de una edad, p. ej. Supra 50 y Supra 65.', '<circle cx="12" cy="8" r="5"/><path d="m9 12-2 9 5-3 5 3-2-9"/>'],
  custom: ['Personalizado', 'Define un premio especial y elige al ganador.', '<path d="m12 3 3 5.8 6.5 1-4.7 4.6 1.1 6.5-5.9-3.1-5.9 3.1 1.1-6.5-4.7-4.6 6.5-1z"/>'],
};
const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const euros = cents => money.format(cents / 100);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const blankPosition = () => ({ cents: 0, item: '' });
const TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v7m4-7v7"/></svg>';
// Tramos como en RondaSwiss: cada puesto lleva su límite (ELO < límite, Sub edad, Supra edad).
const tiers = {
  elo: { adder: 'ELO menor que <', min: 1, max: 4000, step: 100, start: 1800, label: limit => `Sub ${limit}` },
  age: { adder: 'Edad hasta (Sub)', min: 1, max: 120, step: 2, start: 18, label: limit => `Sub ${limit}` },
  senior: { adder: 'Edad desde (Supra)', min: 1, max: 120, step: 15, start: 50, label: limit => `Supra ${limit}` },
};
// Puesto dentro de su tramo (1.º, 2.º…) y cuántos premiados tiene ese tramo.
function tierPlace(category, index) {
  const limit = category.positions[index].limit, same = category.positions.filter(other => other.limit === limit);
  return { place: category.positions.slice(0, index + 1).filter(other => other.limit === limit).length, total: same.length };
}
// Etiqueta de cada puesto: «< 1.400», «Sub 18» (o «1.º Sub 15», «2.º Sub 15» si el tramo tiene varios), «1.º Local» o «1.º».
function positionLabel(category, index) {
  const tier = tiers[category.type];
  if (!tier) return `${index + 1}.º${category.type === 'local' ? ' Local' : ''}`;
  const { place, total } = tierPlace(category, index), label = tier.label(category.positions[index].limit);
  return total > 1 ? `${place}.º ${label}` : label;
}
// Premio de un puesto: el importe y el premio en especie juntos («100,00 € + Trofeo»).
const prizeText = row => [row.cents ? euros(row.cents) : '', row.item].filter(Boolean).join(' + ') || '—';
const fold = value => String(value || '').trim().normalize('NFC').toLocaleLowerCase('es');
// Quién puede llevarse un puesto: las mismas condiciones que usa el servidor para el reparto automático.
function canWin(player, category, position, year) {
  const age = player.birth && year && player.birth <= year ? year - player.birth : null;
  switch (category.type) {
    case 'elo': {
      if (!player.rating) return false;
      const lower = Math.max(0, ...category.positions.map(other => other.limit).filter(limit => limit < position.limit));
      return player.rating >= lower && player.rating < position.limit;
    }
    case 'age': return age !== null && age <= position.limit;
    case 'senior': return age !== null && age >= position.limit;
    case 'female': return player.sex === 'F';
    case 'local': return !!category.club && fold(player.club) === fold(category.club);
    default: return true;
  }
}
// En los desplegables los jugadores salen por orden alfabético.
const alphabetical = list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
const icon = type => `<span class="pr-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${templates[type][2]}</svg></span>`;

function input(label, key, value, attrs = '', wide = false) {
  return `<label${wide ? ' class="pr-full"' : ''}>${label}<input name="${key}" value="${esc(value)}" ${attrs}></label>`;
}

export function createPrizePanel({ request, confirm, print }) {
  const dialog = document.getElementById('to-prizes-dialog');
  const get = suffix => document.getElementById('to-prizes-' + suffix);
  const action = key => dialog.querySelector(`[data-pr-action="${key}"]`);
  let config, players, title, preview;
  let selected = 0, dirty = false, current = 'setup', busy = false;
  let generation = 0;

  // Abajo a la izquierda se ve siempre si hay cambios sin guardar, si se guardaron o si falló el guardado.
  function feedback(value, error = false) {
    get('error').hidden = true; // el aviso de arriba ya no se usa: todo se ve abajo y se borra al cambiar algo
    const status = get('feedback');
    status.textContent = error ? (dirty ? `No se han guardado los cambios: ${value}` : value)
      : value || (dirty ? 'Cambios sin guardar' : 'Sin cambios pendientes');
    status.dataset.state = error ? 'error' : dirty ? 'dirty' : value === 'Cambios guardados' ? 'saved' : 'clean';
  }
  function updateBudget() {
    const amount = config.categories.reduce((sum, category) => sum + category.positions.reduce((total, item) => total + item.cents, 0), 0);
    get('total').textContent = euros(amount);
  }
  function renderCategories() {
    // Con todas las plantillas ya configuradas no queda nada que añadir.
    action('templates').hidden = Object.keys(templates).every(type => config.categories.some(category => category.type === type));
    if (!get('templates').hidden) showTemplates(!action('templates').hidden); // lista abierta: al día con lo configurado
    // Cada categoría se arrastra entera; la X de arriba a la derecha (visible al pasar el ratón) la quita.
    get('categories').innerHTML = config.categories.map((category, index) => {
      const name = esc(category.name || templates[category.type][0]);
      return `<div class="pr-cat" data-index="${index}"><button class="btn-ghost" type="button" draggable="true" title="Arrastra para cambiar el orden" data-pr-action="select" data-index="${index}" aria-pressed="${index === selected}">${icon(category.type)}<span>${name}<small>${category.positions.length} ${category.positions.length === 1 ? 'puesto' : 'puestos'}</small></span></button><button class="pr-cat-remove" type="button" data-pr-action="remove" data-index="${index}" title="Quitar categoría" aria-label="Quitar ${name}">×</button></div>`;
    }).join('');
  }
  function showTemplates(open, focus = false) {
    const list = get('templates');
    list.hidden = !open;
    action('templates').setAttribute('aria-expanded', String(open));
    if (!open) return;
    // Solo las plantillas que aún no están configuradas: las categorías no se duplican.
    list.innerHTML = '<p class="pr-menu-title">Plantillas de categoría</p>' + Object.entries(templates).filter(([type]) => !config.categories.some(category => category.type === type)).map(([type, [name, description]]) =>
      `<button class="btn-ghost" type="button" data-pr-action="add-category" data-type="${type}">${icon(type)}<span>${name}<small>${description}</small></span></button>`).join('');
    // El menú no pasa del borde inferior de la ventana: si no cabe, se desplaza por dentro.
    const room = dialog.getBoundingClientRect().bottom - action('templates').getBoundingClientRect().bottom - 18;
    list.style.maxHeight = `${Math.max(180, room)}px`;
    if (focus) list.querySelector('button')?.focus();
  }
  function renderEditor() {
    const category = config.categories[selected];
    const form = get('editor');
    // «Premios acumulativos» va en el pie, a la izquierda de «Cerrar», y vale para todas las categorías.
    get('accumulates-label').hidden = false;
    get('accumulates').checked = config.accumulates === true;
    if (!category) {
      form.innerHTML = '<h3>Premios del torneo</h3><p class="pr-meta">Añade una categoría para elegir los puestos premiados.</p>';
      return;
    }
    const { type, positions } = category;
    // El nombre comparte línea con el club en «Jugadores locales»; en las demás ocupa la fila entera.
    const fields = [input('Nombre de la categoría', 'name', category.name, 'required maxlength="60"', type !== 'local')];
    if (type === 'local') {
      const clubs = [...new Set(players.map(player => player.club).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      fields.push(input('Club', 'club', category.club, 'list="to-prizes-clubs" maxlength="80" required'));
      fields.push(`<datalist id="to-prizes-clubs">${clubs.map(club => `<option value="${esc(club)}"></option>`).join('')}</datalist>`);
      fields.push('<small class="pr-meta pr-full">Se usa el club de la ficha del jugador.</small>');
    }
    const tier = tiers[type];
    const rows = positions.map((position, index) => {
      const n = index + 1;
      const manual = type === 'custom' ? `<label class="pr-manual">Ganador del puesto ${n}${winnerField(position, null, alphabetical(players), `data-group="${selected}" data-place="${index}"`)}</label>` : '';
      return `<div class="pr-position"><b>${esc(positionLabel(category, index))}</b>
        <label>Importe (€)<input name="cents" data-position="${index}" aria-label="Importe del puesto ${n}" type="number" min="0" max="100000" step=".01" value="${position.cents / 100}"></label>
        <label>Premio en especie<input name="item" data-position="${index}" aria-label="Premio en especie del puesto ${n}" maxlength="100" value="${esc(position.item)}" placeholder="Ej. Trofeo"></label>
        <button class="btn-ghost pr-trash" type="button" data-pr-action="remove-slot" data-index="${index}" title="Quitar" aria-label="Quitar ${esc(positionLabel(category, index))}" ${positions.length === 1 ? 'disabled' : ''}>${TRASH}</button>${manual}
      </div>`;
    }).join('');
    // En los tramos se escribe el límite y se añade; se colocan solos de menor a mayor.
    const next = tier && positions.length ? Math.min(tier.max, Math.max(...positions.map(position => position.limit)) + tier.step) : tier?.start;
    const adder = tier
      ? `<div class="pr-tier-adder"><label>${tier.adder}<input id="to-prizes-tier" type="number" min="${tier.min}" max="${tier.max}" value="${next}"></label><button class="btn pr-small" type="button" data-pr-action="add-tier" ${positions.length >= 20 ? 'disabled' : ''}>＋ Añadir</button></div>`
      : `<button class="btn pr-small pr-add-slot" type="button" data-pr-action="add-slot" ${positions.length >= 20 ? 'disabled' : ''}>＋ Añadir</button>`;
    form.innerHTML = `<h3 class="pr-title">${icon(type)}${templates[type][0]}</h3><div class="pr-fields">${fields.join('')}</div>
      <section class="pr-section" aria-label="Puestos premiados"><div class="pr-section-head"><h3>${tier ? 'Tramos premiados' : 'Puestos premiados'}</h3>${tier ? adder : ''}</div>
        <div class="pr-positions">${rows}</div>${tier ? '' : `<div class="pr-add-row">${adder}</div>`}</section>`;
  }
  function changed() {
    dirty = true;
    feedback('Cambios sin guardar');
    updateBudget();
  }
  function show(view) {
    current = view;
    get('setup').hidden = view !== 'setup';
    get('results').hidden = view !== 'winners';
    action('setup').setAttribute('aria-pressed', String(view === 'setup'));
    action('winners').setAttribute('aria-pressed', String(view === 'winners'));
    action('print').hidden = view !== 'winners' || !preview?.results.length;
    dialog.querySelector('.pr-add').hidden = view !== 'setup'; // ni categorías que añadir
    if (view !== 'setup') showTemplates(false);
    get('accumulates-label').hidden = view !== 'setup';
    if (view === 'setup') { renderCategories(); renderEditor(); }
  }
  // Desplegable del ganador. La primera opción va en blanco: deja el premio sin nadie para escribirlo a mano
  // en la hoja impresa. Debajo, los jugadores que pueden llevárselo (en la general, todos), por orden alfabético
  // y sin repetir; el que da la clasificación sale marcado y es la opción del reparto automático.
  const BLANK = '__blank';
  function winnerField(position, row, list, data) {
    const chosen = position.winnerId || '', auto = !chosen && !position.vacant && row?.winnerId ? row.winnerId : '';
    const blankValue = auto || chosen ? BLANK : '';
    const extra = [];
    if (chosen && !list.some(player => player.id === chosen)) extra.push({ id: chosen, name: players.find(player => player.id === chosen)?.name || 'Jugador ya no inscrito' });
    if (auto && !list.some(player => player.id === auto)) extra.push({ id: auto, name: row.winner });
    const options = alphabetical([...extra, ...list]).map(player => player.id === auto
      ? `<option value="" selected>${esc(player.name)}</option>`
      : `<option value="${esc(player.id)}" ${player.id === chosen ? 'selected' : ''}>${esc(player.name)}</option>`).join('');
    const select = `<select class="pr-winner" ${data} aria-label="Ganador"><option value="${blankValue}" ${!auto && !chosen ? 'selected' : ''}></option>${options}</select>`;
    // Con la opción en blanco el árbitro escribe el nombre a mano (si lo deja vacío, en la hoja queda la línea para rellenar).
    const typing = !chosen && !auto;
    return typing
      ? `<span class="pr-winner-box">${select}<input class="pr-winner-name" type="text" ${data} value="${esc(position.winnerName || '')}" placeholder="Escribe el nombre" maxlength="100" autocomplete="off" aria-label="Nombre del ganador escrito a mano"></span>`
      : select;
  }
  // Nombre escrito a mano en la casilla junto al desplegable.
  function applyWrittenName(position, text, keepBlank) {
    const value = text.trim();
    delete position.winnerId; delete position.winnerName; delete position.vacant;
    if (value) position.winnerName = value;
    else if (keepBlank) position.vacant = true;
  }
  // Lo elegido: un jugador, el automático o el blanco (a propósito, sin nadie).
  function applyWinner(position, value) {
    delete position.winnerId; delete position.winnerName; delete position.vacant;
    if (value === BLANK) position.vacant = true;
    else if (value) position.winnerId = value;
  }
  // Cada fila: «1.º Eugenio Martínez» o, en los tramos, «1.º Sub 1800 Mariano Pineda». Los tramos van de
  // mayor a menor (Sub 2000, Sub 1800…; Sub 18, Sub 16…) y, dentro de cada uno, 1.º, 2.º…
  function sheetMarkup(editable = false) {
    const sections = config.categories.map((category, group) => {
      const tier = tiers[category.type];
      // Al imprimir solo salen los premios con un nombre asignado; la categoría sin ninguno no sale.
      const results = preview.results.filter(row => row.group === group && (editable || row.winner));
      if (!results.length && !editable) return '';
      if (tier) results.sort((a, b) => (category.positions[b.place]?.limit ?? 0) - (category.positions[a.place]?.limit ?? 0) || a.place - b.place);
      const rows = results.map(row => {
        const position = category.positions[row.place];
        const label = tier && position ? `${tierPlace(category, row.place).place}.º ${tier.label(position.limit)}` : positionLabel(category, row.place);
        const skipped = row.skipped ? `<small>${row.skipped} ${row.skipped === 1 ? 'jugador ya premiado' : 'jugadores ya premiados'}</small>` : '';
        // En pantalla el ganador se elige en el desplegable; en la impresión sale el nombre (o el hueco en blanco).
        const who = editable && position
          ? winnerField(position, row, players.filter(player => canWin(player, category, position, preview.year)), `data-group="${group}" data-place="${row.place}"`)
          : row.vacant ? '<span class="pr-blank-line"></span>' : esc(row.winner || 'Por asignar');
        return `<tr><td class="to-print-name"><span class="pr-place">${esc(label)}</span> ${who}${skipped}</td><td>${esc(prizeText(row))}</td></tr>`;
      }).join('');
      // El título de la categoría va en la cabecera de su tabla, pegado a la raya, en la misma línea que «Premio».
      return `<section class="pr-result-group"><table class="pr-results-table">
        <thead><tr><th class="to-print-name pr-title-cell" scope="col"><h3 class="pr-title">${icon(category.type)}${esc(category.name)}</h3></th><th>Premio</th></tr></thead><tbody>${rows}</tbody>
      </table></section>`;
    }).join('');
    return sections;
  }
  function renderResults() {
    const progress = preview.status === 'waiting' ? 'Pendiente de inicio' : preview.status === 'finished' ? 'Premios definitivos' : `Reparto provisional${preview.round ? ' · Ronda ' + preview.round : ''}`;
    get('result-status').textContent = progress + (dirty ? ' · Cambios sin guardar' : '');
    get('sheet').innerHTML = config.categories.length ? sheetMarkup(true) : '<p class="pr-meta">Añade una categoría para calcular el reparto.</p>';
  }
  function lock(value) {
    busy = value;
    for (const section of dialog.querySelectorAll('.pr-add, .pr-nav, .pr-layout, .pr-footer, .pr-result-header')) section.inert = value;
    dialog.setAttribute('aria-busy', String(value));
  }
  async function run(operation) {
    if (busy) return;
    const ticket = generation;
    lock(true);
    try {
      const { data, apply } = await operation();
      if (ticket === generation && dialog.open) apply(data);
    } catch (error) {
      if (ticket === generation && dialog.open) feedback(error.message, true);
    } finally {
      if (ticket === generation) lock(false);
    }
  }
  function loadWinners() {
    return run(async () => ({
      data: await request(dirty ? { preview: config } : {}),
      apply(data) {
        players = data.players;
        if (!dirty) { config = data.config; updateBudget(); }
        preview = data; renderResults(); show('winners');
        feedback(dirty ? 'Cambios sin guardar' : '');
      },
    }));
  }
  function save() {
    if (current === 'setup' && !get('editor').reportValidity()) return;
    return run(async () => ({
      data: await request({ config, version: config.version }),
      apply(data) {
        config = data.config; preview = data; players = data.players; dirty = false;
        updateBudget();
        if (current === 'winners') renderResults();
        show(current);
        feedback('Cambios guardados');
      },
    }));
  }
  async function close() {
    if (busy) return;
    if (!dirty || await confirm('Descartar cambios de los premios', 'Los cambios pendientes se perderán.')) dialog.close();
  }

  // Esc con el menú de plantillas abierto solo cierra el menú.
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (!get('templates').hidden) { showTemplates(false); action('templates').focus(); return; }
    close();
  });
  // El menú de «Añadir categoría» se despliega a la derecha, encima de todo, y se cierra al pulsar fuera.
  dialog.addEventListener('pointerdown', event => { if (!get('templates').hidden && !event.target.closest('.pr-add')) showTemplates(false); });
  dialog.addEventListener('close', () => { if (!dialog.open) { generation++; lock(false); } });
  // Orden de las categorías: se arrastran con el ratón y las demás se apartan para dejar el hueco.
  let dragged = null, dropped = false;
  const list = get('categories');
  const items = () => [...list.querySelectorAll('.pr-cat')];
  // Mueve la categoría arrastrada en la lista y anima a las demás hasta su nuevo sitio.
  function moveTo(reference) {
    const before = new Map(items().map(el => [el, el.getBoundingClientRect().top]));
    list.insertBefore(dragged, reference);
    for (const el of items()) {
      const shift = before.get(el) - el.getBoundingClientRect().top;
      if (!shift || el === dragged) continue;
      el.style.transition = 'none'; el.style.transform = `translateY(${shift}px)`;
      requestAnimationFrame(() => { el.style.transition = 'transform .16s ease'; el.style.transform = ''; });
    }
  }
  list.addEventListener('dragstart', event => {
    const item = event.target.closest('.pr-cat');
    if (!item || busy) { event.preventDefault(); return; }
    dragged = item; dropped = false;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.dataset.index);
    // Tras capturar la imagen que sigue al ratón, la categoría queda como hueco vacío.
    requestAnimationFrame(() => item.classList.add('pr-dragging'));
  });
  list.addEventListener('dragover', event => {
    if (!dragged) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest('.pr-cat');
    if (!target || target === dragged || target.style.transform) return;
    const box = target.getBoundingClientRect(), after = event.clientY > box.top + box.height / 2;
    const reference = after ? target.nextElementSibling : target;
    if (reference !== dragged && reference !== dragged.nextElementSibling) moveTo(reference);
  });
  list.addEventListener('drop', event => { if (dragged) { event.preventDefault(); dropped = true; } });
  list.addEventListener('dragend', () => {
    if (!dragged) return;
    const order = items().map(el => Number(el.dataset.index));
    const current = config.categories[selected], moved = config.categories[Number(dragged.dataset.index)];
    dragged = null;
    if (dropped && order.some((value, index) => value !== index)) {
      config.categories = order.map(index => config.categories[index]);
      selected = config.categories.indexOf(moved);
      changed(); show('setup');
    } else {
      selected = Math.max(0, config.categories.indexOf(current));
      renderCategories(); // soltada fuera o cancelada con Esc: vuelve al orden anterior
    }
  });
  get('accumulates').addEventListener('change', event => { config.accumulates = event.target.checked; changed(); });
  get('editor').addEventListener('submit', event => { event.preventDefault(); save(); });
  // Ganador cambiado a mano en «Ganadores»: se recalcula el resto del reparto y queda pendiente de «Guardar premios».
  get('sheet').addEventListener('change', event => {
    const field = event.target.closest('.pr-winner, .pr-winner-name');
    if (!field || busy) return;
    const { group, place } = field.dataset;
    const position = config.categories[Number(group)]?.positions[Number(place)];
    if (!position) return;
    const blank = field.classList.contains('pr-winner') && field.value === BLANK;
    if (field.classList.contains('pr-winner-name')) applyWrittenName(position, field.value, true);
    else applyWinner(position, field.value);
    changed();
    // Al elegir el blanco se abre la casilla para escribir el nombre.
    loadWinners().then(() => { if (blank) get('sheet').querySelector(`.pr-winner-name[data-group="${group}"][data-place="${place}"]`)?.focus(); });
  });
  // «Personalizado» en el editor: la misma casilla para elegir o escribir el ganador.
  get('editor').addEventListener('change', event => {
    const field = event.target.closest('.pr-winner, .pr-winner-name');
    const position = field && config.categories[Number(field.dataset.group)]?.positions[Number(field.dataset.place)];
    if (!position) return;
    if (field.classList.contains('pr-winner-name')) applyWrittenName(position, field.value, false);
    else { applyWinner(position, field.value === BLANK ? '' : field.value); renderEditor(); }
    changed();
  });
  get('editor').addEventListener('input', event => {
    const field = event.target;
    if (!field.name) return;
    const category = config.categories[selected];
    const target = field.dataset.position === undefined ? category : category.positions[Number(field.dataset.position)];
    const value = field.type === 'checkbox' ? field.checked : field.type === 'number' ? (field.valueAsNumber || 0) : field.value;
    target[field.name] = field.name === 'cents' ? Math.round(value * 100) : value;
    changed();
  });
  get('editor').addEventListener('change', event => { if (event.target.name === 'name') renderCategories(); });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button[data-pr-action]');
    if (!button || busy) return;
    const { prAction, type, index } = button.dataset;
    const category = config.categories[selected];
    const numericIndex = Number(index);
    if (prAction === 'setup') { show('setup'); return; }
    if (prAction === 'refresh') {
      // «Actualizar» vuelve al reparto automático: quita los ganadores elegidos a mano
      // (salvo en «Personalizado», que solo se asigna a mano) y recalcula con la clasificación.
      let cleared = false;
      for (const entry of config.categories.filter(entry => entry.type !== 'custom')) {
        for (const position of entry.positions) if (position.winnerId || position.winnerName || position.vacant) { delete position.winnerId; delete position.winnerName; delete position.vacant; cleared = true; }
      }
      if (cleared) changed();
      await loadWinners();
      return;
    }
    if (prAction === 'winners') { await loadWinners(); return; }
    if (prAction === 'save') { await save(); return; }
    if (prAction === 'close') { await close(); return; }
    if (prAction === 'print') {
      print(`<header><p class="to-print-brand">APEJUPO · CHESS CLUB</p><h1>${esc(title)}</h1><h2>Hoja de premios</h2><p class="to-print-meta">${esc(get('result-status').textContent)} · Bolsa total ${esc(get('total').textContent)}</p></header>${sheetMarkup()}`);
      return;
    }
    if (prAction === 'templates') { showTemplates(get('templates').hidden, true); return; }
    if (prAction === 'select') { selected = numericIndex; show('setup'); return; }
    if (prAction === 'add-category') {
      if (config.categories.some(entry => entry.type === type)) { showTemplates(false); return; }
      if (config.categories.length >= 20) { feedback('Puedes guardar hasta 20 categorías.', true); return; }
      const positions = type === 'general' ? Array.from({ length: 3 }, blankPosition) : [{ ...blankPosition(), ...(tiers[type] ? { limit: tiers[type].start } : {}) }];
      config.categories.push({ type, name: templates[type][0], ...(type === 'local' ? { club: '' } : {}), positions });
      selected = config.categories.length - 1;
      showTemplates(false);
    } else if (prAction === 'add-slot' && category.positions.length < 20) {
      category.positions.push(blankPosition());
    } else if (prAction === 'add-tier' && category.positions.length < 20) {
      const tier = tiers[category.type], field = get('tier'), limit = field.valueAsNumber;
      if (!Number.isInteger(limit) || limit < tier.min || limit > tier.max) { field.reportValidity(); feedback(`Escribe un número entre ${tier.min} y ${tier.max}.`, true); return; }
      // Si el tramo ya existe se añade otro premiado (2.º, 3.º…) detrás de los que ya tiene.
      const at = category.positions.filter(position => position.limit <= limit).length;
      category.positions.splice(at, 0, { ...blankPosition(), limit });
      feedback('');
    } else if (prAction === 'remove-slot' && category.positions.length > 1) {
      category.positions.splice(numericIndex, 1);
    } else if (prAction === 'remove') {
      const removed = config.categories[numericIndex];
      if (!removed || !await confirm(`Quitar «${removed.name}»`, 'Se quitarán todos sus puestos al guardar.', true) || !dialog.open) return;
      config.categories.splice(numericIndex, 1);
      if (numericIndex < selected) selected--;
      selected = Math.max(0, Math.min(selected, config.categories.length - 1));
    } else return;
    changed();
    show('setup');
    if (prAction === 'add-category') get('editor').elements.namedItem('name')?.focus();
  });
  return {
    open(data, tournamentTitle) {
      generation++; lock(false);
      config = data.config; players = data.players; preview = data; title = tournamentTitle;
      selected = 0; dirty = false;
      get('tournament').textContent = title;
      updateBudget(); feedback(''); showTemplates(false);
      if (data.status === 'finished' && config.categories.length) {
        renderResults(); show('winners');
      } else {
        show('setup');
      }
      dialog.showModal();
    },
  };
}
