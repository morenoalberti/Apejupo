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
    grid.innerHTML = vista.map(function (f, i) {
      return '<button type="button" class="fg-item" data-i="' + i + '" style="aspect-ratio:' + f.w + "/" + f.h + '" aria-label="Ver foto' + (f.album ? " de " + esc(f.album) : "") + '">' +
        '<img src="' + url("t", f.id) + '" alt="" loading="lazy" decoding="async" width="' + f.w + '" height="' + f.h + '" onload="this.classList.add(\'ok\')">' +
        (f.album && !filtro ? '<span class="fg-tag">' + esc(f.album) + "</span>" : "") + "</button>";
    }).join("");
  }

  chips.addEventListener("click", function (e) {
    var b = e.target.closest(".fg-chip"); if (!b) return;
    filtro = b.getAttribute("data-a"); pintar();
  });
  grid.addEventListener("click", function (e) {
    var b = e.target.closest(".fg-item"); if (b) abrir(+b.getAttribute("data-i"));
  });

  // ───── Visor a pantalla completa ─────
  var visor = $("fg-visor"), vimg = $("fg-v-img");
  function abrir(i) {
    if (!vista.length) return;
    actual = (i + vista.length) % vista.length;
    var f = vista[actual];
    vimg.classList.remove("ok");
    vimg.src = url("t", f.id); // la miniatura aparece al momento y la foto grande la sustituye al llegar
    var g = new Image(); g.onload = function () { if (vista[actual] === f) { vimg.src = g.src; vimg.classList.add("ok"); } }; g.src = url("f", f.id);
    $("fg-v-cap").innerHTML = (f.album ? "<strong>" + esc(f.album) + "</strong> · " : "") + FECHA.format(new Date(f.ts)) + ' <span class="fg-v-n">' + (actual + 1) + " / " + vista.length + "</span>";
    $("fg-v-dl").href = url("f", f.id);
    $("fg-v-dl").setAttribute("download", "apejupo-" + f.id + ".webp");
    $("fg-v-del").hidden = !admin;
    var varias = vista.length > 1;
    $("fg-v-prev").hidden = $("fg-v-next").hidden = !varias;
    if (!visor.open) { visor.showModal(); document.documentElement.classList.add("fg-sin-scroll"); }
  }
  function cerrar() { if (visor.open) visor.close(); }
  visor.addEventListener("close", function () { document.documentElement.classList.remove("fg-sin-scroll"); vimg.removeAttribute("src"); actual = -1; });
  $("fg-v-prev").addEventListener("click", function () { abrir(actual - 1); });
  $("fg-v-next").addEventListener("click", function () { abrir(actual + 1); });
  $("fg-v-x").addEventListener("click", cerrar);
  visor.addEventListener("click", function (e) { if (e.target === visor || e.target.tagName === "FIGURE") cerrar(); });
  visor.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { e.preventDefault(); abrir(actual - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); abrir(actual + 1); }
  });
  var x0 = null;
  visor.addEventListener("touchstart", function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
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
    sesion.hidden = !clave;
    sesion.innerHTML = clave ? (admin ? "Administración" : "Socio") + ' · <button type="button" id="fg-salir">Salir</button>' : "";
  }
  function pedirClave(luego) {
    alEntrar = luego; ce.textContent = ""; ci.value = "";
    dlg.showModal(); ci.focus();
  }
  $("fg-clave-x").addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("close", function () {
    if (!clave && pendientes.length) { pendientes.forEach(function (p) { p.li.remove(); }); pendientes = []; }
    alEntrar = null;
  });
  $("fg-clave-f").addEventListener("submit", function (e) {
    e.preventDefault();
    var c = ci.value.trim(); if (!c) return;
    var b = $("fg-clave-ok"); b.disabled = true; ce.textContent = "";
    fetch(API + "/acceso", { method: "POST", headers: { "X-Clave": c } }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Clave incorrecta"); return j; });
    }).then(function (j) {
      clave = c; admin = !!j.admin; guardar("fg-clave", c); guardar("fg-admin", admin ? "1" : "");
      pintarSesion(); var f = alEntrar; dlg.close(); if (f) f();
    }).catch(function (err) { ce.textContent = err.message === "Failed to fetch" ? "No hay conexión con el servidor" : err.message; ci.select(); })
      .then(function () { b.disabled = false; });
  });
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
      li.innerHTML = '<span class="fg-up-img"></span><span class="fg-up-t"><span class="fg-up-n"></span><span class="fg-up-e muted">En espera…</span></span><span class="fg-up-bar"><i></i></span>';
      li.querySelector(".fg-up-n").textContent = f.name;
      var prev = URL.createObjectURL(f), im = new Image();
      im.onload = function () { li.querySelector(".fg-up-img").style.backgroundImage = "url(" + prev + ")"; };
      im.src = prev;
      cola.prepend(li);
      pendientes.push({ f: f, li: li, album: a, prev: prev });
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
      return enviar(fd, function (pct) { estado(p, "Subiendo… " + Math.round(pct) + " %", "", 8 + pct * .92); });
    }).then(function (j) {
      estado(p, "Subida", "bien", 100);
      fotos.unshift(j); pintar();
      setTimeout(function () { p.li.classList.add("fuera"); setTimeout(function () { p.li.remove(); URL.revokeObjectURL(p.prev); }, 400); }, 2200);
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
})();
