// «Compartir» en las tarjetas de Torneos live: se dibuja la tarjeta del torneo como imagen (igual que en la web)
// para mandarla por WhatsApp. El enlace al torneo va siempre como texto, que es lo que se puede pulsar:
//  · en el móvil se abre el menú de compartir del teléfono con la imagen y el enlace;
//  · en el ordenador se copia la imagen al portapapeles y se ofrece «Copiar enlace» para pegarlo debajo.
(function () {
  if (!window.U) return;
  U.shareCards = true; // js/util.js (U.bcCard) añade el botón a las tarjetas
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var PROD = "https://apejupo-eventos.chessrival-worker.workers.dev";
  // En local se prueba primero el Worker del equipo (si está arrancado) y, si no, el publicado
  var WORKERS = LOCAL ? ["http://127.0.0.1:8787", PROD] : [PROD];
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var C = { bg: "#0B1422", card: "#14233a", line: "#22344f", text: "#E8EEF7", muted: "#93a4bd", blue: "#3B82F6",
    badge: { live: ["#dc2626", "#ffffff"], soon: ["#F59E0B", "#0F1B2D"], done: ["#3a3f4b", "#cfd6e4"] } };

  // La foto del torneo está en Lichess, que no deja leerla desde otra web: pasa por nuestro Worker
  function tryImg(url) {
    return new Promise(function (ok) {
      var im = new Image(), t = setTimeout(function () { ok(null); }, 5000); // sin foto antes que dejar esperando
      im.crossOrigin = "anonymous";
      im.onload = function () { clearTimeout(t); ok(im); }; im.onerror = function () { clearTimeout(t); ok(null); };
      im.src = url;
    });
  }
  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (!/^https:\/\/image\.lichess1?\.org\//.test(src)) return tryImg(src);
    var i = 0;
    function next() { if (i >= WORKERS.length) return null; return tryImg(WORKERS[i++] + "/?img=" + encodeURIComponent(src)).then(function (im) { return im || next(); }); }
    return next();
  }
  function rr(x, c, y, w, h, r) { x.beginPath(); x.moveTo(c + r, y); x.arcTo(c + w, y, c + w, y + h, r); x.arcTo(c + w, y + h, c, y + h, r); x.arcTo(c, y + h, c, y, r); x.arcTo(c, y, c + w, y, r); x.closePath(); }
  function lines(x, text, max) {
    var out = [], cur = "";
    text.split(/\s+/).forEach(function (w) { var t = cur ? cur + " " + w : w; if (x.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t; });
    if (cur) out.push(cur);
    return out;
  }
  // Dibujo de la tarjeta, como se ve en la web: foto, etiqueta, nombre y ronda
  function draw(info, img) {
    var S = 2, W = 560, P = 0, CW = W, PH = img ? Math.round(CW / 2.2) : 0, pad = 22;
    var m = document.createElement("canvas").getContext("2d");
    m.font = "700 26px " + FONT; var tl = lines(m, info.title, CW - 2 * pad);
    var H = PH + pad + 30 + 14 + tl.length * 34 + 8 + 24 + pad;
    var cv = document.createElement("canvas"); cv.width = W * S; cv.height = H * S;
    var x = cv.getContext("2d"); x.scale(S, S);
    rr(x, 0.5, 0.5, W - 1, H - 1, 14); x.fillStyle = C.card; x.fill(); x.strokeStyle = C.line; x.lineWidth = 1; x.stroke();
    var y = P;
    if (img) { // foto recortada como en la web (object-fit: cover)
      x.save(); rr(x, 0, 0, W, H, 14); x.clip();
      var r = Math.max(CW / img.width, PH / img.height), iw = img.width * r, ih = img.height * r;
      x.drawImage(img, P + (CW - iw) / 2, P + (PH - ih) / 2, iw, ih); x.restore();
      y += PH;
    }
    y += pad;
    var bc = C.badge[info.cls] || [C.blue, "#fff"];
    x.font = "700 14px " + FONT; var bw = x.measureText(info.badge).width + 20;
    rr(x, P + pad, y, bw, 26, 5); x.fillStyle = bc[0]; x.fill();
    x.fillStyle = bc[1]; x.textBaseline = "middle"; x.fillText(info.badge, P + pad + 10, y + 13.5);
    y += 30 + 14;
    x.fillStyle = C.text; x.font = "700 26px " + FONT; x.textBaseline = "alphabetic";
    tl.forEach(function (l) { y += 34; x.fillText(l, P + pad, y - 8); });
    y += 8;
    x.fillStyle = C.muted; x.font = "400 18px " + FONT; x.fillText(info.meta, P + pad, y + 18, CW - 2 * pad);
    return new Promise(function (ok) { cv.toBlob(ok, "image/png"); });
  }
  function infoOf(card) {
    var a = card.querySelector("a.btn-view"), b = card.querySelector(".badge");
    return {
      title: (card.querySelector("h4") || {}).textContent || "Torneo",
      meta: ((card.querySelector(".meta") || {}).textContent || "").trim(),
      badge: b ? b.textContent.trim() : "",
      cls: b ? (b.classList.contains("live") ? "live" : b.classList.contains("soon") ? "soon" : b.classList.contains("done") ? "done" : "") : "",
      img: (card.querySelector("img") || {}).src || "",
      url: a ? new URL(a.getAttribute("href"), location.href).href : location.href
    };
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
    return Promise.resolve();
  }
  // Aviso flotante abajo (en el ordenador). No va dentro de la tarjeta: la lista se vuelve a pintar al actualizarse.
  var hideT = null;
  function note(card, html) {
    var old = document.querySelector(".share-note"); if (old) old.remove();
    var n = document.createElement("div"); n.className = "share-note"; n.setAttribute("role", "status");
    n.innerHTML = '<button type="button" class="share-x" aria-label="Cerrar">×</button>' + html;
    document.body.appendChild(n);
    n.querySelector(".share-x").addEventListener("click", function () { n.remove(); });
    clearTimeout(hideT); hideT = setTimeout(function () { n.remove(); }, 20000);
    return n;
  }
  function download(blob) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "torneo.png"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-share]"); if (!btn) return;
    var card = btn.closest(".card"); if (!card) return;
    e.preventDefault();
    var info = infoOf(card);
    var blobP = loadImg(info.img).then(function (img) { return draw(info, img); });
    var phone = window.matchMedia && matchMedia("(pointer: coarse)").matches && navigator.canShare;
    btn.disabled = true;
    function done() { btn.disabled = false; }
    if (phone) {
      // Móvil: menú de compartir del teléfono (WhatsApp recibe la imagen y el enlace como texto, que sí se puede pulsar)
      blobP.then(function (blob) {
        var file = new File([blob], "torneo.png", { type: "image/png" }), data = { files: [file], text: info.title + "\n" + info.url };
        if (navigator.canShare(data)) return navigator.share(data).catch(function () {});
        return navigator.share({ title: info.title, text: info.title, url: info.url }).catch(function () {});
      }).then(done, done);
      return;
    }
    // Ordenador: la imagen al portapapeles (se pasa la promesa para no perder el permiso del clic mientras se dibuja)
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ "image/png": blobP })]).then(function () {
          ok = true;
          var n = note(card, '<b>Imagen copiada.</b> Pégala en WhatsApp con <kbd>Ctrl</kbd>+<kbd>V</kbd> y luego pega debajo el enlace para que se pueda abrir. ' +
            '<button type="button" class="share-link">Copiar enlace</button>');
          n.querySelector(".share-link").addEventListener("click", function () {
            var b = this; copyText(info.url).then(function () { b.textContent = "Enlace copiado ✓"; });
          });
        }).catch(function () {
          blobP.then(function (blob) { download(blob); note(card, "Tu navegador no deja copiar imágenes: se ha descargado <b>torneo.png</b>. Adjúntala en WhatsApp y añade el enlace."); });
        }).then(done, done);
        return;
      }
    } catch (_) {}
    blobP.then(function (blob) { download(blob); note(card, "Tu navegador no deja copiar imágenes: se ha descargado <b>torneo.png</b>. Adjúntala en WhatsApp y añade el enlace."); }).then(done, done);
  });
})();
