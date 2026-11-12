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

  function pintar() {
    var albums = [];
    fotos.forEach(function (f) { if (f.album && albums.indexOf(f.album) < 0) albums.push(f.album); });
    if (filtro && albums.indexOf(filtro) < 0) filtro = "";
    chips.innerHTML = albums.length ? [""].concat(albums).map(function (a) {
      var n = a ? fotos.filter(function (f) { return f.album === a; }).length : fotos.length;
      return '<button type="button" role="tab" class="fg-chip" aria-selected="' + (a === filtro) + '" data-a="' + esc(a) + '">' + (a ? esc(a) : "Todas") + " <small>" + n + "</small></button>";
    }).join("") : "";
    $("fg-albums").innerHTML = albums.map(function (a) { return '<option value="' + esc(a) + '">'; }).join("");
    vista = filtro ? fotos.filter(function (f) { return f.album === filtro; }) : fotos.slice();
    $("fg-cuenta").textContent = vista.length ? vista.length + (vista.length === 1 ? " foto" : " fotos") : "";
    grid.removeAttribute("aria-busy");
    $("fg-vacio").hidden = fotos.length > 0;
    $("fg-ordenar").hidden = !admin || vista.length < 2 || ordenando;
    var celdas = vista.map(function (f, i) {
      return '<figure class="fg-cel" data-id="' + f.id + '"><button type="button" class="fg-item" data-i="' + i + '" style="aspect-ratio:' + f.w + "/" + f.h + '" aria-label="Ver foto' + (f.pie ? ": " + esc(f.pie) : f.album ? " de " + esc(f.album) : "") + '">' +
        '<img src="' + url("t", f.id) + '" alt="' + esc(f.pie || "") + '" loading="lazy" decoding="async" draggable="false" width="' + f.w + '" height="' + f.h + '" onload="this.classList.add(\'ok\')">' +
        (f.album && !filtro ? '<span class="fg-tag">' + esc(f.album) + "</span>" : "") + "</button>" +
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
  addEventListener("resize", function () { if (!ordenando && fotos.length && numCols() !== cols) pintar(); });

  chips.addEventListener("click", function (e) {
    var b = e.target.closest(".fg-chip"); if (!b || ordenando) return;
    filtro = b.getAttribute("data-a"); pintar();
  });
  grid.addEventListener("click", function (e) {
    if (ordenando) return;
    var b = e.target.closest(".fg-item"); if (b) abrir(+b.getAttribute("data-i"));
  });

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
    var f = vista[actual]; if (!f || !confirm("¿Borrar esta foto de la galería? No se puede deshacer.")) return;
    fetch(API + "/" + f.id, { method: "DELETE", headers: { "X-Clave": clave } }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.error); });
      fotos = fotos.filter(function (g) { return g.id !== f.id; });
      var i = actual; pintar();
      if (vista.length) abrir(Math.min(i, vista.length - 1)); else cerrar();
    }).catch(function (e) { alert(e.message || "No se ha podido borrar"); });
  });

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
  cargar();
  accesoAdmin();
})();
