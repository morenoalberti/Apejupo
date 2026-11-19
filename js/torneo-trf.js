const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const listNames = { standard: 'FIDE Estándar', rapid: 'FIDE Rápido', blitz: 'FIDE Blitz', fada: 'FADA' };
const formatOptions = '<option value="trf16">TRF-16</option><option value="trf26">TRF-26</option>';

export function createTrfPanel({ request, lookup }) {
  const button = document.createElement('button');
  button.id = 'to-trf-open'; button.className = 'btn-ghost to-icon-btn';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h8"/></svg>TRF';
  const editButton = document.createElement('button');
  editButton.id = 'to-trf-edit'; editButton.className = 'btn-ghost';
  editButton.textContent = 'Datos del informe';
  for (const trigger of [button, editButton]) {
    trigger.type = 'button'; trigger.hidden = true; trigger.disabled = true;
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', 'to-trf-dialog');
  }
  document.getElementById('to-prizes-edit').after(button, editButton);
  const dialog = document.createElement('dialog'); dialog.id = 'to-trf-dialog'; dialog.className = 'to-dialog trf-dialog'; dialog.setAttribute('aria-labelledby', 'trf-title');
  dialog.innerHTML = `<section id="trf-view" class="trf-view" hidden>
    <header class="trf-view-header"><h2 id="trf-view-title">Vista previa TRF-16</h2><label>Formato<select id="trf-view-format">${formatOptions}</select></label></header>
    <div class="trf-view-document"><p id="trf-view-summary" role="status"></p><pre id="trf-preview" tabindex="0" aria-label="Contenido del fichero TRF"></pre></div>
    <footer class="trf-view-footer"><button type="button" class="btn-ghost" data-trf-action="edit">Datos del informe</button><div class="to-actions"><button type="button" class="btn" data-trf-action="download" disabled>Guardar TRF</button><button type="button" class="btn-ghost" data-trf-action="close">Cerrar</button></div></footer>
    </section><section id="trf-editor" hidden><header class="trf-heading"><div><h2 id="trf-title">Datos del informe TRF</h2><p id="trf-tournament" class="muted"></p></div><button type="button" data-trf-action="close" class="btn-ghost" aria-label="Cerrar exportación TRF">✕</button></header>
    <form id="trf-form"><div class="trf-grid">
      <label>Formato<select name="format">${formatOptions}</select></label>
      <label>Elo del informe<select name="ratingList">${Object.entries(listNames).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <label>Ciudad<input name="city" maxlength="120" required></label><label>Federación del torneo<input name="federation" maxlength="3" placeholder="ESP" required></label>
      <label>Fecha de inicio<input name="startDate" type="date" required></label><label>Fecha de fin<input name="endDate" type="date" required></label>
      <label>Árbitro principal<input name="chiefArbiter" maxlength="120" required></label><label>Árbitros adjuntos<input name="deputyArbiters" maxlength="1000" placeholder="Separados por punto y coma"></label>
    </div>
    <details class="trf-round-dates"><summary>Fechas de las rondas</summary><div id="trf-round-dates" class="trf-grid"></div></details>
    <section class="trf-players-section" aria-labelledby="trf-players-title"><div class="trf-section-heading"><h3 id="trf-players-title">Datos de los jugadores</h3><button type="button" class="btn-ghost" data-trf-action="lookup">Completar desde listas</button></div>
      <p class="muted trf-help">Las correcciones se guardan en el informe. El número inicial, los puntos y los resultados se toman del torneo.</p>
      <div class="trf-table-wrap"><table class="trf-table"><thead><tr><th>Nombre</th><th>ID FIDE</th><th>ID FADA</th><th>Elo</th><th>Fed.</th><th>Título</th><th>Sexo</th><th>Nacimiento</th></tr></thead><tbody id="trf-players"></tbody></table></div>
    </section></form>
    <div id="trf-feedback" role="status" class="trf-feedback" aria-live="polite"></div>
    <footer class="trf-footer"><a href="https://tec.fide.com/trf-2026/" target="_blank" rel="noopener">Formatos TRF de FIDE</a><div class="to-actions"><button type="button" class="btn-ghost" data-trf-action="save">Guardar datos</button><button type="button" class="btn" data-trf-action="preview">Vista previa</button></div></footer></section>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#' + id), form = $('trf-form'), download = dialog.querySelector('[data-trf-action="download"]');
  const viewFormat = $('trf-view-format');
  let data = null, busy = false, revision = null, canExport = false, canEdit = false;
  function status(message, error = false) { $('trf-feedback').textContent = message; $('trf-feedback').classList.toggle('error', error); }
  function updateTriggers() {
    button.disabled = busy || !canExport;
    editButton.disabled = busy || !canEdit;
  }
  function setBusy(on) {
    busy = on;
    updateTriggers();
    for (const el of dialog.querySelectorAll('button:not([data-trf-action="close"]), input, select')) el.disabled = on;
    download.disabled = on || !data?.content || !!data.errors.length;
  }
  function invalidate() {
    if (!data) return;
    data.content = ''; download.disabled = true;
    status('Pulsa «Vista previa» para revisar los cambios.');
    if (!$('trf-view').hidden) $('trf-view-summary').textContent = 'El torneo ha cambiado. Abre «Datos del informe» y pulsa «Vista previa» para actualizar el fichero.';
  }
  function showView(preview) {
    $('trf-view').hidden = !preview;
    $('trf-editor').hidden = preview;
    dialog.classList.toggle('trf-dialog-preview', preview);
    dialog.setAttribute('aria-labelledby', preview ? 'trf-view-title' : 'trf-title');
    dialog.scrollTop = 0;
    if (dialog.open) (preview ? $('trf-preview') : form.elements.namedItem('format')).focus({ preventScroll: true });
  }
  function renderPreview() {
    const content = data.content || data.draft || '';
    const lines = content ? content.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
    const note = data.errors.length ? ' · Borrador. Completa los datos para guardar.'
      : data.warnings.length ? ` · ${data.warnings.length} ${data.warnings.length === 1 ? 'aviso' : 'avisos'} en «Datos del informe»` : '';
    $('trf-view-title').textContent = `Vista previa ${data.report.format === 'trf26' ? 'TRF-26' : 'TRF-16'}`;
    viewFormat.value = data.report.format;
    $('trf-view-summary').textContent = lines
      ? `Vista previa del fichero TRF · ${lines} líneas${note}`
      : data.errors[0] || 'No hay contenido para mostrar.';
    $('trf-preview').textContent = content;
    $('trf-preview').scrollTop = 0;
    $('trf-preview').scrollLeft = 0;
    download.disabled = busy || !data.content || !!data.errors.length;
  }
  function read() {
    const report = structuredClone(data.report);
    for (const key of ['format', 'ratingList', 'city', 'federation', 'startDate', 'endDate', 'chiefArbiter', 'deputyArbiters']) report[key] = form.elements.namedItem(key).value;
    for (const row of $('trf-players').rows) {
      const p = report.players.find(p => p.id === row.dataset.id);
      for (const input of row.querySelectorAll('[data-field]')) {
        if (input.dataset.field === 'rating') p.ratings[data.report.ratingList] = Number(input.value) || 0;
        else p[input.dataset.field] = input.value;
      }
    }
    report.roundDates = [...$('trf-round-dates').querySelectorAll('input')].map(input => input.value);
    return report;
  }
  function players() {
    const r = data.report;
    const input = (p, field, value, attrs = '') => `<input data-field="${field}" value="${esc(value)}" aria-label="${esc(field === 'rating' ? `Elo ${listNames[r.ratingList]} de ${p.name}` : `${field} de ${p.name}`)}" ${attrs}>`;
    $('trf-players').innerHTML = r.players.map(p => `<tr data-id="${esc(p.id)}"><td>${input(p, 'name', p.name, 'maxlength="80"')}</td><td>${input(p, 'fideId', p.fideId, 'inputmode="numeric" maxlength="11"')}</td><td>${input(p, 'fadaId', p.fadaId, 'inputmode="numeric" maxlength="11"')}</td><td>${input(p, 'rating', p.ratings[r.ratingList], 'type="number" min="0" max="4000"')}</td><td>${input(p, 'fed', p.fed, 'maxlength="3"')}</td><td><select data-field="title" aria-label="Título de ${esc(p.name)}">${['', 'GM', 'IM', 'FM', 'CM', 'WGM', 'WIM', 'WFM', 'WCM'].map(x => `<option${x === p.title ? ' selected' : ''}>${x}</option>`).join('')}</select></td><td><select data-field="sex" aria-label="Sexo de ${esc(p.name)}"><option value="">—</option><option value="M"${p.sex === 'M' ? ' selected' : ''}>M</option><option value="F"${p.sex === 'F' ? ' selected' : ''}>F</option></select></td><td>${input(p, 'birth', p.birth, 'placeholder="AAAA-MM-DD / AAAA" maxlength="10"')}</td></tr>`).join('');
  }
  function draw() {
    $('trf-tournament').textContent = data.title;
    for (const [key, value] of Object.entries(data.report)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    players();
    $('trf-round-dates').innerHTML = Array.from({ length: data.rounds }, (_, i) => `<label>Ronda ${i + 1}<input type="date" value="${esc(data.report.roundDates[i] || '')}"></label>`).join('');
    feedback();
  }
  function feedback() {
    const feedback = $('trf-feedback'); feedback.replaceChildren(); feedback.classList.toggle('error', !!data.errors.length);
    for (const [title, messages] of [['Completa antes de descargar', data.errors], ['Revisa estos datos', data.warnings]]) if (messages.length) {
      const heading = document.createElement('strong'); heading.textContent = title; feedback.append(heading);
      const ul = document.createElement('ul'); for (const message of messages) { const li = document.createElement('li'); li.textContent = message; ul.append(li); } feedback.append(ul);
    }
    if (!data.errors.length && !data.warnings.length) status('Informe revisado. Listo para descargar.');
  }
  async function action(kind, format) {
    if (busy || !(canExport || canEdit) || !data) return;
    const report = read();
    if (format) report.format = format;
    setBusy(true);
    try {
      const next = await request({ action: kind, report, version: data.version });
      if (!dialog.open || !(canExport || canEdit)) return;
      data = next; revision = next.revision;
      form.elements.namedItem('format').value = data.report.format;
      feedback(); renderPreview();
      if (kind === 'save') status('Datos del informe guardados.');
      if (kind === 'preview' && $('trf-view').hidden) showView(true);
      if (kind === 'download') {
        const url = URL.createObjectURL(new Blob([data.content], { type: 'text/plain;charset=utf-8', endings: 'transparent' }));
        const link = document.createElement('a'); link.href = url; link.download = data.filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        $('trf-view-summary').textContent = 'Fichero TRF descargado.';
      }
    } catch (e) {
      if (!$('trf-view').hidden) {
        viewFormat.value = data.report.format;
        $('trf-view-summary').textContent = e.message;
      }
      else status(e.message, true);
    } finally {
      setBusy(false);
      if (format && dialog.open) viewFormat.focus({ preventScroll: true });
    }
  }
  async function open(preview) {
    if (busy || dialog.open || !(preview ? canExport : canEdit)) return;
    setBusy(true);
    let showPreview = false;
    try {
      data = await request({ action: 'load' });
      if (!(canExport || canEdit)) return;
      revision = data.revision;
      draw(); renderPreview();
      showPreview = preview && !!data.content;
      showView(showPreview);
      dialog.showModal();
    } catch (e) { alert(e.message); }
    finally {
      setBusy(false);
      if (dialog.open) (showPreview ? $('trf-preview') : form.elements.namedItem('format')).focus({ preventScroll: true });
    }
  }
  button.addEventListener('click', () => open(true));
  editButton.addEventListener('click', () => open(false));
  form.addEventListener('submit', e => { e.preventDefault(); action('preview'); });
  form.addEventListener('input', invalidate);
  form.elements.namedItem('ratingList').addEventListener('change', () => { data.report = read(); players(); invalidate(); });
  viewFormat.addEventListener('change', () => action('preview', viewFormat.value));
  dialog.addEventListener('click', async e => {
    const kind = e.target.closest('[data-trf-action]')?.dataset.trfAction;
    if (kind === 'close') { dialog.close(); return; }
    if (kind === 'edit') { showView(false); return; }
    if (kind === 'lookup' && !busy) {
      data.report = read(); setBusy(true); status('Consultando las listas FIDE y FADA…');
      try {
        const found = await lookup(data.report.players);
        if (!dialog.open || !(canExport || canEdit)) return;
        let count = 0;
        for (const p of data.report.players) { const hit = found.get(p.id); if (hit) { Object.assign(p, { ...hit, ratings: { ...p.ratings, ...hit.ratings } }); count++; } }
        players(); invalidate(); status(`${count} jugadores completados. Revisa la vista previa.`);
      } catch (e) { status(e.message, true); } finally { setBusy(false); }
    } else if (['preview', 'save', 'download'].includes(kind)) action(kind);
  });
  return { sync(t, connected) {
    const visible = !!(t?.host && t.mode === 'presencial');
    const needsData = visible && t.trf?.needsData === true;
    canExport = visible && connected && t.trf?.blocker === '';
    canEdit = needsData && connected;
    button.hidden = !visible;
    editButton.hidden = !needsData;
    button.title = t?.trf?.blocker || (connected ? 'Exportar fichero TRF para FIDE o FADA' : 'Recupera la conexión para exportar TRF.');
    updateTriggers();
    if (!(canExport || canEdit) && dialog.open) dialog.close();
    if (dialog.open && revision !== t.revision && !busy) invalidate();
    return visible;
  } };
}
