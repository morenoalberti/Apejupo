(function () {
  "use strict";
  var D = window.APEJUPO || {}, $ = U.$, fmt = U.fmt;
  var tournamentPage = !!$("viewer"), section = $("streams");
  if (!section) {
    var main = document.querySelector("main"); if (!main) return;
    section = document.createElement("section"); section.id = "streams"; section.className = "wrap section"; main.appendChild(section);
  }
  section.innerHTML = '<div class="stream-launch" id="stream-launch"><button type="button" id="stream-open" class="btn" disabled aria-describedby="stream-status"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 8 6 4-6 4V8z"/></svg><span>Ver retransmisión en directo</span></button><small id="stream-status" role="status"></small></div>' +
    '<div id="stream-window" class="stream-window" role="region" aria-label="Vídeo de los comentaristas" hidden><div class="sw-head">' +
    '<button type="button" class="sw-drag" id="sw-drag" title="Arrastra para mover; usa las flechas para mover con el teclado"><span aria-hidden="true">⠿</span><span id="sw-title" translate="no">Comentaristas</span></button>' +
    '<div class="sw-actions"><button type="button" id="sw-size" title="Cambiar tamaño" aria-label="Cambiar tamaño">↗</button>' +
    '<button type="button" id="sw-min" title="Minimizar vídeo (el sonido continúa)" aria-label="Minimizar vídeo" aria-controls="sw-body" aria-expanded="true">−</button>' +
    '<button type="button" id="sw-dock" title="Volver a la página" aria-label="Volver a la página">▣</button>' +
    '<button type="button" id="sw-close" title="Cerrar y detener vídeo" aria-label="Cerrar y detener vídeo">×</button></div></div>' +
    '<div class="sw-body" id="sw-body"><div id="stream-box" class="stream"><iframe id="stream-frame" title="Retransmisión del torneo" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div></div></div>';
  var launch = $("stream-launch"), openButton = $("stream-open"), status = $("stream-status");
  var player = $("stream-window"), box = $("stream-box"), frame = $("stream-frame");
  if (tournamentPage) {
    $("viewer-pick").parentNode.insertBefore(launch, $("viewer-pick")); section.hidden = true;
  }
  var floating = false, minimized = false, size = 0, position = null, gesture = null;
  var widths = [448, 600, 400];
  function fit() {
    if (!floating || player.hidden) return;
    player.style.width = Math.min(widths[size], Math.max(0, innerWidth - 24)) + "px";
    player.style.setProperty("--sw-width", player.style.width);
    var r = player.getBoundingClientRect(), margin = 12;
    var x = position ? position.x : innerWidth - r.width - 16;
    var y = position ? position.y : innerHeight - r.height - 16;
    x = Math.max(margin, Math.min(x, innerWidth - r.width - margin));
    y = Math.max(margin, Math.min(y, innerHeight - r.height - margin));
    player.style.left = x + "px"; player.style.top = y + "px";
    if (position) position = { x: x, y: y };
  }
  function setMinimized(value) {
    minimized = value; player.classList.toggle("sw-minimized", value);
    $("sw-min").textContent = value ? "+" : "−";
    $("sw-min").setAttribute("aria-label", value ? "Restaurar vídeo" : "Minimizar vídeo");
    $("sw-min").title = value ? "Restaurar vídeo" : "Minimizar vídeo (el sonido continúa)";
    $("sw-min").setAttribute("aria-expanded", String(!value)); fit();
  }
  function floatPlayer() {
    floating = true; player.classList.add("sw-floating"); setMinimized(false); fit();
    $("sw-drag").focus({ preventScroll: true });
  }
  function dockPlayer() {
    floating = false; player.classList.remove("sw-floating"); setMinimized(false);
    player.style.width = player.style.left = player.style.top = "";
    player.scrollIntoView({ behavior: "smooth", block: "center" }); openButton.focus({ preventScroll: true });
  }
  $("sw-dock").addEventListener("click", dockPlayer);
  $("sw-min").addEventListener("click", function () { if (!floating) floatPlayer(); setMinimized(!minimized); });
  $("sw-size").addEventListener("click", function () { if (!floating) floatPlayer(); size = (size + 1) % widths.length; fit(); });
  $("sw-close").addEventListener("click", function () { closePlayer(); openButton.focus({ preventScroll: true }); });
  var handle = $("sw-drag");
  handle.addEventListener("pointerdown", function (e) {
    if (!floating || e.button !== 0 || gesture) return;
    var r = player.getBoundingClientRect(); gesture = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture(e.pointerId); player.classList.add("sw-moving"); e.preventDefault();
  });
  handle.addEventListener("pointermove", function (e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    position = { x: e.clientX - gesture.dx, y: e.clientY - gesture.dy }; fit();
  });
  function endGesture(e) { if (gesture && e.pointerId === gesture.id) { gesture = null; player.classList.remove("sw-moving"); } }
  handle.addEventListener("pointerup", endGesture); handle.addEventListener("pointercancel", endGesture); handle.addEventListener("lostpointercapture", endGesture);
  handle.addEventListener("keydown", function (e) {
    if (!floating || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    e.preventDefault(); e.stopPropagation(); var r = player.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
    position = { x: r.left + (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0), y: r.top + (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0) }; fit();
  });
  window.addEventListener("resize", fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(player);
  var context = window.ApejupoBroadcast || null, feed = [], loaded = false, failed = false, request = null;
  var currentStream = null, selection = 0, busy = false, lastStatusText = null;
  var endpoint = "https://apejupo-eventos.chessrival-worker.workers.dev";
  try { var override = new URLSearchParams(location.search).get("eventos"); if (override && /^(https:\/\/|\/|worker\/)/.test(override)) endpoint = override; } catch (_) {}
  function contextKey() { return context && context.tour ? context.tour.id + "|" + (context.round && context.round.id || "") : ""; }
  function streamKey(stream) { return stream.type + "|" + (stream.channel || stream.videoId); }
  function titleKey(text) {
    // Solo equivalencia de nombres, sin búsquedas por palabras sueltas ni coincidencias aproximadas.
    return String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/\s+(?:day|dia)\s+\d+\s*$/, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function belongsToTournament(event, stream) {
    if (!context || !context.tour || !context.tour.id) return false;
    var tour = context.tour, group = context.group || {}, round = context.round || {};
    var dates = tour.dates || [], start = Number(dates[0]), end = Number(dates[1] || dates[0]);
    if (start && end && (event.end < start - 864e5 || event.start > end + 864e5)) return false;
    if (event.lichessTourId === tour.id || (round.id && event.lichessRoundId === round.id)) return true;
    var config = (D.commentary || {})[tour.id] || (D.commentary || {})[group.id] || {};
    if ((config.eventIds || []).some(function (id) { return String(id) === String(event.eventId); })) return true;
    var names = [tour.name, group.name].concat(config.aliases || []).map(titleKey).filter(Boolean);
    if (names.indexOf(titleKey(event.title)) !== -1) return true;
    // Un vídeo concreto enlazado por el organizador identifica la emisión. Un canal genérico no basta:
    // puede estar retransmitiendo otro torneo en ese horario.
    var links = (String(tour.description || "").match(/https?:\/\/[^\s<>"')\]]+/g) || []).concat(config.urls || []);
    if (tour.info && tour.info.website) links.push(tour.info.website);
    return links.some(function (link) { var source = U.streamSource(link.replace(/&amp;/g, "&").replace(/[.,;]+$/, "")); return source && source.type === "youtube" && stream.type === "youtube" && streamKey(source) === streamKey(stream); });
  }
  function matching() {
    return feed.map(function (event) {
      var stream = U.streamSource(event.url);
      if (!stream || !Number.isFinite(event.start) || !Number.isFinite(event.end) || event.end <= event.start || !belongsToTournament(event, stream)) return null;
      stream.event = event; return stream;
    }).filter(Boolean);
  }
  function state() {
    var now = Date.now(), streams = matching();
    var active = streams.filter(function (stream) { return stream.event.start <= now && now < stream.event.end; });
    active.sort(function (a, b) {
      var esA = /^es(?:[_-]|$)/i.test(a.event.language || ""), esB = /^es(?:[_-]|$)/i.test(b.event.language || "");
      return Number(esB) - Number(esA) || b.event.start - a.event.start;
    });
    var next = streams.filter(function (stream) { return stream.event.start > now; }).sort(function (a, b) { return a.event.start - b.event.start; })[0];
    return { active: active[0] || null, activeStreams: active, next: next || null };
  }
  function madrid(time) {
    return fmt(time, { timeZone: "Europe/Madrid", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  function closePlayer() {
    selection++; currentStream = null; frame.removeAttribute("src"); player.hidden = true;
    var consent = box.querySelector(".terceros"); if (consent) consent.remove();
    if (tournamentPage) section.hidden = true;
  }
  function render() {
    var current = state(), text;
    if (currentStream && !current.activeStreams.some(function (s) { return streamKey(s) === streamKey(currentStream); })) closePlayer();
    openButton.disabled = busy || !current.active;
    if (!tournamentPage) text = "Abre un torneo para ver su retransmisión.";
    else if (!context || !context.tour) text = "Consultando la retransmisión del torneo…";
    else if (busy || !loaded) text = "Consultando la retransmisión del torneo…";
    else if (current.active) text = "En directo · " + ({ youtube: "YouTube", twitch: "Twitch", kick: "Kick" }[current.active.type]);
    else if (current.next) text = "Próxima emisión con comentaristas: " + madrid(current.next.event.start) + " · hora de Madrid";
    // La hora de inicio de la ronda ya sale en la cabecera del torneo: aquí no se repite.
    else text = failed ? "No se ha podido consultar la emisión." : "Sin emisión en directo confirmada para este torneo.";
    status.classList.toggle("is-live", !!current.active && !busy);
    if (lastStatusText !== text) { status.textContent = text; lastStatusText = text; }
  }
  function loadFeed() {
    if (request) return request;
    request = fetch(endpoint, { cache: "no-cache" }).then(function (response) { if (!response.ok) throw Error(response.status); return response.json(); }).then(function (data) {
      feed = [].concat(Array.isArray(data.live) ? data.live : [], Array.isArray(data.upcoming) ? data.upcoming : []);
      loaded = true; failed = false;
    }).catch(function () { loaded = true; failed = true; feed = []; }).finally(function () { request = null; render(); });
    return request;
  }
  function openStream(stream) {
    var key = contextKey(), token = ++selection, url;
    if (stream.type === "youtube") url = "https://www.youtube.com/embed/" + encodeURIComponent(stream.videoId);
    else if (stream.type === "kick") url = "https://player.kick.com/" + encodeURIComponent(stream.channel) + "?autoplay=false&muted=false";
    else url = "https://player.twitch.tv/?channel=" + encodeURIComponent(stream.channel) + "&muted=true&autoplay=false&parent=" + encodeURIComponent(location.hostname || "localhost");
    currentStream = stream; section.hidden = false; player.hidden = false; player.dataset.provider = stream.type;
    $("sw-title").textContent = context.tour.name;
    frame.removeAttribute("src");
    var provider = { youtube: "YouTube", twitch: "Twitch", kick: "Kick" }[stream.type];
    U.aviso(box, { titulo: "Directo en " + provider, quien: provider, boton: "Ver el directo", icono: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/>' }, function () {
      if (selection === token && key === contextKey() && state().activeStreams.some(function (s) { return streamKey(s) === streamKey(stream); })) frame.src = url;
    });
    floatPlayer();
  }
  openButton.addEventListener("click", async function () {
    if (openButton.disabled) return;
    if (currentStream && !player.hidden) { floatPlayer(); return; }
    var key = contextKey(); busy = true; render();
    await loadFeed(); busy = false; render();
    if (key !== contextKey()) return;
    var current = state(); if (current.active) openStream(current.active);
  });
  document.addEventListener("apejupo:broadcast", function (event) {
    var old = contextKey(); context = event.detail;
    if (old !== contextKey()) closePlayer();
    render();
  });
  render();
  if (tournamentPage) {
    loadFeed();
    setInterval(function () { if (!document.hidden) render(); }, 1000);
    setInterval(function () { if (!document.hidden) loadFeed(); }, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { render(); loadFeed(); } });
  }
})();
