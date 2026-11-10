(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt;

  // ---------- Tablero de la portada: reproduce la partida 1.b4 e5 2.Ab2 Cf6 3.Axe5 Cc6 y vuelve a empezar ----------
  /* Dibujado en un canvas: el modo oscuro automatico de algunos moviles (Samsung Internet) no recolorea su contenido */
  (function () {
    var boardEl = $("board"); if (!boardEl) return;
    var START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    var MOVES = [["b2", "b4"], ["e7", "e5"], ["c1", "b2"], ["g8", "f6"], ["b2", "e5"], ["b8", "c6"]];
    var T_INI = 1000, T_MOVE = 380, T_GAP = 550, T_END = 2500; // pausa inicial, duración de cada jugada, pausa entre jugadas y pausa final (ms)
    function sqIdx(sq) { return (8 - +sq[1]) * 8 + "abcdefgh".indexOf(sq[0]); }
    function fromFen(fen) {
      var g = [];
      fen.split("/").forEach(function (row) { row.split("").forEach(function (ch) { if (/\d/.test(ch)) { for (var k = 0; k < +ch; k++) g.push(""); } else g.push(ch); }); });
      return g;
    }
    var S = 640, q = S / 8, c = document.createElement("canvas");
    c.width = c.height = S; c.style.cssText = "display:block;width:100%;height:100%";
    var x = c.getContext("2d");
    boardEl.innerHTML = ""; boardEl.style.display = "block"; boardEl.appendChild(c);

    var imgs = {}, left = 12;
    function pieza(ch, px, py) { var im = imgs[ch]; if (im) x.drawImage(im, px, py, q, q); }
    // g: posición · mv: jugada en curso [desde, hasta] · p: avance de esa jugada (0 a 1)
    function draw(g, mv, p) {
      for (var i = 0; i < 64; i++) { var f = i % 8, r = (i - f) / 8; x.fillStyle = (f + r) % 2 ? "#769656" : "#eeeed2"; x.fillRect(f * q, r * q, q, q); }
      for (var j = 0; j < 64; j++) if (g[j] && !(mv && j === mv[0])) pieza(g[j], (j % 8) * q, Math.floor(j / 8) * q);
      if (mv) { // la pieza que se mueve va encima de las demás (y de la que captura, hasta que llega)
        var e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        var ax = (mv[0] % 8) * q, ay = Math.floor(mv[0] / 8) * q, bx = (mv[1] % 8) * q, by = Math.floor(mv[1] / 8) * q;
        pieza(g[mv[0]], ax + (bx - ax) * e, ay + (by - ay) * e);
      }
    }
    var g = fromFen(START), k = 0, moving = false, acc = 0, wait = T_INI, last = 0;
    function step(ts) {
      acc += Math.min(ts - (last || ts), 100); last = ts; // con la pestaña oculta la partida se queda en pausa
      var mv = k < MOVES.length ? [sqIdx(MOVES[k][0]), sqIdx(MOVES[k][1])] : null;
      if (!moving) {
        if (acc >= wait) {
          acc = 0;
          if (mv) moving = true;
          else { g = fromFen(START); k = 0; wait = T_INI; draw(g); } // terminó: vuelve a empezar
        }
      } else if (acc >= T_MOVE) {
        g[mv[1]] = g[mv[0]]; g[mv[0]] = ""; k++; moving = false; acc = 0; wait = k < MOVES.length ? T_GAP : T_END; draw(g);
      } else draw(g, mv, acc / T_MOVE);
      requestAnimationFrame(step);
    }
    function listo() {
      if (--left) return;
      if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { // sin animaciones: posición final, fija
        MOVES.forEach(function (m) { g[sqIdx(m[1])] = g[sqIdx(m[0])]; g[sqIdx(m[0])] = ""; });
        draw(g); return;
      }
      draw(g); requestAnimationFrame(step);
    }
    draw(g);
    "PNBRQKpnbrqk".split("").forEach(function (ch) {
      var im = new Image(); im.onload = function () { imgs[ch] = im; listo(); }; im.onerror = listo;
      im.src = "assets/pieces/" + (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase() + ".png";
    });
  })();

  // ---------- Ahora en directo (Lichess) ----------
  // Se guarda unos minutos para no volver a consultar Lichess cada vez que se entra en la portada
  var HK = "apejupoHomeLive", HTTL = 5 * 60 * 1000, OK = "apejupoHomeOrder", ahora = [];
  function pintaAhora(live) {
    if (!live.length) return;
    ahora = live;
    $("ahora").hidden = false;
    // Mismas tarjetas que en Torneos Live: ronda y hora, cuadro de información al pasar el ratón y botón «Ver torneo»
    var lista = U.applyOrder(live.slice(0, 3), OK, function (x) { return x.tour.id; });
    $("now").innerHTML = lista.map(function (x) { return U.bcCard(x, "EN DIRECTO", "live"); }).join("");
  }
  // Como en Torneos Live, las tarjetas se pueden arrastrar con el ratón para cambiarlas de sitio
  U.sortable($("now"), function () { return OK; }, function () { pintaAhora(ahora); });
  var hc = null;
  try { hc = JSON.parse(localStorage.getItem(HK)); } catch (_) {}
  if (hc && Array.isArray(hc.live) && Date.now() - hc.t < HTTL) pintaAhora(hc.live);
  else fetch("https://lichess.org/api/broadcast/top")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var live = (j.active || []).filter(function (x) { return x.round && x.round.ongoing; }).slice(0, 3);
      try { localStorage.setItem(HK, JSON.stringify({ t: Date.now(), live: live })); } catch (_) {}
      pintaAhora(live);
    })
    .catch(function () {});

  // ---------- Noticias ----------
  // data/news.json lo genera scripts/update_news.py
  function fail() {
    $("news").innerHTML = '<p class="muted">No se pudieron cargar las noticias ahora mismo.</p>';
  }
  var allNews = [];
  function renderNews(source) {
    var list = allNews.filter(function (n) { return !source || n.source === source; }).slice(0, 9);
    var fi = list.findIndex(function (n) { return n.img; });
    if (fi > 0) list.unshift(list.splice(fi, 1)[0]);
    $("news").innerHTML = list.map(function (n, i) {
      var img = /^https?:\/\//i.test(n.img) ? '<img loading="lazy" src="' + esc(n.img) + '" alt="">' : "";
      return '<article class="card' + (i === 0 && n.img ? " featured" : "") + '">' + img + '<div class="body">' +
        '<span class="meta">' + esc(n.source) + (n.date ? " · " + esc(fmt(n.date, { day: "numeric", month: "short" })) : "") + (n.lang === "en" ? " · traducida" : "") + '</span>' +
        '<h4>' + esc(n.title) + '</h4>' +
        (n.text ? '<p>' + esc(n.text) + '…</p>' : "") +
        '<a class="more" target="_blank" rel="noopener" href="' + esc(safeUrl(n.link)) + '">Leer en ' + esc(n.source) + ' →</a>' +
        '</div></article>';
    }).join("");
  }
  fetch("data/news.json?t=" + Math.floor(Date.now() / 600000))
    .then(function (r) { return r.json(); })
    .then(function (list) {
      allNews = list.map(function (n) {
        n.date = n.date ? new Date(n.date).getTime() : 0;
        return n;
      });
      if (!allNews.length) return fail();
      var sources = [];
      allNews.forEach(function (n) { if (sources.indexOf(n.source) < 0) sources.push(n.source); });
      var chips = $("news-filter");
      chips.innerHTML = ['<button type="button" aria-selected="true" data-s="">Todas</button>']
        .concat(sources.map(function (s) { return '<button type="button" aria-selected="false" data-s="' + esc(s) + '">' + esc(s) + "</button>"; }))
        .join("");
      chips.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-s]");
        if (!b) return;
        Array.prototype.forEach.call(chips.children, function (c) { c.setAttribute("aria-selected", c === b ? "true" : "false"); });
        renderNews(b.getAttribute("data-s"));
      });
      renderNews("");
    })
    .catch(fail);
})();
