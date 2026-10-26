(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt;

  // ---------- Torneos en directo (Lichess Broadcasts) ----------
  function bcCard(it, badge, cls) {
    var t = it.tour || {}, r = it.round || {};
    var img = t.image ? '<img loading="lazy" src="' + esc(safeUrl(t.image)) + '" alt="">' : "";
    var when = r.startsAt ? fmt(r.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return '<article class="card">' + img + '<div class="body">' +
      '<span class="badge ' + cls + '">' + badge + '</span>' +
      '<h4>' + esc(t.name) + '</h4>' +
      '<p class="meta">' + esc(r.name) + (when ? " · " + esc(when) : "") + '</p>' +
      (cls === "live" && r.id
        ? '<button type="button" class="more" data-round="' + esc(r.url) + '" data-title="' + esc(t.name) + '">Ver aquí</button>'
        : "") +
      '<a class="more" target="_blank" rel="noopener" href="' + esc(safeUrl(r.url || t.url)) + '">Ver en Lichess →</a>' +
      '</div></article>';
  }

  // Visor incrustado: Lichess permite incrustar cada partida de una ronda (study/embed).
  var viewer = $("viewer"), frame = $("viewer-frame"), sel = $("viewer-games");
  var roundId = "";
  function showGame() {
    frame.src = "https://lichess.org/study/embed/" + roundId + "/" + sel.value + "?theme=auto&bg=auto";
  }
  sel.addEventListener("change", showGame);
  $("viewer-close").addEventListener("click", function () { viewer.hidden = true; frame.src = "about:blank"; });
  $("live").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-round]");
    if (!b) return;
    var m = /^https:\/\/lichess\.org\/broadcast\/(.+)\/([A-Za-z0-9]{8})$/.exec(b.getAttribute("data-round"));
    if (!m) return;
    roundId = m[2];
    $("viewer-title").textContent = b.getAttribute("data-title");
    sel.innerHTML = "<option>Cargando partidas…</option>";
    viewer.hidden = false;
    viewer.scrollIntoView({ behavior: "smooth", block: "start" });
    fetch("https://lichess.org/api/broadcast/" + m[1] + "/" + roundId, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var g = j.games || [];
        if (!g.length) { sel.innerHTML = "<option>Sin partidas todavía</option>"; return; }
        sel.innerHTML = g.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join("");
        showGame();
      })
      .catch(function () { sel.innerHTML = "<option>No se pudieron cargar las partidas</option>"; });
  });

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

  // ---------- Streams (Twitch y YouTube) ----------
  var tabs = $("stream-tabs"), sframe = $("stream-frame");
  function pickStream(i) {
    var s = D.streams[i];
    if (s.type === "youtube") {
      sframe.src = s.videoId
        ? "https://www.youtube.com/embed/" + encodeURIComponent(s.videoId)
        : "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(s.channelId);
      $("stream-link").href = s.videoId
        ? "https://www.youtube.com/watch?v=" + encodeURIComponent(s.videoId)
        : "https://www.youtube.com/channel/" + encodeURIComponent(s.channelId) + "/live";
      $("stream-link").textContent = "Abrir en YouTube";
    } else {
      sframe.src = "https://player.twitch.tv/?channel=" + encodeURIComponent(s.channel) +
        "&muted=true&autoplay=false&parent=" + encodeURIComponent(location.hostname || "localhost");
      $("stream-link").href = "https://www.twitch.tv/" + encodeURIComponent(s.channel);
      $("stream-link").textContent = "Abrir en Twitch";
    }
    Array.prototype.forEach.call(tabs.children, function (b, k) { b.setAttribute("aria-selected", k === i ? "true" : "false"); });
  }
  if (D.streams && D.streams.length) {
    tabs.innerHTML = D.streams.map(function (s, i) {
      return '<button type="button" role="tab" data-i="' + i + '">' + esc(s.label) + "</button>";
    }).join("");
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]");
      if (b) pickStream(+b.getAttribute("data-i"));
    });
    pickStream(0);
  } else {
    $("streams").hidden = true;
  }
})();
