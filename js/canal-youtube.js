// Canal de YouTube «Cálculo letal»: reproductor (últimos vídeos o directo) y, debajo, todos los vídeos del canal.
// El reproductor usa el modo de privacidad mejorada de YouTube y no se carga hasta que el visitante lo acepta
// (el mismo aviso de contenidos de terceros que el resto de la web; ver cookies.html).
// La lista de vídeos la da el servidor de torneos (/api/tournaments/youtube), que la consulta a YouTube cada hora.
(function () {
  var CANAL = "UC9AHJ5HBjQpcUbgKA-PMZKg", SUBIDAS = "UU" + CANAL.slice(2);
  var ORIGEN = "https://www.youtube-nocookie.com", API = (window.APEJUPO_TORNEOS_API || "").replace(/\/$/, "");
  var box = document.getElementById("yt-player"), nota = document.getElementById("yt-note"), tabs = document.querySelectorAll("[data-yt]");
  var grid = document.getElementById("yt-grid"), gridMsg = document.getElementById("yt-grid-msg");
  if (!box) return;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  // Qué se ve: «videos» (lista de subidas desde el principio), «directo» o un vídeo concreto { id, title }.
  var actual = "videos", cargado = false;
  function src(que) {
    if (que === "directo") return ORIGEN + "/embed/live_stream?channel=" + CANAL + "&rel=0&hl=es";
    if (que === "videos") return ORIGEN + "/embed/videoseries?list=" + SUBIDAS + "&rel=0&hl=es";
    return ORIGEN + "/embed/" + encodeURIComponent(que.id) + "?list=" + SUBIDAS + "&autoplay=1&rel=0&hl=es"; // al terminar, sigue con el resto del canal
  }
  function pon(que) {
    var title = que === "directo" ? "Directo del canal «Cálculo letal»" : que === "videos" ? "Vídeos del canal «Cálculo letal»" : que.title;
    box.innerHTML = '<iframe src="' + src(que) + '" title="' + esc(title) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
  }
  function marca() {
    Array.prototype.forEach.call(tabs, function (t) { t.setAttribute("aria-selected", String(t.dataset.yt === (actual === "directo" ? "directo" : "videos"))); });
    nota.hidden = actual !== "directo";
    if (grid) Array.prototype.forEach.call(grid.querySelectorAll("[data-v]"), function (c) { c.classList.toggle("on", typeof actual === "object" && c.dataset.v === actual.id); });
  }
  function elige(que) { actual = que; marca(); if (cargado) pon(que); }
  Array.prototype.forEach.call(tabs, function (t) { t.addEventListener("click", function () { elige(t.dataset.yt); }); });
  nota.hidden = true;
  U.aviso(box, {
    titulo: "Vídeos de YouTube",
    quien: "YouTube (Google)",
    boton: "Ver los vídeos",
    icono: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>'
  }, function () { cargado = true; pon(actual); });

  // ---- Todos los vídeos del canal ----
  if (!grid) return;
  function fecha(iso) { return iso ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)).replace(".", "") : ""; }
  function tarjeta(v) {
    return '<button type="button" class="yt-v" data-v="' + esc(v.id) + '" data-t="' + esc(v.title) + '">'
      + '<span class="yt-thumb"><img src="https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">'
      + (v.length ? '<span class="yt-len">' + esc(v.length) + "</span>" : "") + '<span class="yt-play" aria-hidden="true"></span></span>'
      + '<span class="yt-title">' + esc(v.title) + "</span>"
      + (v.published ? '<span class="yt-date">' + fecha(v.published) + "</span>" : "") + "</button>";
  }
  fetch(API + "/api/tournaments/youtube", { signal: AbortSignal.timeout(window.APEJUPO_TORNEOS_TIMEOUT || 15000) })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (d) {
      if (!d.videos || !d.videos.length) throw new Error();
      grid.innerHTML = d.videos.map(tarjeta).join("");
      gridMsg.textContent = d.videos.length + (d.videos.length === 1 ? " vídeo" : " vídeos") + (d.complete ? "" : " más recientes");
      marca();
    })
    .catch(function () { gridMsg.textContent = "No se pudo cargar la lista de vídeos. Puedes verlos todos en YouTube."; });
  // Pulsar un vídeo: se reproduce arriba (si aún no se aceptó el aviso, queda elegido y se ve al aceptarlo).
  grid.addEventListener("click", function (ev) {
    var c = ev.target.closest("[data-v]"); if (!c) return;
    elige({ id: c.dataset.v, title: c.dataset.t });
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  });
})();
