(function () {
  var D = window.APEJUPO;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function safeUrl(u) {
    return /^https?:\/\//i.test(u || "") ? u : "#";
  }
  function fmt(d, opts) {
    return new Date(d).toLocaleString("es-ES", opts);
  }

  $("year").textContent = new Date().getFullYear();

  // ---------- Equipo ----------
  $("players").innerHTML = D.players.map(function (p) {
    var ini = p.name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
    return '<div class="card player"><div class="avatar">' + esc(ini) + '</div>' +
      '<h4>' + esc(p.name) + '</h4><p>' + esc(p.title) + '</p>' +
      '<p class="elo">Elo ' + esc(p.elo) + '</p></div>';
  }).join("");

  // ---------- Calendario ----------
  var now = Date.now();
  var evs = D.events.filter(function (e) { return new Date(e.date).getTime() >= now - 864e5; })
    .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  $("events").innerHTML = evs.length ? evs.map(function (e) {
    return '<li><div class="date">' + fmt(e.date, { day: "numeric" }) +
      '<small>' + fmt(e.date, { month: "short" }) + '</small></div>' +
      '<div><strong>' + esc(e.title) + '</strong><div class="muted">' + esc(e.place) + '</div></div></li>';
  }).join("") : '<li class="muted">No hay eventos próximos.</li>';

  // ---------- Directo (Lichess Broadcasts) ----------
  function bcCard(it, badge, cls) {
    var t = it.tour || {}, r = it.round || {};
    var img = t.image ? '<img loading="lazy" src="' + esc(safeUrl(t.image)) + '" alt="">' : "";
    var when = r.startsAt ? fmt(r.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return '<article class="card">' + img + '<div class="body">' +
      '<span class="badge ' + cls + '">' + badge + '</span>' +
      '<h4>' + esc(t.name) + '</h4>' +
      '<p class="meta">' + esc(r.name) + (when ? " · " + esc(when) : "") + '</p>' +
      '<a class="more" target="_blank" rel="noopener" href="' + esc(safeUrl(r.url || t.url)) + '">Ver en Lichess →</a>' +
      '</div></article>';
  }
  fetch("https://lichess.org/api/broadcast/top")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var active = j.active || [];
      var live = active.filter(function (x) { return x.round && x.round.ongoing; });
      var soon = active.filter(function (x) { return !(x.round && x.round.ongoing); });
      $("live").innerHTML = live.length
        ? live.map(function (x) { return bcCard(x, "EN DIRECTO", "live"); }).join("")
        : '<p class="muted">Ahora mismo no hay torneos en directo.</p>';
      var up = (soon.length ? soon : (j.upcoming || [])).slice(0, 6);
      $("upcoming").innerHTML = up.length
        ? up.map(function (x) { return bcCard(x, "PRÓXIMAMENTE", "soon"); }).join("")
        : '<p class="muted">No hay retransmisiones programadas.</p>';
    })
    .catch(function () {
      $("live").innerHTML = '<p class="muted">No se pudieron cargar las retransmisiones. <a target="_blank" rel="noopener" href="https://lichess.org/broadcast">Verlas en Lichess</a>.</p>';
    });

  // ---------- Noticias (RSS vía rss2json) ----------
  // data/news.json lo genera scripts/update_news.py
  fetch("data/news.json?t=" + Math.floor(Date.now() / 600000))
    .then(function (r) { return r.json(); })
    .then(function (list) {
    var all = list.slice(0, 12).map(function (n) {
      n.date = n.date ? new Date(n.date).getTime() : 0;
      return n;
    });
    if (!all.length) {
      $("news").innerHTML = '<p class="muted">No se pudieron cargar las noticias ahora mismo.</p>';
      return;
    }
    $("news").innerHTML = all.map(function (n) {
      var img = /^https?:\/\//i.test(n.img) ? '<img loading="lazy" src="' + esc(n.img) + '" alt="">' : "";
      return '<article class="card">' + img + '<div class="body">' +
        '<span class="meta">' + esc(n.source) + (n.date ? " · " + esc(fmt(n.date, { day: "numeric", month: "short" })) : "") + '</span>' +
        '<h4>' + esc(n.title) + '</h4>' +
        (n.text ? '<p>' + esc(n.text) + '…</p>' : "") +
        '<a class="more" target="_blank" rel="noopener" href="' + esc(safeUrl(n.link)) + '">Leer en ' + esc(n.source) + ' →</a>' +
        '</div></article>';
    }).join("");
    })
    .catch(function () {
      $("news").innerHTML = '<p class="muted">No se pudieron cargar las noticias ahora mismo.</p>';
    });
})();
