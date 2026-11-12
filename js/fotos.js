// Galería de fotos del club: se arrastran las fotos, se comprimen en el navegador y se suben al Worker (bucket R2).
// Ver es público; subir pide la clave del club una vez por dispositivo. Con la clave de administración se puede borrar.
(function () {
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var API = LOCAL ? "http://127.0.0.1:8787/fotos" : "https://apejupo-eventos.chessrival-worker.workers.dev/fotos";
  var LADO = 2000, LADO_MINI = 640, A_LA_VEZ = 3, MAX_ORIGINAL = 40 * 1024 * 1024;
  var $ = function (id) { return document.getElementById(id); };
  var drop = $("fg-drop"), file = $("fg-file"), cola = $("fg-cola"), grid = $("fg-grid"), chips = $("fg-chips");
  var album = $("fg-album"), capa = $("fg-capa"), sesion = $("fg-sesion");
  var fotos = [], filtro = "", vista = [], actual = -1, pendientes = [], activas = 0;
  var clave = leer("fg-clave"), admin = leer("fg-admin") === "1";

  function leer(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function guardar(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }
  function url(t, id) { return API + "/" + t + "/" + id; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  var FECHA = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" });

  // ───── Galería ─────
  function cargar() {
    fetch(API).then(function (r) { return r.json(); }).then(function (j) {
      fotos = j.fotos || []; pintar();
    }).catch(function () {
      grid.removeAttribute("aria-busy"); grid.innerHTML = "";
      $("fg-vacio").hidden = false; $("fg-vacio").textContent = "No se ha podido cargar la galería. Prueba de nuevo en un rato.";
    });
  }

  // ───── Vídeos: pestaña fija con los últimos vídeos del canal de YouTube del club (los lee el Worker del RSS) ─────
  var VID = "__videos__", CANAL = "https://www.youtube.com/@clubtrabajosos", videos = null, vidCont = $("fg-videos");
  function cargarVideos() {
    fetch(API.replace(/\/fotos$/, "/videos")).then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) { videos = j.videos || []; }).catch(function () { videos = []; })
      .then(function () { pintarChips(); if (filtro === VID) pintarVideos(); });
  }
  function pintarVideos() {
    if (videos === null) { $("fg-cuenta").textContent = ""; vidCont.innerHTML = '<p class="fg-vacio">Cargando vídeos…</p>'; return; }
    $("fg-cuenta").textContent = videos.length ? videos.length + (videos.length === 1 ? " vídeo" : " vídeos") : "";
    var canal = ""; // sin enlaces a YouTube: los vídeos se ven como propios de la web
    if (!videos.length) { vidCont.innerHTML = '<p class="fg-vacio">Ahora mismo no se pueden cargar los vídeos.</p>' + canal; return; }
    vidCont.innerHTML = '<div class="fg-vid-grid">' + videos.map(function (v, i) {
      return '<div class="fg-vid-card" data-v="' + i + '"><button type="button" class="fg-vid" data-v="' + i + '" aria-label="Ver el vídeo: ' + esc(v.titulo) + '">' +
        '<span class="fg-vid-img"><img src="https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'ok\')">' +
        '<span class="fg-vid-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span></span>' +
        '<span class="fg-vid-t">' + esc(v.titulo) + "</span>" +
        (v.fecha ? '<span class="fg-vid-f">' + FECHA.format(new Date(v.fecha)) + "</span>" : "") + "</button>" +
        (admin ? '<button type="button" class="fg-ed" aria-label="Cambiar el título del vídeo" title="Cambiar el título"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' : "") + "</div>";
    }).join("") + "</div>" + canal;
  }
  // Se ven todas las miniaturas; al pulsar una, el vídeo se abre grande en el centro de la pantalla (#fg-cine)
  var vidActual = -1, cine = $("fg-cine");
  // Reproductor propio sobre el de YouTube: sin título, enlaces, sugerencias ni subtítulos de YouTube.
  // El iframe es más alto que el marco y se recorta arriba y abajo, donde YouTube pinta sus rótulos; una capa encima recoge los clics.
  var yt = null, ytId = "", ytReloj = 0, ytApi = null;
  function apiYT() {
    if (!ytApi) ytApi = new Promise(function (ok) {
      if (window.YT && YT.Player) return ok();
      var antes = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (antes) antes(); ok(); };
      var s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
    });
    return ytApi;
  }
  function sinSubtitulos() { try { yt.unloadModule("captions"); yt.unloadModule("cc"); yt.setOption("captions", "track", {}); } catch (e) {} }
  function mmss(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); }
  function ytPintar() {
    if (!yt || !yt.getDuration) return;
    var d = yt.getDuration() || 0, t = yt.getCurrentTime() || 0, pos = $("fg-yt-pos");
    if (pos && !pos.matches(":active")) pos.value = d ? Math.round(t / d * 1000) : 0;
    if ($("fg-yt-tiempo")) $("fg-yt-tiempo").textContent = mmss(t) + " / " + mmss(d);
  }
  function ytEstado(e) {
    var m = $("fg-vid-marco"); if (!m) return;
    var s = e.data; // 1 reproduciendo, 2 pausa, 3 cargando, 0 terminado
    m.classList.toggle("empezado", s === 1 || s === 2 || s === 3);
    m.classList.toggle("reproduciendo", s === 1 || s === 3);
    $("fg-yt-pp").setAttribute("aria-label", s === 1 ? "Pausa" : "Reproducir");
    if (s === 1) sinSubtitulos();
    clearInterval(ytReloj); if (s === 1) ytReloj = setInterval(ytPintar, 250);
    ytPintar();
  }
  function arrancar() {
    var v = videos[vidActual]; if (!v) return;
    $("fg-vid-marco").classList.add("empezado");
    apiYT().then(function () {
      if (yt && ytId === v.id) { yt.playVideo(); return; }
      ytId = v.id;
      if (yt) { yt.loadVideoById(v.id); return; }
      yt = new YT.Player("fg-yt-player", {
        host: "https://www.youtube-nocookie.com", videoId: v.id,
        playerVars: { autoplay: 1, controls: 0, rel: 0, iv_load_policy: 3, cc_load_policy: 0, disablekb: 1, fs: 0, playsinline: 1, modestbranding: 1, hl: "es" },
        events: { onReady: function (e) { sinSubtitulos(); e.target.playVideo(); }, onStateChange: ytEstado, onApiChange: sinSubtitulos }
      });
    });
  }
  function alternar() {
    if (!yt || !yt.getPlayerState || ytId !== videos[vidActual].id) return arrancar();
    yt.getPlayerState() === 1 ? yt.pauseVideo() : yt.playVideo();
  }
  cine.addEventListener("input", function (e) {
    if (e.target.id === "fg-yt-pos" && yt && yt.getDuration) yt.seekTo(yt.getDuration() * e.target.value / 1000, true);
  });
  function ponerVideo(i) {
    var v = videos[i]; vidActual = i;
    var m = $("fg-vid-marco"); m.classList.remove("empezado", "reproduciendo");
    // la portada va en una variable: así no se queda encima del vídeo cuando empieza
    m.style.setProperty("--portada", "url(https://i.ytimg.com/vi/" + v.id + "/hqdefault.jpg)");
    if (yt && ytId !== v.id) { try { yt.stopVideo(); } catch (e) {} }
    $("fg-vid-t").textContent = v.titulo;
    $("fg-vid-f").textContent = v.fecha ? FECHA.format(new Date(v.fecha)) : "";
    $("fg-cine-prev").hidden = i === 0; $("fg-cine-next").hidden = i === videos.length - 1;
    if (!cine.open) { cine.showModal(); document.documentElement.classList.add("fg-sin-scroll"); }
    arrancar();
  }
  function cerrarCine() { if (cine.open) cine.close(); }
  cine.addEventListener("close", function () {
    document.documentElement.classList.remove("fg-sin-scroll");
    if (document.fullscreenElement) document.exitFullscreen();
    if (yt && yt.pauseVideo) { try { yt.pauseVideo(); } catch (e) {} }
  });
  cine.addEventListener("click", function (e) {
    if (e.target === cine || e.target.classList.contains("fg-cine-in")) return cerrarCine(); // clic en el fondo oscuro
    if (e.target.closest("#fg-cine-x")) return cerrarCine();
    if (e.target.closest("#fg-cine-prev")) return ponerVideo(vidActual - 1);
    if (e.target.closest("#fg-cine-next")) return ponerVideo(vidActual + 1);
    if (e.target.closest("#fg-yt-capa, #fg-yt-pp")) return alternar();
    if (e.target.closest("#fg-yt-son")) {
      if (!yt || !yt.isMuted) return;
      var mudo = !yt.isMuted(); mudo ? yt.mute() : yt.unMute();
      $("fg-vid-marco").classList.toggle("mudo", mudo);
      $("fg-yt-son").setAttribute("aria-label", mudo ? "Poner el sonido" : "Quitar el sonido");
      return;
    }
    if (e.target.closest("#fg-yt-full")) {
      var m = $("fg-vid-marco");
      if (document.fullscreenElement) document.exitFullscreen(); else if (m.requestFullscreen) m.requestFullscreen(); else if (m.webkitRequestFullscreen) m.webkitRequestFullscreen();
    }
  });
  cine.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft" && vidActual > 0) ponerVideo(vidActual - 1);
    else if (e.key === "ArrowRight" && vidActual < videos.length - 1) ponerVideo(vidActual + 1);
    else if (e.key === " ") { e.preventDefault(); alternar(); }
  });
  // Cambiar el título que se muestra (solo administración). Vacío = volver al título de YouTube.
  function editarTitulo(card) {
    var v = videos[+card.getAttribute("data-v")];
    if (!v || card.querySelector(".fg-pie-form")) return;
    card.querySelector(".fg-ed").hidden = true; card.querySelector(".fg-vid-t").hidden = true;
    card.insertAdjacentHTML("beforeend", '<form class="fg-pie-form"><input maxlength="150" aria-label="Título del vídeo"><span class="fg-acc"><button type="button" class="btn-ghost">Cancelar</button><button class="btn">Guardar</button></span><span class="fg-pie-err" role="alert"></span></form>');
    var fm = card.querySelector(".fg-pie-form"), inp = fm.querySelector("input"), ok = fm.querySelector(".btn");
    inp.value = v.titulo; inp.placeholder = v.original || "Título del vídeo"; inp.focus(); inp.select();
    fm.querySelector(".btn-ghost").addEventListener("click", pintarVideos);
    inp.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); pintarVideos(); } });
    fm.addEventListener("submit", function (e) {
      e.preventDefault(); ok.disabled = true;
      fetch(API.replace(/\/fotos$/, "/videos/titulo"), { method: "POST", headers: { "X-Clave": clave, "Content-Type": "application/json" }, body: JSON.stringify({ id: v.id, titulo: inp.value }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "No se ha podido guardar"); return j; }); })
        .then(function (j) { v.titulo = j.titulo || v.original || v.titulo; pintarVideos(); },
          function (err) { fm.querySelector(".fg-pie-err").textContent = err.message; ok.disabled = false; });
    });
  }
  vidCont.addEventListener("click", function (e) {
    var ed = e.target.closest(".fg-ed"); if (ed) { editarTitulo(ed.closest(".fg-vid-card")); return; }
    var b = e.target.closest(".fg-vid"); if (b) ponerVideo(+b.getAttribute("data-v"));
  });

  function pintarChips() {
    var albums = [];
    fotos.forEach(function (f) { if (f.album && albums.indexOf(f.album) < 0) albums.push(f.album); });
    if (filtro && filtro !== VID && albums.indexOf(filtro) < 0) filtro = "";
    chips.innerHTML = [VID, ""].concat(albums).map(function (a) {
      var n = a === VID ? (videos ? videos.length : "") : a ? fotos.filter(function (f) { return f.album === a; }).length : fotos.length;
      var txt = a === VID ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>Vídeos' : a ? esc(a) : "Todas";
      return '<button type="button" role="tab" class="fg-chip' + (a === VID ? " fg-chip-vid" : "") + '" aria-selected="' + (a === filtro) + '" data-a="' + esc(a) + '">' + txt + (n !== "" ? " <small>" + n + "</small>" : "") + "</button>";
    }).join("");
    return albums;
  }

  function pintar() {
    var albums = pintarChips();
    $("fg-albums").innerHTML = albums.map(function (a) { return '<option value="' + esc(a) + '">'; }).join("");
    var enVid = filtro === VID;
    grid.hidden = enVid; vidCont.hidden = !enVid;
    if (enVid) { grid.removeAttribute("aria-busy"); $("fg-vacio").hidden = true; $("fg-ordenar").hidden = true; pintarVideos(); return; }
    vista = filtro ? fotos.filter(function (f) { return f.album === filtro; }) : fotos.slice();
    $("fg-cuenta").textContent = vista.length ? vista.length + (vista.length === 1 ? " foto" : " fotos") : "";
    grid.removeAttribute("aria-busy");
    $("fg-vacio").hidden = fotos.length > 0;
    $("fg-ordenar").hidden = !admin || vista.length < 2 || ordenando;
    var celdas = vista.map(function (f, i) {
      return '<figure class="fg-cel" data-id="' + f.id + '"><button type="button" class="fg-item" data-i="' + i + '" style="aspect-ratio:' + f.w + "/" + f.h + '" aria-label="Ver foto' + (f.pie ? ": " + esc(f.pie) : f.album ? " de " + esc(f.album) : "") + '">' +
        '<img src="' + url("t", f.id) + '" alt="' + esc(f.pie || "") + '" loading="lazy" decoding="async" draggable="false" width="' + f.w + '" height="' + f.h + '" onload="this.classList.add(\'ok\')">' +
        (f.album && !filtro ? '<span class="fg-tag">' + esc(f.album) + "</span>" : "") + "</button>" +
        (!ordenando ? '<button type="button" class="fg-dl" aria-label="Descargar la foto" title="Descargar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg></button>' : "") +
        (!ordenando && admin ? '<button type="button" class="fg-del" aria-label="Borrar la foto" title="Borrar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/></svg></button>' : "") +
        (!ordenando && puedeEditar(f) ? '<button type="button" class="fg-ed" aria-label="' + (f.pie ? "Cambiar" : "Escribir") + ' el pie de foto" title="' + (f.pie ? "Cambiar" : "Escribir") + ' el pie"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' : "") +
        (f.pie ? '<figcaption class="fg-pie">' + esc(f.pie) + "</figcaption>" : "") + "</figure>";
    });
    if (ordenando) { grid.className = "fg-grid ordenando"; grid.innerHTML = celdas.join(""); return; }
    // Mosaico que se lee de izquierda a derecha: cada foto va a la columna más corta (así el orden elegido es el que se ve)
    cols = numCols(); grid.className = "fg-grid";
    var alto = [], html = [];
    for (var c = 0; c < cols; c++) { alto.push(0); html.push(""); }
    vista.forEach(function (f, i) {
      var k = alto.indexOf(Math.min.apply(null, alto));
      alto[k] += f.h / f.w + (f.pie ? .14 : 0) + .05;
      html[k] += celdas[i];
    });
    grid.innerHTML = html.map(function (h) { return '<div class="fg-col">' + h + "</div>"; }).join("");
  }
  var cols = 0;
  function numCols() { var w = grid.clientWidth || innerWidth; return w < 520 ? 2 : w < 760 ? 3 : 4; }
  addEventListener("resize", function () { if (!ordenando && filtro !== VID && fotos.length && numCols() !== cols) pintar(); });

  chips.addEventListener("click", function (e) {
    var b = e.target.closest(".fg-chip"); if (!b || ordenando) return;
    filtro = b.getAttribute("data-a"); pintar();
  });
  grid.addEventListener("click", function (e) {
    if (ordenando) return;
    var ed = e.target.closest(".fg-ed"); if (ed) { editarEnMosaico(ed.closest(".fg-cel")); return; }
    var del = e.target.closest(".fg-del");
    if (del) { var fid = del.closest(".fg-cel").getAttribute("data-id"); borrarFoto(fotos.filter(function (x) { return x.id === fid; })[0]); return; }
    var dl = e.target.closest(".fg-dl");
    if (dl) { var id = dl.closest(".fg-cel").getAttribute("data-id"); descargar(dl, url("f", id), "apejupo-" + id + ".webp"); return; }
    var b = e.target.closest(".fg-item"); if (b) abrir(+b.getAttribute("data-i"));
  });

  // Editar el pie directamente en el mosaico: el lápiz de cada foto cambia el pie por un campo de texto
  function editarEnMosaico(cel) {
    var id = cel.getAttribute("data-id"), f = fotos.filter(function (x) { return x.id === id; })[0];
    if (!f || cel.querySelector(".fg-pie-form")) return;
    var viejo = cel.querySelector(".fg-pie"); if (viejo) viejo.remove();
    cel.querySelector(".fg-ed").hidden = true;
    cel.insertAdjacentHTML("beforeend", '<form class="fg-pie-form"><input maxlength="200" placeholder="Escribe el pie de foto" aria-label="Pie de foto"><span class="fg-acc"><button type="button" class="btn-ghost">Cancelar</button><button class="btn">Guardar</button></span><span class="fg-pie-err" role="alert"></span></form>');
    var fm = cel.querySelector(".fg-pie-form"), inp = fm.querySelector("input"), ok = fm.querySelector(".btn");
    inp.value = f.pie || ""; inp.focus(); inp.select();
    fm.querySelector(".btn-ghost").addEventListener("click", pintar);
    inp.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); pintar(); } });
    fm.addEventListener("submit", function (e) {
      e.preventDefault(); ok.disabled = true;
      guardarPie(f, inp.value).catch(function (err) { fm.querySelector(".fg-pie-err").textContent = err.message; ok.disabled = false; });
    });
  }

  // ───── Ordenar arrastrando (solo administración) ─────
  // Se arrastra con el ratón o con el dedo; las demás fotos se apartan con una pequeña animación.
  var ordenando = false, arr = null;
  $("fg-ordenar").addEventListener("click", function () { ordenando = true; $("fg-ord-bar").hidden = false; pintar(); });
  $("fg-ord-no").addEventListener("click", function () { ordenando = false; $("fg-ord-bar").hidden = true; pintar(); });
  $("fg-ord-si").addEventListener("click", function () {
    var b = this; b.disabled = true;
    var nuevos = [].map.call(grid.querySelectorAll(".fg-cel"), function (el) { return el.getAttribute("data-id"); });
    // con un álbum filtrado, sus fotos se reordenan dentro de los mismos huecos que ocupan en la galería completa
    var dentro = {}; nuevos.forEach(function (id) { dentro[id] = 1; });
    var k = 0, porId = {}; fotos.forEach(function (f) { porId[f.id] = f; });
    var todas = fotos.map(function (f) { return dentro[f.id] ? porId[nuevos[k++]] : f; });
    fetch(API + "/orden", { method: "POST", headers: { "X-Clave": clave, "Content-Type": "application/json" }, body: JSON.stringify({ ids: todas.map(function (f) { return f.id; }) }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "No se ha podido guardar el orden"); }); })
      .then(function () { fotos = todas; ordenando = false; $("fg-ord-bar").hidden = true; pintar(); }, function (e) { alert(e.message); })
      .then(function () { b.disabled = false; });
  });
  grid.addEventListener("pointerdown", function (e) {
    if (!ordenando || e.button > 0) return;
    var cel = e.target.closest(".fg-cel"); if (!cel) return;
    e.preventDefault();
    var r = cel.getBoundingClientRect();
    arr = { cel: cel, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY };
    cel.classList.add("arrastrando");
    try { grid.setPointerCapture(e.pointerId); } catch (er) {}
  });
  grid.addEventListener("pointermove", function (e) {
    if (!arr) return;
    var cel = arr.cel;
    cel.style.transform = "translate(" + (e.clientX - arr.x) + "px," + (e.clientY - arr.y) + "px) scale(1.05)";
    cel.style.visibility = "hidden";
    var bajo = document.elementFromPoint(e.clientX, e.clientY);
    cel.style.visibility = "";
    var obj = bajo && bajo.closest(".fg-grid.ordenando .fg-cel");
    if (!obj || obj === cel) return;
    var lista = [].slice.call(grid.children), a = lista.indexOf(cel), b = lista.indexOf(obj);
    // FLIP: se anotan las posiciones, se mueve en el DOM y las fotos se deslizan a su sitio nuevo
    var antes = lista.map(function (el) { return el.getBoundingClientRect(); });
    var r0 = cel.getBoundingClientRect();
    grid.insertBefore(cel, a < b ? obj.nextSibling : obj);
    lista.forEach(function (el, i) {
      if (el === cel) return;
      var d = el.getBoundingClientRect(), x = antes[i].left - d.left, y = antes[i].top - d.top;
      if (!x && !y) return;
      el.style.transition = "none"; el.style.transform = "translate(" + x + "px," + y + "px)";
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.transition = ""; el.style.transform = ""; }); });
    });
    var r1 = cel.getBoundingClientRect(); // la foto arrastrada sigue bajo el dedo aunque haya cambiado de hueco
    arr.x += r1.left - r0.left; arr.y += r1.top - r0.top;
    cel.style.transform = "translate(" + (e.clientX - arr.x) + "px," + (e.clientY - arr.y) + "px) scale(1.05)";
  });
  function soltar() {
    if (!arr) return;
    var cel = arr.cel; arr = null;
    cel.classList.remove("arrastrando"); cel.style.transform = "";
  }
  grid.addEventListener("pointerup", soltar);
  grid.addEventListener("pointercancel", soltar);

  // ───── Visor a pantalla completa ─────
  var visor = $("fg-visor"), vimg = $("fg-v-img");
  function abrir(i) {
    if (!vista.length) return;
    actual = (i + vista.length) % vista.length;
    var f = vista[actual];
    vimg.classList.remove("ok");
    vimg.src = url("t", f.id); // la miniatura aparece al momento y la foto grande la sustituye al llegar
    var g = new Image(); g.onload = function () { if (vista[actual] === f) { vimg.src = g.src; vimg.classList.add("ok"); } }; g.src = url("f", f.id);
    pintarPie(f);
    $("fg-v-dl").href = url("f", f.id);
    $("fg-v-dl").setAttribute("download", "apejupo-" + f.id + ".webp");
    $("fg-v-del").hidden = !admin;
    $("fg-v-ed").hidden = !puedeEditar(f);
    var varias = vista.length > 1;
    $("fg-v-prev").hidden = $("fg-v-next").hidden = !varias;
    if (!visor.open) { visor.showModal(); document.documentElement.classList.add("fg-sin-scroll"); }
  }
  function cerrar() { if (visor.open) visor.close(); }

  // Descargar: las fotos están en el dominio del Worker y el navegador ignora «download» en enlaces de otro dominio
  // (abriría la imagen y sacaría al visitante de la galería). Se descarga el archivo y se guarda desde aquí.
  $("fg-v-dl").addEventListener("click", function (e) {
    e.preventDefault();
    descargar(this, this.href, this.getAttribute("download"));
  });
  function descargar(a, dir, nombre) {
    if (a.classList.contains("cargando")) return;
    a.classList.add("cargando");
    fetch(dir).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (b) {
      var u = URL.createObjectURL(b), t = document.createElement("a");
      t.href = u; t.download = nombre; document.body.appendChild(t); t.click(); t.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    }).catch(function () { alert("No se ha podido descargar la foto. Inténtalo de nuevo."); })
      .then(function () { a.classList.remove("cargando"); });
  }

  // Pie de foto: lo escribe quien la sube (puede corregirlo durante 24 h) y la administración puede cambiarlo siempre
  var editando = false;
  function puedeEditar(f) { return !!clave && (admin || Date.now() - f.ts < 24 * 3600 * 1000); }
  function pintarPie(f) {
    editando = false;
    $("fg-v-cap").innerHTML = (f.pie ? '<span class="fg-v-pie">' + esc(f.pie) + "</span>" : "") +
      '<span class="fg-v-meta">' + (f.album ? esc(f.album) + " · " : "") + FECHA.format(new Date(f.ts)) + ' <span class="fg-v-n">' + (actual + 1) + " / " + vista.length + "</span></span>";
  }
  function guardarPie(f, pie) {
    return fetch(API + "/" + f.id + "/pie", { method: "POST", headers: { "X-Clave": clave, "Content-Type": "application/json" }, body: JSON.stringify({ pie: pie }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "No se ha podido guardar"); return j; }); })
      .then(function (j) { f.pie = j.pie; pintar(); return j.pie; });
  }
  $("fg-v-ed").addEventListener("click", function () {
    var f = vista[actual]; if (!f || editando) return;
    editando = true;
    var cap = $("fg-v-cap"), viejo = cap.querySelector(".fg-v-pie");
    if (viejo) viejo.remove();
    cap.insertAdjacentHTML("afterbegin", '<form class="fg-v-form"><input maxlength="200" placeholder="Escribe el pie de foto" aria-label="Pie de foto"><button class="btn">Guardar</button></form>');
    var fm = cap.querySelector("form"), inp = fm.querySelector("input");
    inp.value = f.pie || ""; inp.focus();
    fm.addEventListener("submit", function (e) {
      e.preventDefault(); fm.querySelector("button").disabled = true;
      guardarPie(f, inp.value).then(function () { if (vista[actual] === f) pintarPie(f); }, function (err) { alert(err.message); fm.querySelector("button").disabled = false; });
    });
  });
  visor.addEventListener("cancel", function (e) { if (editando) { e.preventDefault(); pintarPie(vista[actual]); } }); // Escape cancela la edición sin cerrar el visor
  visor.addEventListener("close", function () { document.documentElement.classList.remove("fg-sin-scroll"); vimg.removeAttribute("src"); actual = -1; });
  $("fg-v-prev").addEventListener("click", function () { abrir(actual - 1); });
  $("fg-v-next").addEventListener("click", function () { abrir(actual + 1); });
  $("fg-v-x").addEventListener("click", cerrar);
  visor.addEventListener("click", function (e) { if (!editando && (e.target === visor || e.target.tagName === "FIGURE")) cerrar(); });
  visor.addEventListener("keydown", function (e) {
    if (editando) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); abrir(actual - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); abrir(actual + 1); }
  });
  var x0 = null;
  visor.addEventListener("touchstart", function (e) { x0 = e.touches.length === 1 && !editando ? e.touches[0].clientX : null; }, { passive: true });
  visor.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) abrir(actual + (dx < 0 ? 1 : -1));
  });
  $("fg-v-del").addEventListener("click", function () {
    var f = vista[actual], i = actual; if (!f) return;
    borrarFoto(f).then(function (hecho) {
      if (!hecho || !visor.open) return;
      if (vista.length) abrir(Math.min(i, vista.length - 1)); else cerrar();
    });
  });
  // Borrar una foto (solo administración): desde el visor o con la papelera de cada foto del mosaico
  function borrarFoto(f) {
    return confirmarBorrado(f).then(function (si) { if (si) return borrarYa(f); return false; });
  }
  // Ventana propia del club para confirmar (en lugar del aviso del navegador), con la miniatura de la foto
  function confirmarBorrado(f) {
    var d = $("fg-conf");
    $("fg-conf-img").src = url("t", f.id);
    $("fg-conf-pie").textContent = f.pie || "";
    return new Promise(function (ok) {
      var si = false;
      var fin = function () { d.removeEventListener("close", fin); $("fg-conf-si").onclick = $("fg-conf-no").onclick = null; ok(si); };
      $("fg-conf-si").onclick = function () { si = true; d.close(); };
      $("fg-conf-no").onclick = function () { d.close(); };
      d.addEventListener("close", fin);
      d.showModal(); $("fg-conf-no").focus(); // por defecto, el botón seguro
    });
  }
  function borrarYa(f) {
    return fetch(API + "/" + f.id, { method: "DELETE", headers: { "X-Clave": clave } }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || "No se ha podido borrar"); });
      fotos = fotos.filter(function (g) { return g.id !== f.id; });
      pintar();
      return true;
    }).catch(function (e) { alert(e.message === "Failed to fetch" ? "Sin conexión. Inténtalo de nuevo." : e.message); return false; });
  }

  // ───── Clave del club ─────
  var dlg = $("fg-clave"), ci = $("fg-clave-i"), ce = $("fg-clave-e"), alEntrar = null;
  function pintarSesion() {
    if (fotos.length) pintar(); // muestra u oculta «Ordenar» según la clave
    sesion.hidden = !clave;
    sesion.innerHTML = clave ? (admin ? "Administración" : "Socio") + ' · <button type="button" id="fg-salir">Salir</button>' : "";
  }
  // Acceso de administración sin botón visible: fotos.html#admin abre la ventana de la clave
  function accesoAdmin() {
    if (location.hash !== "#admin") return;
    history.replaceState(null, "", location.pathname + location.search);
    if (!admin) pedirClave(null);
  }
  addEventListener("hashchange", accesoAdmin);
  function pedirClave(luego) {
    alEntrar = luego; ce.textContent = ""; ci.value = "";
    dlg.showModal(); ci.focus();
  }
  $("fg-clave-x").addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("close", function () {
    if (!clave && pendientes.length) { pendientes.forEach(function (p) { p.li.remove(); }); pendientes = []; }
    alEntrar = null;
  });
  // La clave se comprueba sola en cuanto se termina de escribir (sin pulsar Enter). Se espera un instante tras la última
  // tecla para no gastar intentos con claves a medias (tras 8 fallos el servidor bloquea 15 minutos).
  var espera = null, enCurso = "";
  ci.addEventListener("input", function () {
    clearTimeout(espera); ce.textContent = "";
    if (ci.value.trim().length >= 4) espera = setTimeout(comprobar, 450);
  });
  $("fg-clave-f").addEventListener("submit", function (e) { e.preventDefault(); clearTimeout(espera); comprobar(); });
  function comprobar() {
    var c = ci.value.trim(); if (!c || c === enCurso) return;
    enCurso = c;
    var b = $("fg-clave-ok"); b.disabled = true; ce.textContent = "";
    fetch(API + "/acceso", { method: "POST", headers: { "X-Clave": c } }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Clave incorrecta"); return j; });
    }).then(function (j) {
      clave = c; admin = !!j.admin; guardar("fg-clave", c); guardar("fg-admin", admin ? "1" : "");
      pintarSesion(); var f = alEntrar; dlg.close(); if (f) f();
    }).catch(function (err) { ce.textContent = err.message === "Failed to fetch" ? "No hay conexión con el servidor" : err.message; })
      .then(function () { b.disabled = false; enCurso = ""; });
  }
  sesion.addEventListener("click", function (e) {
    if (e.target.id !== "fg-salir") return;
    e.stopPropagation(); clave = ""; admin = false; guardar("fg-clave", ""); guardar("fg-admin", ""); pintarSesion();
  });

  // ───── Arrastrar y elegir fotos ─────
  drop.addEventListener("click", function (e) { if (!e.target.closest(".fg-album, .fg-sesion")) file.click(); });
  drop.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target === drop) { e.preventDefault(); file.click(); } });
  file.addEventListener("change", function () { anadir(file.files); file.value = ""; });

  var hondo = 0;
  function conArchivos(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
  window.addEventListener("dragenter", function (e) { if (!conArchivos(e)) return; e.preventDefault(); hondo++; capa.classList.add("on"); });
  window.addEventListener("dragleave", function (e) { if (!conArchivos(e)) return; if (--hondo <= 0) { hondo = 0; capa.classList.remove("on"); } });
  window.addEventListener("dragover", function (e) { if (conArchivos(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  window.addEventListener("drop", function (e) {
    if (!conArchivos(e)) return;
    e.preventDefault(); hondo = 0; capa.classList.remove("on");
    anadir(e.dataTransfer.files);
  });
  document.addEventListener("paste", function (e) { // también se pueden pegar con Ctrl+V
    var fs = [].slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (fs.length && !e.target.closest("input")) anadir(fs);
  });

  function anadir(lista) {
    var nuevos = [].filter.call(lista || [], function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(f.name); });
    if (!nuevos.length) return;
    var a = album.value.replace(/\s+/g, " ").trim();
    nuevos.forEach(function (f) {
      var li = document.createElement("li");
      li.className = "fg-up";
      li.innerHTML = '<span class="fg-up-img"></span><span class="fg-up-t"><span class="fg-up-n"></span><span class="fg-up-e muted">En espera…</span></span>' +
        '<button type="button" class="fg-up-x" aria-label="Quitar de la lista" hidden>×</button>' +
        '<input class="fg-up-pie" maxlength="200" placeholder="Escribe un pie de foto…" aria-label="Pie de foto"><span class="fg-up-bar"><i></i></span>';
      li.querySelector(".fg-up-n").textContent = f.name;
      var prev = URL.createObjectURL(f), im = new Image();
      im.onload = function () { li.querySelector(".fg-up-img").style.backgroundImage = "url(" + prev + ")"; };
      im.src = prev;
      cola.prepend(li);
      var p = { f: f, li: li, album: a, prev: prev };
      var inp = li.querySelector(".fg-up-pie");
      // el pie escrito antes de terminar la subida viaja con la foto; si se escribe o corrige después, se guarda al salir del campo o con Enter
      var guarda = function () {
        if (!p.foto || inp.value.replace(/\s+/g, " ").trim() === (p.foto.pie || "")) return;
        estado(p, "Guardando el pie…");
        guardarPie(p.foto, inp.value).then(function () { estado(p, "Pie guardado ✓", "bien"); }, function (e) { estado(p, e.message, "mal"); });
      };
      inp.addEventListener("change", guarda);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      li.querySelector(".fg-up-x").addEventListener("click", function () { li.classList.add("fuera"); setTimeout(function () { li.remove(); URL.revokeObjectURL(prev); }, 400); });
      pendientes.push(p);
    });
    if (!clave) pedirClave(siguiente); else siguiente();
  }

  function estado(p, txt, cls, pct) {
    p.li.querySelector(".fg-up-e").textContent = txt;
    if (cls) p.li.className = "fg-up " + cls;
    if (pct != null) p.li.querySelector(".fg-up-bar i").style.width = pct + "%";
  }

  function siguiente() {
    while (activas < A_LA_VEZ && pendientes.length && clave) {
      var p = pendientes.shift(); activas++;
      subir(p).then(null, function () {}).then(function () { activas--; siguiente(); });
    }
  }

  function subir(p) {
    if (p.f.size > MAX_ORIGINAL) { estado(p, "Es demasiado grande (más de 40 MB)", "mal", 100); return Promise.resolve(); }
    estado(p, "Preparando…", "", 4);
    return preparar(p.f).then(function (r) {
      estado(p, "Subiendo…", "", 8);
      var fd = new FormData();
      fd.append("foto", r.foto, "foto"); fd.append("mini", r.mini, "mini");
      fd.append("w", r.w); fd.append("h", r.h); fd.append("album", p.album);
      fd.append("pie", p.li.querySelector(".fg-up-pie").value);
      return enviar(fd, function (pct) { estado(p, "Subiendo… " + Math.round(pct) + " %", "", 8 + pct * .92); });
    }).then(function (j) {
      p.foto = j;
      estado(p, j.pie ? "Subida con su pie ✓" : "Subida ✓ · añade un pie si quieres", "bien", 100);
      p.li.querySelector(".fg-up-x").hidden = false;
      fotos.unshift(j); pintar();
      var inp = p.li.querySelector(".fg-up-pie");
      if (document.activeElement !== inp && inp.value.replace(/\s+/g, " ").trim() !== (j.pie || "")) inp.dispatchEvent(new Event("change"));
    }, function (e) {
      if (e.status === 401) { clave = ""; admin = false; guardar("fg-clave", ""); pintarSesion(); pendientes.unshift(p); pedirClave(siguiente); estado(p, "Esperando la clave…", "", 0); return; }
      estado(p, e.message || "No se ha podido subir", "mal", 100);
      var re = document.createElement("button"); re.type = "button"; re.className = "fg-up-re"; re.textContent = "Reintentar";
      re.onclick = function () { re.remove(); pendientes.push(p); siguiente(); };
      p.li.querySelector(".fg-up-t").appendChild(re);
    });
  }

  function enviar(fd, progreso) {
    return new Promise(function (ok, mal) {
      var x = new XMLHttpRequest();
      x.open("POST", API);
      x.setRequestHeader("X-Clave", clave);
      x.upload.onprogress = function (e) { if (e.lengthComputable) progreso(e.loaded / e.total * 100); };
      x.onload = function () {
        var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) ok(j);
        else { var err = new Error(j.error || "Error " + x.status); err.status = x.status; mal(err); }
      };
      x.onerror = function () { mal(new Error("Sin conexión. Revisa internet y reinténtalo.")); };
      x.send(fd);
    });
  }

  // Reduce la foto (respetando la orientación del móvil) y crea una miniatura. WebP si el navegador sabe; si no, JPG.
  function preparar(f) {
    return decodificar(f).then(function (img) {
      var w = img.width, h = img.height;
      return Promise.all([lienzo(img, w, h, LADO, .85), lienzo(img, w, h, LADO_MINI, .78)]).then(function (r) {
        if (img.close) img.close();
        return { foto: r[0].blob, mini: r[1].blob, w: r[0].w, h: r[0].h };
      });
    });
  }
  function decodificar(f) {
    var falla = function () { throw new Error(/hei[cf]$/i.test(f.name) ? "Formato HEIC: compártela desde el móvil como JPG" : "No se puede abrir esta imagen"); };
    if (window.createImageBitmap) return createImageBitmap(f, { imageOrientation: "from-image" }).catch(function () { return porImagen(f); }).catch(falla);
    return porImagen(f).catch(falla);
  }
  function porImagen(f) {
    return new Promise(function (ok, mal) {
      var u = URL.createObjectURL(f), i = new Image();
      i.onload = function () { URL.revokeObjectURL(u); ok(i); };
      i.onerror = function () { URL.revokeObjectURL(u); mal(); };
      i.src = u;
    });
  }
  function lienzo(img, w, h, lado, q) {
    var k = Math.min(1, lado / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    var c = document.createElement("canvas"); c.width = cw; c.height = ch;
    var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cw, ch); // fondo blanco para PNG con transparencia
    x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, cw, ch);
    var aBlob = function (tipo) { return new Promise(function (ok) { c.toBlob(ok, tipo, q); }); };
    return aBlob("image/webp").then(function (b) { return b && b.type === "image/webp" ? b : aBlob("image/jpeg"); })
      .then(function (b) { if (!b) throw new Error("No se puede procesar esta imagen"); return { blob: b, w: cw, h: ch }; });
  }

  pintarSesion();
  cargar(); cargarVideos();
  accesoAdmin();
})();
