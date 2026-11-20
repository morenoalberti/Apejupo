// Partidas aisladas: no crea torneos ni envía jugadas a producción.
// Chromium y, si está instalado, WebKit. PLAYWRIGHT_WEBKIT_EXECUTABLE permite elegir WebKit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const { chromium, webkit } = createRequire(path.join(root, 'worker/tournaments/package.json'))('playwright-core');
const sizes = [[320,568],[320,480],[360,640],[360,560],[375,667],[390,844],[393,851],[412,915],[430,932],[280,653],[768,1024],[568,320],[667,375],[740,360],[844,390],[932,430],[740,280],[568,240],[568,260]];
const output = path.join(root, 'build/browser-check/playing-mobile-fixed');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, body) => {
    const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };
    res.writeHead(err ? 404 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(err ? '' : body);
  });
});
(async () => {
  const { createTournament, joinTournament, startTournament, pairArena, snapshot, act } = await import(pathToFileURL(path.join(root, 'worker/tournaments/src/core.js')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.PLAYING_TEST_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const webkitExecutable = [process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE, webkit.executablePath(), path.join(root, 'build/browser-check/webkit-test/Playwright.exe')].filter(Boolean).find(p => fs.existsSync(p));
  const engines = [['chromium', chromium, { channel: 'msedge' }]];
  if (webkitExecutable) engines.push(['webkit', webkit, { executablePath: webkitExecutable }]);
  else console.log('WebKit no instalado: ejecutar playwright-core/cli.js install webkit para incluirlo.');
  const report = [];
  for (const [engine, runner, options] of engines) {
    const browser = await runner.launch({ ...options, headless: true });
    try {
      for (const format of ['arena', 'swiss']) for (const language of ['es', 'en']) {
        const now = Date.now(), t = createTournament({ title:'Torneo de prueba móvil', format, minutes:5, increment:3, rounds:1, capacity:2, duration:60 }, 'a'.repeat(24), 'host', now);
        joinTournament(t, 'Jugador de prueba con nombre completo muy largo', 'one', now);
        joinTournament(t, 'Otro jugador con nombre completo para comprobar', 'two', now);
        startTournament(t, now);
        if (format==='arena') pairArena(t, now);
        const g = t.games[0], initial = structuredClone(snapshot(t, g.white, false, g.id, now));
        const context = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:2, colorScheme:'dark' });
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/js/analytics.js') return route.fulfill({ body:'', contentType:'text/javascript' });
          if (url.pathname === '/js/torneo-config.js') return route.fulfill({ body:'window.APEJUPO_TORNEOS_API='+JSON.stringify(origin)+';', contentType:'text/javascript' });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ json:{tournaments:[],keyRequired:false} });
          if (url.origin !== origin) return route.fulfill({ body:'' });
          return route.continue();
        });
        await context.addInitScript(lang => {
          localStorage.setItem('apejupo-idioma',lang); window.__sockets=[]; window.__sent=[];
          window.WebSocket=class { static OPEN=1; constructor(){this.readyState=1;window.__sockets.push(this);setTimeout(()=>this.onopen?.(),0);} send(m){window.__sent.push(m);} close(){this.readyState=3;} addEventListener(){} };
        }, language);
        const page = await context.newPage(), errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin+'/jugar-torneo.html?id='+t.id);
        await page.waitForFunction(()=>window.__sockets[0]?.onmessage);
        await page.evaluate(s=>window.__sockets[0].onmessage({data:JSON.stringify(s)}),initial);
        await page.locator('#to-board button').first().waitFor();
        const read = () => page.evaluate(() => {
          const rect = el => {const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
          const panel=document.querySelector('#to-game-panel'), board=document.querySelector('#to-board');
          const squares=[...board.querySelectorAll('button')], clocks=[...panel.querySelectorAll('.to-clock')].map(rect), names=[...panel.querySelectorAll('.to-player>span')].map(rect), b=rect(board);
          return { board:b,panel:rect(panel),cell:rect(squares[0]),squares:squares.length,pieces:board.querySelectorAll('canvas').length,clocks,names,
            sidebar:rect(document.querySelector('.to-sidebar')),standings:rect(document.querySelector('#to-standings-panel')),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
            overlap:clocks.some((c,i)=>names[i].right>c.x+1),compact:document.body.classList.contains('to-compact-game'),landscape:document.body.classList.contains('to-landscape-game'),scroll:scrollY,
            contained:squares.every(s=>{const r=rect(s);return r.x>=b.x-1&&r.y>=b.y-1&&r.right<=b.right+1&&r.bottom<=b.bottom+1;}),
            actions:[...document.querySelector('#to-game-actions').children].filter(b=>!b.hidden).map(rect) };
        });
        for (const [width,height] of sizes) {
          await page.setViewportSize({width,height}); await page.waitForTimeout(160);
          if (height<=500) await page.waitForFunction(() => {
            const r=document.querySelector('#to-game-panel').getBoundingClientRect();
            return document.body.classList.contains('to-compact-game') && r.top>=-1 && r.bottom<=(visualViewport?.height||innerHeight)+1;
          },null,{timeout:2500});
          const m=await read(), label=`${engine} ${format} ${language} ${width}x${height}`;
          assert.equal(m.overflow,false,label+' desbordamiento horizontal');
          assert.equal(m.squares,64,label); assert.equal(m.pieces,32,label);
          assert.ok(m.contained && Math.abs(m.board.w-m.board.h)<1,label+' tablero cuadrado completo');
          assert.equal(m.overlap,false,label+' nombres y relojes');
          assert.ok(m.cell.w>=28,label+' casillas demasiado pequeñas: '+m.cell.w);
          if (m.landscape) assert.ok(m.sidebar.h>0 && m.standings.h>0,label+' información del torneo accesible bajo la partida');
          if (m.compact) {
            assert.ok(m.panel.y>=-1 && m.panel.bottom<=height+1,label+' tarjeta fuera de la vista: '+JSON.stringify(m.panel));
            for (const b of m.actions) assert.ok(b.x>=m.panel.x && b.right<=m.panel.right+1 && b.bottom<=height+1,label+' botones fuera de la tarjeta');
          }
          report.push({engine,format,language,width,height,board:Math.round(m.board.w),cell:Math.round(m.cell.w),compact:m.compact});
          if (format==='arena' && language==='es') await page.screenshot({path:path.join(output,`${engine}-${width}x${height}.png`)});
        }
        // El ajuste no puede desplazar la página de nuevo con cada mensaje de la partida.
        await page.setViewportSize({width:740,height:360}); await page.waitForTimeout(160);
        await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})); await page.waitForTimeout(100);
        const userScroll=await page.evaluate(()=>scrollY);
        await page.evaluate(s=>window.__sockets[0].onmessage({data:JSON.stringify({...s,revision:s.revision+1})}),initial);
        await page.waitForTimeout(160); assert.equal(await page.evaluate(()=>scrollY),userScroll,'No reposicionar después de cada actualización');
        // Giro de vuelta y movimiento táctil legal sobre el tablero de prueba.
        await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(160);
        assert.equal((await read()).landscape,false);
        await page.locator('[data-square="e2"]').tap(); await page.locator('[data-square="e4"]').tap();
        const move=await page.evaluate(()=>window.__sent.map(s=>{try{return JSON.parse(s)}catch{return{}}}).find(m=>m.type==='move'));
        assert.equal(move?.from,'e2'); assert.equal(move?.to,'e4');
        act(t,g.white,false,{type:'move',game:g.id,from:'e2',to:'e4',ply:0},now+1000);
        const black=structuredClone(snapshot(t,g.black,false,g.id,now+1000));
        await page.evaluate(s=>window.__sockets[0].onmessage({data:JSON.stringify(s)}),{...black,revision:initial.revision+2});
        await page.setViewportSize({width:740,height:360}); await page.waitForTimeout(160);
        if (engine==='chromium') {
          const from=await page.locator('[data-square="e7"]').boundingBox(),to=await page.locator('[data-square="e5"]').boundingBox();
          const cdp=await context.newCDPSession(page),x=from.x+from.width/2,y=from.y+from.height/2;
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});
          for(let step=1;step<=6;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(to.x+to.width/2-x)*step/6,y:y+(to.y+to.height/2-y)*step/6,id:0}]});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await cdp.detach();
        } else {
          await page.locator('[data-square="e7"]').tap();await page.locator('[data-square="e5"]').tap();
        }
        const blackMove=await page.evaluate(()=>window.__sent.map(s=>{try{return JSON.parse(s)}catch{return{}}}).filter(m=>m.type==='move').at(-1));
        assert.equal(blackMove?.from,'e7','Jugada con negras en horizontal');assert.equal(blackMove?.to,'e5');
        // Escritorio conserva la distribución de tablero y barra lateral, sin modo compacto.
        await page.setViewportSize({width:1280,height:900}); await page.waitForTimeout(160);
        assert.equal((await read()).compact,false); assert.equal(await page.locator('.to-sidebar #to-game-actions').count(),1);
        assert.ok((await read()).board.w>500,'El tablero de escritorio conserva su tamaño normal');
        assert.deepEqual(errors,[],engine+' errores JavaScript');
        console.log(`${engine} ${format} ${language}: ${sizes.length} tamaños, nombres largos, relojes, botones, giro, pulsaciones y escritorio OK`);
        await context.close();
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{server.closeAllConnections();server.close();});
