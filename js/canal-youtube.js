// Canal de YouTube «Cálculo letal»: reproductor limpio (últimos vídeos o directo) y, debajo, todos los vídeos del canal.
// - Modo de privacidad mejorada de YouTube; no se carga hasta aceptar el aviso de contenidos de terceros (cookies.html).
// - Sin el título ni la barra de YouTube: el vídeo va sin sus controles, una capa transparente recibe los clics
//   (clic: pausa / sigue; doble clic: pantalla completa). Antes de empezar se ve una carátula propia; en pausa,
//   el fotograma donde se paró con un botón de reproducir.
// - «Últimos vídeos»: empieza por el más reciente y, al acabar uno, sigue con el siguiente del canal.
// La lista de vídeos la da el servidor de torneos (/api/tournaments/youtube), que la consulta a YouTube cada hora.
(function () {
  var CANAL = "UC9AHJ5HBjQpcUbgKA-PMZKg";
  var ORIGEN = "https://www.youtube-nocookie.com", API = (window.APEJUPO_TORNEOS_API || "").replace(/\/$/, "");
  var box = document.getElementById("yt-player"), nota = document.getElementById("yt-note"), tabs = document.querySelectorAll("[data-yt]");
  var grid = document.getElementById("yt-grid"), gridMsg = document.getElementById("yt-grid-msg");
  if (!box) return;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var PLAY = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  var videos = [], modo = "videos", idx = 0, cargado = false, frame = null, estado = -1, empezado = false;
  var thumb = function (id) { return "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg"; };

  // ---- Reproductor (API de YouTube por mensajes) ----
  function cmd(fn, args) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: fn, args: args || [] }), "*"); }
  function params() { return "autoplay=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&playsinline=1&cc_load_policy=0&hl=es&enablejsapi=1&origin=" + encodeURIComponent(location.origin); }
  function src() {
    if (modo === "directo") return ORIGEN + "/embed/live_stream?channel=" + CANAL + "&" + params();
    if (!videos.length) return ORIGEN + "/embed/videoseries?list=UU" + CANAL.slice(2) + "&" + params(); // sin la lista: subidas del canal
    return ORIGEN + "/embed/" + encodeURIComponent(videos[idx].id) + "?" + params();
  }
  function portada() { return modo === "videos" && videos[idx] ? thumb(videos[idx].id) : ""; }
  function pinta() {
    box.classList.toggle("parado", estado !== 1);
    // Antes de empezar, la carátula del vídeo; en pausa, el fotograma donde se paró (solo el botón encima).
    box.classList.toggle("empezado", empezado);
    var c = box.querySelector(".yt-cover"); if (!c) return;
    var img = portada(); c.style.backgroundImage = img && !empezado ? 'url("' + img + '")' : "none";
    c.setAttribute("aria-label", estado === 1 ? "Pausa" : "Reproducir");
  }
  function pon() {
    estado = -1; empezado = false;
    box.innerHTML = '<iframe src="' + src() + '" title="' + esc(modo === "directo" ? "Directo del canal «Cálculo letal»" : (videos[idx] && videos[idx].title) || "Vídeos del canal «Cálculo letal»") + '" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>'
      + '<div class="yt-shield" aria-hidden="true"></div>'
      + '<button type="button" class="yt-cover" aria-label="Reproducir"><span class="yt-cover-play">' + PLAY + "</span></button>";
    frame = box.querySelector("iframe");
    frame.addEventListener("load", function () { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1 }), "*"); });
    pinta(); marca();
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGEN || !frame || e.source !== frame.contentWindow) return;
    var m; try { m = JSON.parse(e.data); } catch (_) { return; }
    var s = m && m.info && m.info.playerState;
    if (typeof s !== "number" || s === estado) return;
    estado = s; if (s === 1) empezado = true;
    // Al acabar un vídeo, el siguiente del canal (en «Últimos vídeos»).
    if (s === 0 && modo === "videos" && videos.length > 1) { idx = (idx + 1) % videos.length; pon(); return; }
    pinta();
  });
  function alterna() { cmd(estado === 1 ? "pauseVideo" : "playVideo"); if (estado !== 1) { estado = 1; pinta(); } }
  box.addEventListener("click", function (e) { if (e.target.closest(".yt-shield, .yt-cover")) alterna(); });
  box.addEventListener("dblclick", function (e) {
    if (!e.target.closest(".yt-shield") || !box.requestFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen();
  });

  // ---- Pestañas y vídeo elegido ----
  function marca() {
    Array.prototype.forEach.call(tabs, function (t) { t.setAttribute("aria-selected", String(t.dataset.yt === modo)); });
    nota.hidden = modo !== "directo";
    if (grid) Array.prototype.forEach.call(grid.querySelectorAll("[data-i]"), function (c) { c.classList.toggle("on", modo === "videos" && +c.dataset.i === idx); });
  }
  function elige(nuevoModo, i) { modo = nuevoModo; if (typeof i === "number") idx = i; marca(); if (cargado) pon(); }
  Array.prototype.forEach.call(tabs, function (t) { t.addEventListener("click", function () { elige(t.dataset.yt, t.dataset.yt === "videos" ? 0 : undefined); }); });
  nota.hidden = true;
  function arranca() {
    U.aviso(box, {
      titulo: "Vídeos de YouTube",
      quien: "YouTube (Google)",
      boton: "Ver los vídeos",
      icono: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>'
    }, function () { cargado = true; pon(); });
  }

  // ---- Todos los vídeos del canal ----
  function fecha(iso) { return iso ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)).replace(".", "") : ""; }
  function tarjeta(v, i) {
    return '<button type="button" class="yt-v" data-i="' + i + '">'
      + '<span class="yt-thumb"><img src="https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">'
      + (v.length ? '<span class="yt-len">' + esc(v.length) + "</span>" : "") + '<span class="yt-play" aria-hidden="true"></span></span>'
      + '<span class="yt-title">' + esc(v.title) + "</span>"
      + (v.published ? '<span class="yt-date">' + fecha(v.published) + "</span>" : "") + "</button>";
  }
  fetch(API + "/api/tournaments/youtube", { signal: AbortSignal.timeout(window.APEJUPO_TORNEOS_TIMEOUT || 15000) })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (d) {
      if (!d.videos || !d.videos.length) throw new Error();
      videos = d.videos;
      if (grid) {
        grid.innerHTML = videos.map(tarjeta).join("");
        gridMsg.textContent = videos.length + (videos.length === 1 ? " vídeo" : " vídeos") + (d.complete ? "" : " más recientes");
      }
    })
    .catch(function () { if (gridMsg) gridMsg.textContent = "No se pudo cargar la lista de vídeos. Puedes verlos todos en YouTube."; })
    .then(function () { arranca(); marca(); }); // el reproductor, con la lista ya cargada (o sin ella)
  // Pulsar un vídeo: se reproduce arriba (si aún no se aceptó el aviso, queda elegido y se ve al aceptarlo).
  if (grid) grid.addEventListener("click", function (ev) {
    var c = ev.target.closest("[data-i]"); if (!c) return;
    elige("videos", +c.dataset.i);
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  });
})();
