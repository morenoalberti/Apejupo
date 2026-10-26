(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt;

  // ---------- Tablero decorativo (posición por FEN) ----------
  var FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  function pieceImg(ch) {
    var name = (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase();
    return '<img src="assets/pieces/' + name + '.png" alt="" draggable="false">';
  }
  var cells = "";
  function cell(x, y, ch) {
    return '<i class="' + ((x + y) % 2 ? "d" : "l") + '">' + (ch ? pieceImg(ch) : "") + "</i>";
  }
  FEN.split("/").forEach(function (row, y) {
    var x = 0;
    row.split("").forEach(function (ch) {
      if (/\d/.test(ch)) {
        for (var k = 0; k < +ch; k++, x++) cells += cell(x, y, "");
      } else {
        cells += cell(x, y, ch);
        x++;
      }
    });
  });
  $("board").innerHTML = cells;

  // ---------- Resumen ----------
  $("stat-players").textContent = D.players.length;

  // ---------- Equipo ----------
  $("players").innerHTML = D.players.map(function (p) {
    var ini = p.name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
    var av = p.foto
      ? '<div class="avatar con-foto"><img alt="" src="' + esc(p.foto) + '"></div>'   // foto propia (assets/equipo/…)
      : '<div class="avatar"' + (p.fide ? ' data-fid="' + esc(p.fide) + '"' : "") + ">" + esc(ini) + "</div>"; // foto de FIDE si hay número
    return '<div class="card player">' + av +
      '<h4>' + esc(p.name) + '</h4><p>' + esc(p.title) + '</p>' +
      '<p class="elo">Elo ' + esc(p.elo) + '</p></div>';
  }).join("");

  U.fotos($("players"));

  // ---------- Calendario ----------
  var now = Date.now();
  var evs = D.events.filter(function (e) { return new Date(e.date).getTime() >= now - 864e5; })
    .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  $("stat-events").textContent = evs.length;
  $("events").innerHTML = evs.length ? evs.map(function (e, i) {
    return '<li' + (i === 0 ? ' class="next"' : "") + '><div class="date">' + fmt(e.date, { day: "numeric" }) +
      '<small>' + fmt(e.date, { month: "short" }) + '</small></div>' +
      '<div>' + (i === 0 ? '<span class="badge soon">PRÓXIMO</span> ' : "") + '<strong>' + esc(e.title) + '</strong><div class="muted">' + esc(e.place) + '</div></div></li>';
  }).join("") : '<li class="muted">No hay eventos próximos.</li>';

  // ---------- Ahora en directo (Lichess) ----------
  fetch("https://lichess.org/api/broadcast/top")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var live = (j.active || []).filter(function (x) { return x.round && x.round.ongoing; });
      $("stat-live").textContent = live.length;
      if (!live.length) return;
      $("ahora").hidden = false;
      $("now").innerHTML = live.slice(0, 3).map(function (x) {
        var t = x.tour || {}, r = x.round || {};
        var img = t.image ? '<img loading="lazy" src="' + esc(safeUrl(t.image)) + '" alt="">' : "";
        return '<article class="card">' + img + '<div class="body"><span class="badge live">EN DIRECTO</span>' +
          '<h4>' + esc(t.name) + '</h4><p class="meta">' + esc(r.name) + '</p>' +
          '<a class="more" href="torneos-live.html">Ver en Torneos Live →</a></div></article>';
      }).join("");
    })
    .catch(function () { $("stat-live").textContent = "–"; });

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
