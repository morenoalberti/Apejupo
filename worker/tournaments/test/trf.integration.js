import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { chromium } from 'playwright-core';
import { organizerSession } from './organizador.js';

const BASE = 'http://127.0.0.1:8789', WEB = 'http://localhost:8080', ORIGIN = WEB;
const output = new URL('../../../build/trf-qa/', import.meta.url);
async function call(path, data, session = '') {
  const response = await fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) }, body: JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}
async function roomSocket(id, session) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + `/api/tournaments/${id}/socket`, { headers: { Origin: ORIGIN } });
  let state = null;
  const waiters = [];
  ws.on('message', bytes => {
    const data = JSON.parse(String(bytes));
    if (data.type === 'state') state = data;
    for (const waiter of [...waiters]) if (data.type === 'error' || waiter.test(data)) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); data.type === 'error' ? waiter.reject(new Error(data.message)) : waiter.resolve(data); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = action => {
    const revision = state?.revision ?? -1;
    return new Promise((resolve, reject) => {
      const waiter = { test: action.type === 'hello' ? m => m.type === 'state' && m.host : m => m.type === 'state' && m.revision > revision, resolve, reject };
      waiter.timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('No llegó la respuesta del torneo.')); }, 10000);
      waiters.push(waiter); ws.send(JSON.stringify(action));
    });
  };
  await send({ type: 'hello', session });
  return { ws, send, state: () => state };
}

test('TRF: permisos, guardar datos, fichero real, interfaz, móvil y doble vuelta bloqueada', { timeout: 120000 }, async () => {
  await mkdir(output, { recursive: true });
  const owner = await organizerSession(BASE, ORIGIN), other = await organizerSession(BASE, ORIGIN);
  const created = [], errors = [];
  let socket, browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce', acceptDownloads: true });
    await context.route('**/*', route => [WEB, BASE].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await context.addInitScript(owner => { localStorage.setItem('apejupoSesion', owner.session); localStorage.setItem('apejupoCuenta', JSON.stringify(owner.user)); }, owner);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(WEB + '/jugar-torneo.html');
    await page.locator('#to-create-open').click();
    const details = page.locator('#to-trf-details');
    assert.equal(await details.isVisible(), false);
    await page.locator('#to-mode-switch').click();
    await details.waitFor();
    assert.equal(await page.locator('#to-trf-federation').inputValue(), 'ESP');
    const federation = page.locator('#to-trf-federation-open');
    const federationSearch = page.getByRole('combobox', { name: 'Buscar federación' });
    await federation.click();
    await federationSearch.waitFor();
    assert.equal(await page.locator('#to-federation-options [role="option"] .to-federation-flag').count(), 204);
    assert.deepEqual(await page.locator('#to-federation-top [role="option"]').evaluateAll(options => options.map(option => option.dataset.code)),
      ['USA', 'IND', 'CHN', 'RUS', 'FRA', 'AZE', 'UZB', 'GER', 'UKR', 'ARM']);
    assert.equal(await page.locator('#to-federation-others [role="option"]').count(), 194);
    await federationSearch.fill('fra');
    await federationSearch.press('Enter');
    assert.equal(await page.locator('#to-trf-federation').inputValue(), 'FRA');
    assert.match(await federation.textContent(), /Francia/);
    await page.locator('#to-trf-city').fill('Málaga');
    await page.locator('#to-mode-switch').click();
    assert.equal(await details.isVisible(), false);
    await page.locator('#to-mode-switch').click();
    assert.equal(await page.locator('#to-trf-city').inputValue(), 'Málaga');
    await page.locator('#to-event-name').fill('Informe TRF de prueba');
    await page.locator('#to-format').selectOption('swiss');
    await page.locator('#to-rounds').fill('3');
    await page.locator('#to-trf-chief').fill('Árbitro de prueba');
    await page.locator('#to-trf-deputies').fill('Adjunta uno; Adjunto dos');
    const creating = page.waitForResponse(res => res.url() === BASE + '/api/tournaments' && res.request().method() === 'POST');
    await page.locator('#to-create-submit').click();
    const made = await creating;
    assert.equal(made.status(), 201);
    await page.waitForURL(/\/jugar-torneo\.html\?id=[a-f0-9]{24}$/);
    const id = new URL(page.url()).searchParams.get('id'); created.push(id);
    const trfButton = page.locator('#to-trf-open');
    const editTrfButton = page.locator('#to-trf-edit');
    const nextRound = page.locator('#to-presencial-next');
    await trfButton.waitFor();
    assert.equal(await trfButton.isDisabled(), true);
    assert.match(await trfButton.getAttribute('title'), /todas las rondas/);
    assert.equal(await nextRound.isVisible(), true);
    assert.equal(await nextRound.isDisabled(), true);
    await page.locator('#to-host-edit').click();
    await details.waitFor();
    assert.equal(await page.locator('#to-trf-city').inputValue(), 'Málaga');
    assert.equal(await page.locator('#to-trf-chief').inputValue(), 'Árbitro de prueba');
    assert.equal(await page.locator('#to-trf-federation').inputValue(), 'FRA');
    await page.setViewportSize({ width: 390, height: 844 });
    await federation.click();
    await federationSearch.fill('China Taipei');
    assert.equal(await page.getByRole('option', { name: /China Taipéi/ }).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await federationSearch.press('Escape');
    await federationSearch.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#to-trf-federation').inputValue(), 'FRA');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#to-trf-deputies').fill('Adjunta uno; Adjunto tres');
    await page.locator('#to-create-submit').click();
    await page.locator('#to-create-dialog').waitFor({ state: 'hidden' });
    socket = await roomSocket(id, owner.session);
    for (let i = 0; i < 4; i++) await socket.send({ type: 'presencial-player', name: `Jugador de prueba ${i + 1}`, rating: 2000 - i * 100, source: 'FIDE', fide: 2000 - i * 100, fada: 1800 - i * 100, fideId: String(2220000 + i), fadaId: String(3300 + i), fed: 'ESP', sex: i % 2 ? 'F' : 'M', birth: 1990 + i });
    await socket.send({ type: 'start' });
    while (socket.state().status !== 'finished') {
      for (const g of socket.state().games.filter(g => g.round === socket.state().round && !g.result)) await socket.send({ type: 'presencial-result', game: g.id, result: '1/2-1/2' });
      if (socket.state().status === 'between') {
        await page.waitForFunction(() => !document.getElementById('to-presencial-next').disabled);
        assert.equal(await nextRound.isVisible(), true);
        assert.equal(await trfButton.isVisible(), true);
        assert.equal(await trfButton.isDisabled(), true);
        if (socket.state().round === 1) {
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            const [trf, next] = await Promise.all([trfButton.boundingBox(), nextRound.boundingBox()]);
            assert.ok(trf && next);
            assert.ok(trf.x + trf.width < next.x || trf.y + trf.height < next.y, `Los botones se solapan a ${width} px.`);
            assert.ok(next.x + next.width <= width, `El botón de siguiente ronda desborda a ${width} px.`);
          }
        }
        await socket.send({ type: 'presencial-next' });
        await page.waitForFunction(() => document.getElementById('to-presencial-next').disabled);
        assert.equal(await nextRound.isVisible(), true);
      }
    }
    await page.waitForFunction(() => !document.getElementById('to-trf-open').disabled);
    assert.equal(await nextRound.isVisible(), true);
    assert.equal(await nextRound.isDisabled(), true);
    const path = `/api/tournaments/${id}/trf`;
    assert.equal((await call(path, { action: 'load', admin: true, actorId: owner.user.id })).status, 403);
    assert.equal((await call(path, { action: 'load' }, other.session)).status, 403);
    let loaded = await call(path, { action: 'load' }, owner.session);
    assert.equal(loaded.status, 200); assert.equal(loaded.data.report.players[0].ratings.fada, 1800);
    assert.match(loaded.data.content, /022 Malaga\r\n032 FRA\r\n/);
    assert.match(loaded.data.content, /102 Arbitro de prueba\r\n112 Adjunta uno\r\n112 Adjunto tres\r\n/);
    assert.ok(loaded.data.report.roundDates.every(Boolean));
    const version = loaded.data.version;
    const incomplete = { ...loaded.data.report, city: '' };
    const draft = await call(path, { action: 'preview', report: incomplete }, owner.session);
    assert.match(draft.data.draft, /^012 Informe TRF de prueba\r\n/);
    assert.equal(draft.data.content, '');
    assert.equal((await call(path, { action: 'download', report: incomplete, version }, owner.session)).status, 400);
    const report = { ...loaded.data.report, ratingList: 'standard' };
    let saved = await call(path, { action: 'save', report, version }, owner.session);
    assert.equal(saved.status, 200); assert.equal(saved.data.version, version + 1);
    assert.equal((await call(path, { action: 'save', report, version }, owner.session)).status, 409);
    const preview = await call(path, { action: 'preview', report: { ...report, format: 'trf26' } }, owner.session);
    assert.equal(preview.status, 200); assert.deepEqual(preview.data.errors, []);
    assert.match(preview.data.content, /192 FIDE_DUTCH_2025/);
    const disk = await call(path, { action: 'load' }, owner.session);
    assert.equal(disk.data.report.format, 'trf16', 'La vista previa no guarda cambios.');
    const downloaded = await call(path, { action: 'download', report, version: saved.data.version }, owner.session);
    assert.equal(downloaded.status, 200); assert.match(downloaded.data.content, /^012 /);
    const publicView = await (await fetch(BASE + `/api/tournaments/${id}`)).json();
    assert.ok(!('trfReport' in publicView)); assert.ok(!('report' in publicView)); assert.ok(!('trf' in publicView));

    const savedIncomplete = await call(path, { action: 'save', report: incomplete, version: downloaded.data.version }, owner.session);
    assert.equal(savedIncomplete.status, 200);
    await editTrfButton.waitFor();
    assert.equal(await trfButton.isVisible(), true);
    assert.equal(await trfButton.isDisabled(), true);
    assert.match(await trfButton.getAttribute('title'), /ciudad/);
    await editTrfButton.click();
    await page.locator('#trf-editor').waitFor();
    assert.equal(await page.locator('#trf-editor [name="city"]').inputValue(), '');
    await page.locator('#trf-editor [name="city"]').fill('Málaga');
    await page.locator('#trf-editor [name="ratingList"]').selectOption('standard');
    await page.locator('[data-trf-action="save"]').click();
    await page.waitForFunction(() => document.getElementById('trf-feedback').textContent === 'Datos del informe guardados.');
    await page.getByRole('button', { name: 'Cerrar exportación TRF' }).click();
    await editTrfButton.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.getElementById('to-trf-open').disabled);
    await page.screenshot({ path: fileURLToPath(new URL('boton-trf.png', output)), fullPage: true });
    await page.locator('#to-trf-open').click(); await page.locator('#to-trf-dialog').waitFor();
    assert.equal(await page.locator('#trf-view-title').textContent(), 'Vista previa TRF-16');
    assert.equal(await page.locator('#trf-editor').isVisible(), false);
    assert.match(await page.locator('#trf-view-summary').textContent(), /\d+ líneas/);
    assert.match(await page.locator('#trf-preview').textContent(), /022 Malaga/);
    await page.screenshot({ path: fileURLToPath(new URL('vista-previa-trf16.png', output)) });
    await page.locator('[data-trf-action="edit"]').click();
    await page.locator('[name="ratingList"]').selectOption('fada');
    assert.equal(await page.locator('#trf-players [data-field="rating"]').first().inputValue(), '1800');
    await page.locator('[name="city"]').fill('Sevilla');
    assert.equal(await page.locator('[data-trf-action="download"]').isEnabled(), false);
    await page.locator('[data-trf-action="preview"]').click();
    await page.waitForFunction(() => document.getElementById('trf-preview').textContent.includes('022 Sevilla'));
    const formatSelect = page.getByRole('combobox', { name: 'Formato', exact: true });
    assert.deepEqual(await formatSelect.locator('option').allTextContents(), ['TRF-16', 'TRF-26']);
    for (const [format, label] of [['trf16', 'TRF-16'], ['trf26', 'TRF-26']]) {
      await formatSelect.selectOption(format);
      await page.getByRole('heading', { name: `Vista previa ${label}` }).waitFor();
      const previewContent = await page.locator('#trf-preview').textContent();
      assert.match(previewContent, /022 Sevilla/);
      assert.equal(previewContent.includes('192 FIDE_DUTCH_2025'), format === 'trf26');
      const downloadEvent = page.waitForEvent('download');
      await page.locator('[data-trf-action="download"]').click();
      const file = await downloadEvent;
      assert.ok(file.suggestedFilename().endsWith(`-fada-${format}.trf`));
      const filePath = fileURLToPath(new URL(`informe-fada-${format}.trf`, output));
      await file.saveAs(filePath);
      const content = await readFile(filePath, 'utf8');
      assert.equal(content, previewContent);
      assert.match(content, /Rating list: FADA/);
      assert.ok(content.endsWith('\r\n'));
      await page.waitForFunction(() => document.getElementById('trf-view-summary').textContent === 'Fichero TRF descargado.');
    }
    await page.screenshot({ path: fileURLToPath(new URL('exportar-trf.png', output)) });
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click(); await page.reload();
    await page.locator('#to-trf-open').click(); await page.locator('#to-trf-dialog').waitFor();
    assert.equal(await formatSelect.inputValue(), 'trf26');
    assert.match(await page.locator('#trf-preview').textContent(), /022 Sevilla/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('#trf-preview').evaluate(el => el.scrollWidth > el.clientWidth), true);
    assert.equal(await formatSelect.isVisible(), true);
    await page.screenshot({ path: fileURLToPath(new URL('exportar-trf-movil.png', output)) });
    await formatSelect.selectOption('trf16');
    await page.getByRole('heading', { name: 'Vista previa TRF-16' }).waitFor();
    assert.doesNotMatch(await page.locator('#trf-preview').textContent(), /^192 /m);
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    const double = await call('/api/tournaments', { title: 'Doble vuelta de prueba TRF', mode: 'presencial', format: 'double-closed', minutes: 3, increment: 2, capacity: 16, hostToken: randomBytes(32).toString('hex') }, owner.session);
    assert.equal(double.status, 201); created.push(double.data.id);
    const rejected = await call(`/api/tournaments/${double.data.id}/trf`, { action: 'load' }, owner.session);
    assert.equal(rejected.status, 400); assert.match(rejected.data.error, /doble vuelta/);
    await page.goto(WEB + `/jugar-torneo.html?id=${double.data.id}`); await page.locator('#to-trf-open').waitFor();
    assert.equal(await page.locator('#to-trf-open').isEnabled(), false);
    assert.match(await page.locator('#to-trf-open').getAttribute('title'), /doble vuelta/);
    assert.equal(await nextRound.isVisible(), true);
    assert.equal(await nextRound.isDisabled(), true);
    await page.screenshot({ path: fileURLToPath(new URL('trf-doble-vuelta-deshabilitado.png', output)) });
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close(); if (socket) socket.ws.close();
    for (const id of created) await call(`/api/tournaments/${id}/delete`, {}, owner.session);
    for (const account of [owner, other]) await call('/api/cuentas/borrar', { password: 'clave-segura-1' }, account.session);
  }
});
