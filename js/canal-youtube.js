// Canal de YouTube «Cálculo letal»: últimos vídeos del canal (su lista de subidas, que se actualiza sola) o el directo.
// El reproductor usa el modo de privacidad mejorada de YouTube y no se carga hasta que el visitante lo acepta
// (el mismo aviso de contenidos de terceros que el resto de la web; ver cookies.html).
(function () {
  var CANAL = "UC9AHJ5HBjQpcUbgKA-PMZKg", SUBIDAS = "UU" + CANAL.slice(2);
  var ORIGEN = "https://www.youtube-nocookie.com";
  var URL_DE = {
    videos: ORIGEN + "/embed/videoseries?list=" + SUBIDAS + "&rel=0&hl=es",
    directo: ORIGEN + "/embed/live_stream?channel=" + CANAL + "&rel=0&hl=es"
  };
  var box = document.getElementById("yt-player"), nota = document.getElementById("yt-note"), tabs = document.querySelectorAll("[data-yt]");
  if (!box) return;
  var actual = "videos", cargado = false;
  function pon(que) {
    box.innerHTML = '<iframe src="' + URL_DE[que] + '" title="' + (que === "directo" ? "Directo del canal «Cálculo letal»" : "Vídeos del canal «Cálculo letal»") + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
  }
  function elige(que) {
    actual = que;
    Array.prototype.forEach.call(tabs, function (t) { t.setAttribute("aria-selected", String(t.dataset.yt === que)); });
    nota.hidden = que !== "directo";
    if (cargado) pon(que);
  }
  Array.prototype.forEach.call(tabs, function (t) { t.addEventListener("click", function () { elige(t.dataset.yt); }); });
  nota.hidden = true;
  U.aviso(box, {
    titulo: "Vídeos de YouTube",
    quien: "YouTube (Google)",
    boton: "Ver los vídeos",
    icono: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>'
  }, function () { cargado = true; pon(actual); });
})();
