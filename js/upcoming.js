(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt;

  // Tarjetas como las de Torneos Live: imagen (si hay), etiqueta, título, fecha y enlace
  function card(id, img, badge, title, meta, href, linkText, tip) {
    return '<article class="card" data-id="' + esc(id || "") + '"' + (tip ? U.tipAttr(tip) : "") + '>' + (img ? '<img loading="lazy" src="' + esc(safeUrl(img)) + '" alt="">' : "") + '<div class="body">' +
      '<span class="badge ' + badge[0] + '">' + badge[1] + '</span>' +
      '<h4>' + esc(title) + '</h4>' +
      '<p class="meta">' + esc(meta) + '</p>' +
      (href ? '<a class="more" target="_blank" rel="noopener" href="' + esc(safeUrl(href)) + '">' + linkText + '</a>' : "") +
      '</div></article>';
  }

  // ---------- Torneos del equipo ----------
  var now = Date.now();
  var mine = D.events.filter(function (e) { return new Date(e.date).getTime() >= now - 864e5; })
    .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  function teamId(e) { return e.link || e.title; }
  function pintaEquipo() {
    var lista = U.applyOrder(mine.slice(), "apejupoOrderTeam", teamId);
    $("team-events").innerHTML = lista.length
    ? lista.map(function (e) { return card(teamId(e), e.image, ["soon", "APEJUPO"], e.title, fmt(e.date, { weekday: "short", day: "numeric", month: "short" }) + " · " + e.place, e.link, "Más información →"); }).join("")
    : '<p class="muted">No hay torneos del equipo programados.</p>';
  }
  pintaEquipo();
  U.sortable($("team-events"), function () { return "apejupoOrderTeam"; }, pintaEquipo);

  // ---------- Torneos en Andalucía (Info64 y Chess-Results; los genera scripts/update_local.py) ----------
  var local = [], provSel = "";
  function localId(t) { return t.url || t.name; }
  function localKey() { return "apejupoOrderLocal:" + provSel; } // cada pestaña de provincia guarda su propio orden
  function fechas(t) {
    function f(d) { return fmt(d + "T12:00:00", { day: "numeric", month: "short" }); }
    return t.start === t.end ? f(t.start) : "del " + f(t.start) + " al " + f(t.end);
  }
  function pintaLocal() {
    var box = $("local-events"), tabs = $("local-tabs");
    var provs = [];
    local.forEach(function (t) { if (provs.indexOf(t.province) < 0) provs.push(t.province); });
    provs.sort();
    tabs.hidden = !local.length;
    tabs.innerHTML = ['<button type="button" role="tab" aria-selected="' + (!provSel) + '" data-p="">Todas (' + local.length + ")</button>"].concat(provs.map(function (p) {
      var n = local.filter(function (t) { return t.province === p; }).length;
      return '<button type="button" role="tab" aria-selected="' + (provSel === p) + '" data-p="' + esc(p) + '">' + esc(p) + " (" + n + ")</button>";
    })).join("");
    var hoy = new Date().toISOString().slice(0, 10);
    // primero los que aún no han empezado (por fecha); después los que ya están en curso
    var lista = local.filter(function (t) { return !provSel || t.province === provSel; }).sort(function (a, b) {
      var ea = a.start <= hoy ? 1 : 0, eb = b.start <= hoy ? 1 : 0;
      return ea - eb || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    });
    U.applyOrder(lista, localKey(), localId);
    box.innerHTML = lista.length ? lista.map(function (t) {
      var extra = [t.tc, t.rounds ? t.rounds + " rondas" : "", t.organizer].filter(Boolean).join(" · ");
      return card(localId(t), "", t.start <= new Date().toISOString().slice(0, 10) ? ["live", "EN CURSO"] : ["soon", "PRÓXIMO"], t.name,
        (t.city.toLowerCase().indexOf(t.province.toLowerCase()) >= 0 ? t.city : t.city + " (" + t.province + ")") + " · " + fechas(t) + (extra ? " · " + extra : ""), t.url, "Más información →");
    }).join("") : '<p class="muted">No hay torneos programados en esta provincia.</p>';
  }
  U.sortable($("local-events"), localKey, pintaLocal);
  $("local-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]");
    if (b) { provSel = b.getAttribute("data-p"); pintaLocal(); }
  });
  fetch("data/torneos-locales.json?t=" + Math.floor(Date.now() / 600000))
    .then(function (r) { return r.json(); })
    .then(function (j) { local = (j.tournaments || []).filter(function (t) { return t.end >= new Date(now - 864e5).toISOString().slice(0, 10); }); pintaLocal(); })
    .catch(function () { $("local-events").innerHTML = '<p class="muted">No se pudo cargar el calendario de Andalucía ahora mismo.</p>'; });

  // ---------- Torneos internacionales (Lichess Broadcasts) ----------
  var intl = null;
  function pintaIntl() {
    var list = U.applyOrder(intl.slice(0, 30), "apejupoOrderIntl", function (e) { return e.tour.id; });
    $("intl-events").innerHTML = list.length
      ? list.map(function (e) { return card(e.tour.id, e.image, ["soon", "PRÓXIMAMENTE"], e.title, e.sub, null, null, e.tour); }).join("")
      : '<p class="muted">No hay torneos programados por ahora.</p>';
  }
  U.sortable($("intl-events"), function () { return "apejupoOrderIntl"; }, function () { if (intl) pintaIntl(); });
  fetch("https://lichess.org/api/broadcast/top")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var seen = {}, list = [];
      (j.active || []).concat(j.upcoming || []).forEach(function (x) {
        var t = x.tour || {}, r = x.round || {};
        if (!r.startsAt || r.ongoing || r.finished || r.startsAt < now + 864e5 || seen[t.id]) return;
        seen[t.id] = true;
        list.push({ tour: t, ts: r.startsAt, title: t.name, image: t.image, sub: U.ronda(r.name) + " · " + fmt(r.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), url: r.url || t.url });
      });
      list.sort(function (a, b) { return a.ts - b.ts; });
      intl = list; pintaIntl();
    })
    .catch(function () {
      $("intl-events").innerHTML = '<p class="muted">No se pudo cargar el calendario. <a target="_blank" rel="noopener" href="https://lichess.org/broadcast">Verlo en Lichess</a>.</p>';
    });
})();
