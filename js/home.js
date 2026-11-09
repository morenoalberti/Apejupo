(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt;

  // ---------- Tablero de la portada: reproduce una apertura (1.b4 e5 2.Ab2 Cf6 3.Axe5 Cc6) y vuelve a empezar ----------
  var START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  var MOVES = [["b2", "b4"], ["e7", "e5"], ["c1", "b2"], ["g8", "f6"], ["b2", "e5"], ["b8", "c6"]];
  var boardEl = $("board");
  function sqIdx(sq) { return (8 - +sq[1]) * 8 + "abcdefgh".indexOf(sq[0]); }
  function fromFen(fen) {
    var g = [];
    fen.split("/").forEach(function (row) { row.split("").forEach(function (ch) { if (/\d/.test(ch)) { for (var k = 0; k < +ch; k++) g.push(""); } else g.push(ch); }); });
    return g;
  }
  function pieceImg(ch) {
    var name = (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase();
    return '<img src="assets/pieces/' + name + '.png" alt="" draggable="false">';
  }
  function paint(g, last) {
    var h = "";
    for (var i = 0; i < 64; i++) {
      var x = i % 8, y = (i - x) / 8;
      h += '<i class="' + ((x + y) % 2 ? "d" : "l") + (last && (i === last[0] || i === last[1]) ? " last" : "") + '">' + (g[i] ? pieceImg(g[i]) : "") + "</i>";
    }
    boardEl.innerHTML = h;
  }
  /* Tablero dibujado en un canvas: el modo oscuro automatico de algunos moviles (Samsung Internet) no recolorea su contenido */
  (function () {
    var g = fromFen("r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R"), S = 640, c = document.createElement("canvas");
    c.width = c.height = S; c.style.cssText = "display:block;width:100%;height:100%";
    var x = c.getContext("2d"), q = S / 8;
    function casillas() { for (var i = 0; i < 64; i++) { var f = i % 8, r = (i - f) / 8; x.fillStyle = (f + r) % 2 ? "#769656" : "#eeeed2"; x.fillRect(f * q, r * q, q, q); } }
    casillas();
    boardEl.innerHTML = ""; boardEl.style.display = "block"; boardEl.appendChild(c);
    g.forEach(function (ch, i) {
      if (!ch) return;
      var im = new Image(); im.onload = function () { x.drawImage(im, (i % 8) * q, Math.floor(i / 8) * q, q, q); };
      im.src = "assets/pieces/" + (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase() + ".png";
    });
  })();

  // ---------- Ahora en directo (Lichess) ----------
  // Se guarda unos minutos para no volver a consultar Lichess cada vez que se entra en la portada
  var HK = "apejupoHomeLive", HTTL = 5 * 60 * 1000;
  function pintaAhora(live) {
    if (!live.length) return;
    $("ahora").hidden = false;
    $("now").innerHTML = live.slice(0, 3).map(function (x) {
      var t = x.tour || {}, r = x.round || {};
      var img = t.image ? '<img loading="lazy" src="' + esc(safeUrl(t.image)) + '" alt="">' : "";
      return '<article class="card">' + img + '<div class="body"><span class="badge live">EN DIRECTO</span>' +
        '<h4>' + esc(t.name) + '</h4><p class="meta">' + esc(U.ronda(r.name)) + '</p>' +
        '<a class="more" href="torneos-live.html">Ver en Torneos Live →</a></div></article>';
    }).join("");
  }
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
