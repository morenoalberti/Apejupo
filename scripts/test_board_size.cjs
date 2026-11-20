// Prueba local sin contactar a las plataformas ni generar visitas de analítica.
// Requiere playwright-core (worker/tournaments/node_modules o build/browser-check/node_modules) y Chrome/Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
let playwright;
for (const folder of ['worker/tournaments', 'build/browser-check']) {
  try { playwright = createRequire(path.join(root, folder, 'package.json'))('playwright-core'); break; } catch (_) {}
}
if (!playwright) throw Error('Instala playwright-core para ejecutar esta comprobación.');
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p => fs.existsSync(p));
const pgn = '[Event "Prueba local"]\n[Site "https://lichess.org/aaaa1111"]\n[White "Blancas"]\n[Black "Negras"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *';
let gamePgn = pgn;
const now = Date.now();
let name = 'Torneo de prueba', description = '', group = null, currentFeed = {};
const scheduled = (url = 'https://www.youtube.com/watch?v=abcdefghijk', title = 'Torneo de prueba', active = false) => ({ title, source: 'Chess.com', url, start: now + (active ? -60000 : 3600000), end: now + 7200000 });
const activeFeed = (url, title = 'Torneo de prueba') => ({ live: [scheduled(url, title, true)], upcoming: [] });
const players = Array.from({ length: 28 }, (_, i) => ({ name: 'Jugador con nombre completo de prueba ' + (i + 1), title: 'IM', fed: 'ESP', rank: i + 1, score: i === 0 ? 3.5 : 2, played: 4, rating: 2400 - i, performances: { standard: 2500 - i } }));
const server = http.createServer((req, res) => {
  if (req.url === '/mock-stream.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<body style="margin:0;background:#14233a;color:white;font:20px system-ui;display:grid;place-content:center;height:100vh">Vídeo de prueba local</body>'); return;
  }
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }[path.extname(file)];
  fs.readFile(file, (err, body) => { res.writeHead(err ? 404 : 200, { 'Content-Type': type || 'application/octet-stream' }); res.end(err ? '' : body); });
});
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const chessLibrary = path.join(root, 'build/browser-check/chess.min.js');
  if (!fs.existsSync(chessLibrary)) {
    const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js');
    if (!response.ok) throw Error('No se pudo descargar chess.js para la prueba.');
    fs.mkdirSync(path.dirname(chessLibrary), { recursive: true }); fs.writeFileSync(chessLibrary, await response.text());
  }
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [1280, 390]) {
      name = 'Torneo de prueba'; description = ''; group = null;
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, colorScheme: 'dark', timezoneId: 'America/New_York' });
      const errors = [], embeds = [];
      await context.addInitScript(() => {
        localStorage.setItem('apejupoSf', 'off'); window.copiedTable = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedTable = text; } } });
      });
      await context.route('**/*', async route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        if (url.includes('/chess.min.js')) return route.fulfill({ path: chessLibrary, contentType: 'application/javascript' });
        if (/^https:\/\/(www\.youtube\.com\/embed\/|player\.twitch\.tv\/|player\.kick\.com\/)/.test(url)) {
          embeds.push(url); return route.fulfill({ status: 302, headers: { location: base + '/mock-stream.html' }, body: '' });
        }
        if (url.includes('chessrival-worker.workers.dev')) return route.fulfill({ json: url.includes('players=') ? players : currentFeed });
        if (url.includes('lichess.org')) {
          if (url.endsWith('.pgn')) return route.fulfill({ body: url.includes('summer12') ? gamePgn.replaceAll('https://lichess.org/bs', 'https://lichess.org/nx') : gamePgn, contentType: 'text/plain' });
          if (url.includes('/api/broadcast/search?')) return route.fulfill({ json: { currentPageResults: [
            { tour: { id: 'fin12345', name: 'Final con partidas anteriores' }, round: { id: 'next1234', name: 'Game 8', startsAt: now + 3600000 }, roundToLink: { id: 'hist1234', name: 'Game 7', finished: true } },
            { tour: { id: 'fut12345', name: 'Torneo sin rondas publicadas' }, round: { id: 'soon1234', name: 'Round 1', startsAt: now + 7200000 } }
          ], nextPage: null } });
          if (url.includes('/api/broadcast/-/-/')) {
            const id = url.split('/').pop();
            return route.fulfill({ json: { tour: { id: 'tour1234', name, description, dates: [now - 864e5, now + 864e5], info: {} }, group,
              round: { id, name: 'Ronda 1', startsAt: id === 'unknown1' ? undefined : id === 'summer12' ? Date.UTC(2026, 6, 20, 8) : Date.UTC(2026, 10, 20, 8) } } });
          }
          if (url.includes('/api/broadcast/tour1234')) return route.fulfill({ json: { rounds: [
            {id:'test1234',name:'Round 1',ongoing:true},
            {id:'summer12',name:'Round 2',startsAt:now+86400000}
          ] } });
          return route.fulfill({ json: { active: [], upcoming: [], rounds: [], players: [] } });
        }
        return route.fulfill({ body: '', status: 200 });
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.stack)); page.setDefaultTimeout(12000);
      const goto = async (file = 'torneo.html?r=test1234') => {
        embeds.length = 0; await page.goto(base + '/' + file);
        await page.waitForFunction(() => document.querySelector('#stream-status')?.textContent && !document.querySelector('#stream-status').textContent.includes('Consultando'));
      };

      currentFeed = { live: [], upcoming: [] };
      gamePgn = Array.from({ length: 12 }, (_, i) => {
        const result = '1/2-1/2', white = players[i * 2].name, black = players[i * 2 + 1].name;
        return `[Event "Prueba tamaño"]\n[Site "https://lichess.org/bs${String(i).padStart(6,'0')}"]\n[Round "1.${i + 1}"]\n[White "${white}"]\n[Black "${black}"]\n[WhiteTitle "IM"]\n[BlackTitle "GM"]\n[WhiteElo "2300"]\n[BlackElo "2400"]\n[Result "${result}"]\n\n1. e4 {[%clk 0:29:59]} e5 {[%clk 0:29:50]} 2. Nf3 {[%clk 0:29:47]} ${result}`;
      }).join('\n\n');
      await goto();
      await page.waitForFunction(() => document.querySelectorAll('#lv-grid > .th').length === 10 && document.querySelector('#lv-grid').dataset.size === '100');
      await page.waitForFunction(() => document.querySelector('#lv-grid > .th .ck').textContent === '29:50');
      const range = page.locator('#board-size-range'), minus = page.locator('#board-size-less'), plus = page.locator('#board-size-more'), reset = page.locator('#board-size-reset');
      const read = () => page.evaluate(() => {
        const card = document.querySelector('#lv-grid > .th');
        const rect = el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
        const font = selector => getComputedStyle(document.querySelector(selector)).fontSize;
        return { card: rect(card), board: rect(card.querySelector('.th-board')), name: rect(card.querySelector('.nm')), clock: rect(card.querySelector('.ck')), elo: rect(card.querySelector('.el')), flag: rect(card.querySelector('.lv-flag')), piece: rect(card.querySelector('canvas')),
          metadata: card.querySelector('.th-p').textContent, position: card.querySelector('.th-board').dataset.s, ids: [...document.querySelectorAll('#lv-grid > .th')].map(c => c.dataset.g), columns: getComputedStyle(document.querySelector('#lv-grid')).gridTemplateColumns.split(' ').length,
          titleFont: font('#viewer-title'), menuFont: font('#viewer-stand'), videoFont: font('#stream-open'), sizeButton: rect(document.querySelector('#board-size-more')), zoom: getComputedStyle(document.body).zoom,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      const set = async value => { await range.evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value); };
      const original = await read();
      assert.equal(await reset.isDisabled(), true);
      assert.equal(await page.locator('#board-size-control').count(), 1);
      assert.equal(await page.locator('#lv-board-toolbar #viewer-tools').count(), 1);
      assert.equal(await page.locator('#viewer-stand').isVisible(), true);
      const toolsBox = await page.locator('#viewer-tools').boundingBox(), gridBox = await page.locator('#lv-grid').boundingBox();
      assert.ok(gridBox.y - toolsBox.y - toolsBox.height >= 0 && gridBox.y - toolsBox.y - toolsBox.height <= 24, 'Controles junto al borde superior de los tableros');
      if (width < 600) {
        await page.evaluate(() => localStorage.setItem('apejupoBoardSize','75'));
        await page.reload();
        await page.waitForFunction(() => document.querySelectorAll('#lv-grid > .th').length === 10 && document.querySelector('#lv-grid').dataset.size === '100');
        for (const [w,h] of [[390,900],[320,700],[844,390]]) {
          await page.setViewportSize({width:w,height:h}); await wait(80);
          assert.equal(await page.locator('#board-size-control').isVisible(),false);
          assert.equal(await page.locator('#stream-launch').isVisible(),false);
          assert.equal(await page.locator('#viewer-options').isVisible(),false);
          assert.equal(await range.inputValue(),'100');
          assert.equal(await page.evaluate(() => localStorage.getItem('apejupoBoardSize')),'75','Conserva la preferencia de ordenador');
          assert.equal((await read()).overflow,false);
          assert.equal(await page.locator('#viewer-stand').isVisible(),true);
          assert.equal(await page.locator('#viewer-pair').isVisible(),true);
          const roundBox=await page.locator('#viewer-round-open').boundingBox(),bellBox=await page.locator('#viewer-bell').boundingBox(),orderBox=await page.locator('#viewer-reset').boundingBox();
          assert.ok(roundBox && Math.abs(roundBox.y-bellBox.y)<1 && Math.abs(roundBox.y-orderBox.y)<1,'Ronda, sonido y restablecer en la misma fila');
          assert.ok(roundBox.x+roundBox.width<=bellBox.x && bellBox.x+bellBox.width<=orderBox.x,'Sonido y restablecer a la derecha del selector');
          const standBox=await page.locator('#viewer-stand').boundingBox(),pairBox=await page.locator('#viewer-pair').boundingBox();
          assert.ok(standBox.y>=roundBox.y+roundBox.height && Math.abs(standBox.y-pairBox.y)<1 && standBox.x+standBox.width<=pairBox.x,'Clasificación y emparejamientos en la fila inferior');
        }
        await page.setViewportSize({width:390,height:900});
        await page.screenshot({path:path.join(root,'build/browser-check/live-mobile-clean.png')});
        await page.locator('#viewer-pair').click(); await page.locator('table.pairs').waitFor(); await page.locator('#lv-fclose').click();
        await page.locator('#lv-grid > .th').first().dblclick(); await page.locator('#viewer').waitFor({state:'visible'});
        assert.deepEqual(errors,[]);
        console.log('Móvil OK: sin retransmisión, detalles ni ajuste; tableros automáticos al 100 %, emparejamientos y visor accesibles.');
        await context.close(); continue;
      }
      await page.locator('#lv-grid > .th').first().evaluate(el => el.dataset.sizeMarker = 'retained');
      await minus.click(); assert.equal(await range.inputValue(), '95');
      await range.press('Home'); assert.equal(await range.inputValue(), '75'); assert.equal(await minus.isDisabled(), true);
      const small = await read();
      assert.ok(small.card.w < original.card.w * .8 && small.board.w < original.board.w * .8);
      assert.ok(small.name.h < original.name.h && small.clock.h < original.clock.h && small.flag.w < original.flag.w);
      assert.deepEqual(small.ids, original.ids); assert.equal(small.metadata, original.metadata); assert.equal(small.position, original.position);
      assert.equal(await page.locator('#lv-grid > .th').first().getAttribute('data-size-marker'), 'retained', 'El ajuste conserva los nodos y los datos');
      if (width > 600) assert.ok(small.columns > original.columns);
      await page.screenshot({ path: path.join(root, `build/browser-check/board-size-small-${width}.png`) });
      await range.press('End');
      const maximum = width > 600 ? '150' : '100';
      assert.equal(await range.inputValue(), maximum); assert.equal(await plus.isDisabled(), true);
      const large = await read();
      assert.ok(large.board.w > small.board.w && large.name.h > small.name.h && large.clock.h > small.clock.h && large.elo.h > small.elo.h && large.piece.w > small.piece.w);
      assert.ok(Math.abs(large.board.w - large.board.h) < 1);
      assert.equal(large.overflow, false);
      for (const key of ['titleFont', 'menuFont', 'videoFont', 'sizeButton', 'zoom']) assert.deepEqual(large[key], original[key], 'Mantiene el resto de la página: ' + key);
      await page.screenshot({ path: path.join(root, `build/browser-check/board-size-large-${width}.png`) });
      // El doble clic abre la misma partida; el visor ampliado no hereda esta escala.
      await page.locator('#lv-grid > .th').first().dblclick(); await page.locator('#viewer').waitFor({ state: 'visible' });
      const modal = await page.locator('#lv-board').boundingBox(); assert.ok(modal.width > 200);
      assert.equal(await page.locator('#viewer').evaluate(el => getComputedStyle(el).zoom), '1');
      await page.locator('#lv-closebig').click();
      if (width > 600) {
        // Tanto pequeño como grande, la copia que se arrastra conserva tamaño, nombres y piezas.
        for (const size of [75, 150]) {
          await set(size); await page.evaluate(() => scrollTo(0, 0));
          const cards = page.locator('#lv-grid > .th'), first = await cards.first().boundingBox(), target = await cards.nth(1).boundingBox();
          await page.mouse.move(first.x + 35, first.y + 12); await page.mouse.down(); await page.mouse.move(first.x + 55, first.y + 32, { steps: 3 });
          await page.locator('.th-ghost').waitFor({ state: 'visible' });
          const ghost = await page.locator('.th-ghost').evaluate(el => {
            const r = el.getBoundingClientRect(), scale = parseFloat(getComputedStyle(el).zoom);
            return { width: parseFloat(getComputedStyle(el).width) * scale, cx: r.x + r.width / 2, cy: r.y + r.height / 2, scale, nameHeight: el.querySelector('.nm').getBoundingClientRect().height };
          });
          assert.ok(Math.abs(ghost.width - first.width) < 2);
          assert.ok(Math.abs(ghost.cx - (first.x + 20 + first.width / 2)) < 2, 'El arrastre sigue el puntero horizontalmente');
          assert.ok(Math.abs(ghost.cy - (first.y + 20 + first.height / 2)) < 2, 'El arrastre sigue el puntero verticalmente');
          assert.equal(ghost.scale, size / 100);
          await page.mouse.move(target.x + target.width / 2, target.y + 15, { steps: 6 }); await page.mouse.up();
          await page.locator('.th-ghost').waitFor({ state: 'detached' }); await wait(300);
          const order = await page.evaluate(() => JSON.parse(localStorage.getItem('apejupoOrdtest1234')));
          assert.equal(order.length, 10); assert.equal(new Set(order).size, 10);
        }
        // La preferencia se conserva al estrechar la pantalla y reaparece al recuperar el espacio.
        await set(150); await page.setViewportSize({ width: 390, height: 900 });
        await page.waitForFunction(() => document.querySelector('#board-size-range').max === '100');
        assert.equal(await range.inputValue(), '100'); assert.equal(await page.evaluate(() => localStorage.getItem('apejupoBoardSize')), '150');
        assert.equal((await read()).overflow, false);
        await page.setViewportSize({ width, height: 900 }); await page.waitForFunction(() => document.querySelector('#board-size-range').value === '150');
      } else {
        await set(80); await page.setViewportSize({ width: 320, height: 700 }); await wait(60);
        assert.equal((await read()).overflow, false); await page.setViewportSize({ width, height: 900 });
      }
      const saved = await range.inputValue();
      await page.reload(); await page.waitForFunction(() => document.querySelector('#lv-grid').dataset.size && document.querySelectorAll('#lv-grid > .th').length === 10);
      assert.equal(await range.inputValue(), saved, 'Preferencia conservada al recargar');
      await reset.click(); assert.equal(await range.inputValue(), '100');
      assert.equal(await page.evaluate(() => localStorage.getItem('apejupoBoardSize')), null);
      assert.ok(Math.abs((await read()).card.w - original.card.w) < 1, 'Restablecer recupera el tamaño inicial');
      await set(80);
      await page.evaluate(() => window.apejupoOpenRound('summer12', 'Ronda siguiente', true));
      await page.waitForFunction(() => document.querySelectorAll('#lv-grid > .th').length === 10);
      assert.equal(await range.inputValue(), '80'); assert.equal(await page.locator('#board-size-control').count(), 1);
      assert.equal(await page.locator('#lv-grid > .th').first().evaluate(el => getComputedStyle(el).zoom), '0.8', 'Las tarjetas de otra ronda conservan la escala');
      await page.evaluate(() => localStorage.setItem('apejupoBoardSize', 'no-es-un-numero')); await page.reload();
      await page.waitForFunction(() => document.querySelector('#lv-grid').dataset.size === '100');
      assert.equal(await range.inputValue(), '100', 'Una preferencia inválida vuelve al tamaño normal');
      assert.deepEqual(errors, []);
      console.log(`${width}px OK: tarjetas completas pequeñas/grandes, controles sin escalar, proporciones, arrastre, visor ampliado, límites, persistencia y restablecer.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { server.closeAllConnections(); server.close(); });
