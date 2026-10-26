(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt;

  function row(ts, title, sub, href, badge) {
    var d = new Date(ts);
    var date = '<div class="date">' + fmt(d, { day: "numeric" }) + '<small>' + fmt(d, { month: "short" }) + "</small></div>";
    var name = href
      ? '<a class="stretch" target="_blank" rel="noopener" href="' + esc(safeUrl(href)) + '"><strong>' + esc(title) + "</strong></a>"
      : "<strong>" + esc(title) + "</strong>";
    return "<li>" + date + "<div>" + (badge ? '<span class="badge ' + badge[0] + '">' + badge[1] + "</span> " : "") +
      name + '<div class="muted">' + esc(sub) + "</div></div></li>";
  }

  // ---------- Torneos del equipo ----------
  var now = Date.now();
  var mine = D.events.filter(function (e) { return new Date(e.date).getTime() >= now - 864e5; })
    .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  $("team-events").innerHTML = mine.length
    ? mine.map(function (e) { return row(e.date, e.title, e.place, e.link, ["soon", "APEJUPO"]); }).join("")
    : '<li class="muted">No hay torneos del equipo programados.</li>';

  // ---------- Torneos internacionales (Lichess Broadcasts) ----------
  fetch("https://lichess.org/api/broadcast/top")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var seen = {}, list = [];
      (j.active || []).concat(j.upcoming || []).forEach(function (x) {
        var t = x.tour || {}, r = x.round || {};
        if (!r.startsAt || r.ongoing || r.finished || r.startsAt < now || seen[t.id]) return;
        seen[t.id] = true;
        list.push({ ts: r.startsAt, title: t.name, sub: r.name + " · " + fmt(r.startsAt, { weekday: "long", hour: "2-digit", minute: "2-digit" }), url: r.url || t.url });
      });
      list.sort(function (a, b) { return a.ts - b.ts; });
      $("intl-events").innerHTML = list.length
        ? list.slice(0, 30).map(function (e) { return row(e.ts, e.title, e.sub, e.url); }).join("")
        : '<li class="muted">No hay torneos programados por ahora.</li>';
    })
    .catch(function () {
      $("intl-events").innerHTML = '<li class="muted">No se pudo cargar el calendario. <a target="_blank" rel="noopener" href="https://lichess.org/broadcast">Verlo en Lichess</a>.</li>';
    });
})();
