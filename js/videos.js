// Sección de vídeos: un reproductor de YouTube (modo sin cookies) y la lista de vídeos de la sección
// El vídeo no se carga hasta que el usuario pulsa «reproducir», así que la página no llama a YouTube antes.
(function () {
  var data = window.VIDEOS, box = document.getElementById("vd-player"), list = document.getElementById("vd-list");
  if (!data || !box || !list) return;
  var esc = U.esc, cur = -1;
  function thumb(v) { return "https://i.ytimg.com/vi/" + encodeURIComponent(v.id) + "/hqdefault.jpg"; }
  // Reproductor limpio: sin los controles ni las sugerencias de YouTube. Una capa transparente recibe el ratón
  // y se maneja el vídeo con la API del reproductor (play/pausa con un clic, barra propia con avance y pantalla completa).
  var ORIGIN = "https://www.youtube-nocookie.com", frame = null, st = { t: 0, d: 0, s: -1 };
  function cmd(fn, args) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: fn, args: args || [] }), "*"); }
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function paintBar() {
    var pp = box.querySelector(".vd-pp"), pr = box.querySelector(".vd-prog i"), tm = box.querySelector(".vd-tm");
    if (!pp) return;
    pp.innerHTML = st.s === 1 ? '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
    pp.setAttribute("aria-label", st.s === 1 ? "Pausa" : "Reproducir");
    pr.style.width = (st.d ? Math.min(100, st.t / st.d * 100) : 0) + "%";
    tm.textContent = fmt(st.t) + " / " + fmt(st.d);
    box.classList.toggle("paused", st.s !== 1);
  }
  // Subtítulos de YouTube fuera (aunque el usuario los tenga activados en su cuenta)
  function noCC() { cmd("unloadModule", ["captions"]); cmd("unloadModule", ["cc"]); cmd("setOption", ["captions", "track", {}]); }
  function toggle() { cmd(st.s === 1 ? "pauseVideo" : "playVideo"); }
  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !frame || e.source !== frame.contentWindow) return;
    var m; try { m = JSON.parse(e.data); } catch (_) { return; }
    var inf = m && m.info; if (!inf) return;
    if (typeof inf.currentTime === "number") st.t = inf.currentTime;
    if (typeof inf.duration === "number" && inf.duration) st.d = inf.duration;
    if (typeof inf.playerState === "number") { if (inf.playerState !== st.s) noCC(); st.s = inf.playerState; }
    paintBar();
  });
  function show(i, play) {
    var v = data[i]; cur = i; frame = null; st = { t: 0, d: 0, s: -1 };
    if (play) {
      box.innerHTML = '<iframe src="' + ORIGIN + '/embed/' + encodeURIComponent(v.id) + '?autoplay=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&cc_load_policy=0&cc_lang_pref=xx&hl=es&disablekb=1&fs=0&playsinline=1&enablejsapi=1&origin=' + encodeURIComponent(location.origin) + '" title="' + esc(v.t) + '" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
        '<div class="vd-shield"></div>' +
        '<div class="vd-bar"><button type="button" class="vd-pp" aria-label="Pausa"></button><span class="vd-tm">0:00 / 0:00</span><div class="vd-prog" role="slider" aria-label="Avance del vídeo"><i></i></div><button type="button" class="vd-fs" aria-label="Pantalla completa"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>';
      frame = box.querySelector("iframe");
      frame.addEventListener("load", function () { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1 }), "*"); noCC(); setTimeout(noCC, 800); setTimeout(noCC, 2500); });
      paintBar();
    } else {
      box.innerHTML = '<button type="button" class="vd-poster" aria-label="Reproducir: ' + esc(v.t) + '"><img src="' + thumb(v) + '" alt=""><span class="vd-play"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span></button>';
    }
    document.getElementById("vd-title").textContent = v.t;
    Array.prototype.forEach.call(list.children, function (c, k) { c.classList.toggle("on", k === i); });
  }
  list.innerHTML = data.map(function (v, i) {
    return '<button type="button" class="vd-item" data-i="' + i + '"><span class="vd-th"><img loading="lazy" src="' + thumb(v) + '" alt=""></span><span class="vd-tx"><b>' + (i + 1) + ".</b> " + esc(v.t) + "</span></button>";
  }).join("");
  if (data.length > 20) { // lista larga: se añade un buscador por título
    var side = document.createElement("div"); side.className = "vd-side";
    var q = document.createElement("input"); q.type = "search"; q.className = "vd-q"; q.placeholder = "Buscar entre los " + data.length + " vídeos…"; q.setAttribute("aria-label", "Buscar vídeo");
    list.parentNode.insertBefore(side, list); side.appendChild(q); side.appendChild(list);
    var nz = function (s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
    q.addEventListener("input", function () {
      var t = nz(q.value).trim();
      Array.prototype.forEach.call(list.children, function (c, k) { c.hidden = !!t && nz(data[k].t).indexOf(t) < 0; });
    });
  }
  list.addEventListener("click", function (e) {
    var b = e.target.closest(".vd-item"); if (!b) return;
    show(+b.getAttribute("data-i"), true);
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  box.addEventListener("click", function (e) {
    if (e.target.closest(".vd-poster")) { show(cur, true); return; }
    if (e.target.closest(".vd-pp") || e.target.closest(".vd-shield")) { toggle(); return; }
    if (e.target.closest(".vd-fs")) { if (document.fullscreenElement) document.exitFullscreen(); else if (box.requestFullscreen) box.requestFullscreen(); return; }
    var pr = e.target.closest(".vd-prog");
    if (pr && st.d) { var r = pr.getBoundingClientRect(); cmd("seekTo", [st.d * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), true]); }
  });
  box.addEventListener("dblclick", function (e) { if (e.target.closest(".vd-shield") && box.requestFullscreen) { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen(); } });
  show(0, false);
})();
