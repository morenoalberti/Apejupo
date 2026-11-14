import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WEB = 'http://127.0.0.1:8087', API = 'http://127.0.0.1:8789/api/tournaments';
const key = (await readFile(new URL('../.dev.vars', import.meta.url), 'utf8')).match(/^TORNEOS_CLAVE\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const contexts = [], errors = [];
const output = new URL('../../../build/torneo-qa/', import.meta.url); await mkdir(output, { recursive: true });
async function page() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  contexts.push(context); const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); return p;
}
async function waitText(p, selector, text) { await p.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text }, { timeout: 45000 }); }
async function join(p, url, name) {
  await p.goto(url); await p.locator('#to-name').fill(name); await p.getByRole('button', { name: 'Inscribirme', exact: true }).click(); await p.locator('#to-membership').waitFor({ state: 'visible' });
}
async function move(p, from, to) {
  await waitText(p, '#to-game-status', 'Tu turno');
  await p.locator(`[data-square="${from}"]`).click(); await p.locator(`[data-square="${to}"]`).click();
  await p.waitForFunction(() => !document.querySelector('#to-game-status').textContent.includes('Confirmando'));
}
async function resign(p) {
  await p.locator('#to-resign').click(); await p.locator('#to-confirm-yes').click();
}
async function checkLayout(p, width, theme) {
  await p.setViewportSize({ width, height: 900 }); await p.emulateMedia({ colorScheme: theme });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Desbordamiento a ${width}px (${theme})`);
  const squares = await p.locator('#to-board button').count(); if (squares) assert.equal(squares, 64);
}
try {
  const host = await page();
  await host.goto(WEB + '/jugar-torneo.html');
  await host.getByRole('button', { name: 'Organizar torneo', exact: true }).click();
  await host.locator('#to-event-name').fill('Abierto Apejupo · prueba completa');
  await host.locator('#to-capacity').fill('4'); await host.locator('#to-rounds').fill('2'); await host.locator('#to-key').fill(key);
  await host.locator('#to-create-form [type=submit]').click(); await host.waitForURL(/\?id=/); const url = host.url(), id = new URL(url).searchParams.get('id');
  await host.locator('#to-host').waitFor({ state: 'visible' });
  await host.locator('#to-name').fill('Ana García'); await host.getByRole('button', { name: 'Inscribirme', exact: true }).click(); await host.locator('#to-membership').waitFor({ state: 'visible' });
  const names = ['Ana García', 'Ben López', 'Carla Ruiz', 'Diego Martín'];
  const players = [host, await page(), await page(), await page()];
  for (let i = 1; i < players.length; i++) await join(players[i], url, names[i]);
  const spectator = await page(); await spectator.goto(url);
  await spectator.locator('#to-registration').waitFor({ state: 'hidden' });
  assert.equal(await spectator.locator('#to-game-actions').isVisible(), false);
  await host.waitForFunction(() => !document.querySelector('#to-start').disabled);
  await host.locator('#to-start').click(); await host.locator('#to-confirm-yes').click();
  await Promise.all(players.map(p => waitText(p, '#to-phase', 'Ronda 1 de 2')));
  const t = await (await fetch(API + '/' + id)).json();
  const byId = new Map(t.standings.map(row => [row.id, players[names.indexOf(row.name)]]));
  const first = t.games[0], white = byId.get(first.white), black = byId.get(first.black);
  for (const [p, from, to] of [[white, 'e2', 'e4'], [black, 'e7', 'e5'], [white, 'g1', 'f3'], [black, 'b8', 'c6']]) await move(p, from, to);
  await black.reload(); await waitText(black, '#to-connection', 'Conectado'); await black.locator('#to-board button').first().waitFor();
  assert.equal(await black.locator('#to-membership').isVisible(), true);
  await black.context().setOffline(true);
  await move(white, 'd2', 'd4');
  await black.context().setOffline(false);
  await black.reload(); await waitText(black, '#to-game-status', 'Tu turno');
  await white.setViewportSize({ width: 1440, height: 1000 });
  await white.screenshot({ path: fileURLToPath(new URL('partida-escritorio.png', output)), fullPage: true });
  for (const width of [1440, 1024, 821, 820, 768, 390, 320]) for (const theme of ['dark', 'light']) await checkLayout(white, width, theme);
  await white.setViewportSize({ width: 390, height: 844 }); await white.emulateMedia({ colorScheme: 'dark' });
  await white.locator('#to-game-panel').scrollIntoViewIfNeeded();
  await white.screenshot({ path: fileURLToPath(new URL('partida-movil.png', output)), fullPage: true });
  await white.locator('#to-offer').click(); await black.locator('#to-draw-offer').waitFor({ state: 'visible' }); await black.locator('#to-accept').click();
  await white.locator('#to-replay').waitFor({ state: 'visible' });
  await white.locator('#to-replay-prev').click(); assert.equal(await white.locator('#to-replay-range').inputValue(), '4');
  await white.locator('#to-replay-next').click(); assert.equal(await white.locator('#to-replay-range').inputValue(), '5');
  const downloadPromise = white.waitForEvent('download'); await white.locator('#to-pgn').click(); const download = await downloadPromise; assert.match(download.suggestedFilename(), /\.pgn$/);
  const second = t.games[1]; await resign(byId.get(second.white));
  await waitText(host, '#to-phase', 'Siguiente ronda');
  await waitText(host, '#to-phase', 'Ronda 2 de 2');
  const round2 = await (await fetch(API + '/' + id)).json();
  for (const g of round2.games.filter(g => g.round === 2)) await resign(byId.get(g.white));
  await waitText(host, '#to-phase', 'Clasificación final');
  assert.equal(await host.locator('#to-standings tr').count(), 4);
  assert.equal(await host.locator('#to-all-pgn').isVisible(), true);
  await host.screenshot({ path: fileURLToPath(new URL('clasificacion-final.png', output)), fullPage: true });
  await spectator.setViewportSize({ width: 390, height: 844 });
  await spectator.locator('.nav-t').click();
  assert.equal(await spectator.getByRole('link', { name: 'Torneo', exact: true }).isVisible(), true);
  await spectator.getByRole('link', { name: 'Torneo', exact: true }).click();
  await spectator.locator('.to-event').first().waitFor();
  assert.equal(await spectator.locator('#to-lobby').isVisible(), true);
  await spectator.screenshot({ path: fileURLToPath(new URL('torneos-movil.png', output)), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(new URL('resultado.json', output), JSON.stringify({ id, players: 4, rounds: 2, games: 4, independentBrowsers: 5, reconnect: true, offlineRecovery: true, draw: true, pgn: true, replay: true, testedWidths: [1440, 1024, 821, 820, 768, 390, 320], themes: ['dark', 'light'], javascriptErrors: errors }, null, 2));
  console.log('Correcto: 5 navegadores independientes, 2 rondas automáticas, reconexión, tablas, PGN, revisión y 14 combinaciones de tamaño/tema.');
} finally {
  for (const c of contexts) await c.close(); await browser.close();
}
