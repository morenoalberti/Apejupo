(function () {
  window.U = {
    // Nombre de ronda siempre en español («Round 3», «Runde 3», «Rodada 3»… → «Ronda 3»)
    ronda: function (n) {
      n = String(n || "").replace(/^\s*(\d+)\s*[.ºª°]*\s*(?:Round|Runde|Rodada|Ronde|Rond|Runda|Rundan|Kolo|Kierros|Tour|Turn|Turno|Raund|Раунд|Тур|Forduló|Tur)(?![A-Za-zÀ-ÿ])/i, "Ronda $1"); // «2.ª Rodada» → «Ronda 2»
      return n.replace(/^\s*(Round|Runde|Rodada|Ronde|Rond|Runda|Rundan|Kolo|Kierros|Tour|Turn|Turno|Raund|Раунд|Тур|Forduló|Tur)(?=\s*\d)/i, "Ronda");
    },
    // Ritmo de juego corto: solo «90 min + 30 s» (o «90 min / 40 jugadas + 30 min + 30 s»), sin «por jugada», «desde la jugada 1»…
    ritmo: function (tc) {
      var s = " " + String(tc || "").replace(/\\/g, "") + " ";
      if (/^\s*G?\d+\s*\+\s*\d+\s*$/i.test(s)) s = s.replace(/G?(\d+)\s*\+\s*(\d+)/i, "$1 min + $2 s");
      s = s.replace(/^\s*(\d+)\s*\+(?=\s*\d+\s*(?:sec|seg|sek|s\b|''|"))/i, "$1 min +").replace(/\bafter\b/gi, "después de");
      s = s.replace(/(\d+)h(\d+)/gi, function (_, h, m) { return (+h * 60 + +m) + " min"; })
        .replace(/(\d+)\s*(?:''|"|seconds?|secs?|seg|sek|s)(?![a-z])/gi, "$1 s")
        .replace(/(\d+)\s*(?:'|minutes?|mins?|minutos?)(?![a-z])/gi, "$1 min")
        .replace(/(\d+)\s*(?:moves?|jugadas?)\b/gi, "$1 jugadas")
        .replace(/\b(?:starting\s+)?from\s+move\s*\d+|\bdesde la jugada\s*\d+|\bmove\s*\d+/gi, "")
        .replace(/\/\s*(?:move|jugada)\b|\b(?:per|each|all|por)\s+(?:moves?|jugadas?)\b|\bincrement(?:o)?\b|\bde incremento\b/gi, "")
        .replace(/\bfor\s+(?=\d+ jugadas)/gi, "/ ").replace(/^\s*a\s+/i, "")
        .replace(/\s*,\s*/g, " + ").replace(/\s*([/+])\s*/g, " $1 ").replace(/[\s.+/]+$/, "").replace(/\s+/g, " ");
      return s.trim();
    },
    // Estado real de las rondas: a veces el organizador no cierra una ronda en Lichess y sigue «en juego» aunque las
    // siguientes ya se hayan jugado. Si una ronda posterior ya terminó o está en juego, las anteriores se dan por terminadas.
    // Una ronda empezada hace más de 24 h tampoco se está jugando, aunque Lichess la siga dando «en juego».
    enJuego: function (r) { return !!(r && r.ongoing && !(r.startsAt && Date.now() - r.startsAt > 864e5)); },
    rondas: function (rs) {
      rs = (rs || []).map(function (r) { return Object.assign({}, r); });
      var despues = false;
      for (var i = rs.length - 1; i >= 0; i--) {
        if (!rs[i].finished && ((despues) || (rs[i].ongoing && !U.enJuego(rs[i])))) { rs[i].finished = true; rs[i].ongoing = false; }
        if (rs[i].finished || rs[i].ongoing) despues = true;
      }
      return rs;
    },
    // Datos del torneo para el cuadro que sale al pasar el ratón por una tarjeta (atributo data-tip)
    tipAttr: function (t) {
      t = t || {}; var i = t.info || {};
      var d = { id: t.id || "", n: t.name || "", f: i.format || "", c: i.tc || "", l: i.location || "", d: t.dates || [], z: i.timeZone || "", p: i.players || "", s: t.tier || 0 };
      return ' data-tip="' + JSON.stringify(d).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") + '"';
    },
    // Tarjeta de un torneo de Lichess, la misma en Torneos Live y en la portada:
    // imagen, etiqueta, nombre, ronda y hora, y botón «Ver torneo» que abre nuestro visor (torneo.html)
    bcCard: function (it, badge, cls, withLink) {
      var t = it.tour || {}, r = it.round || {}, esc = U.esc;
      var img = t.image ? '<img loading="lazy" src="' + esc(U.safeUrl(t.image)) + '" alt="">' : "";
      var when = r.startsAt ? U.fmt(r.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      return '<article class="card" data-id="' + esc(t.id || "") + '"' + U.tipAttr(t) + '>' + img + '<div class="body">' +
        '<span class="badge ' + cls + '">' + badge + '</span>' +
        '<h4>' + esc(t.name) + '</h4>' +
        '<p class="meta">' + esc(U.ronda(r.name)) + (when ? " · " + esc(when) : "") + '</p>' +
        // Con ronda abierta se ve en nuestra web; «Próximamente» sin ronda queda solo informativa
        ((withLink || cls !== "soon") && r.id
          ? '<a class="more btn-view" target="_blank" rel="noopener" href="torneo.html?r=' + encodeURIComponent(r.id) + '&t=' + encodeURIComponent(t.name || "") + '">Ver torneo</a>'
          : "") +
        '</div></article>';
    },
    $: function (id) { return document.getElementById(id); },
    esc: function (s) {
      var d = document.createElement("div");
      d.textContent = s == null ? "" : String(s);
      return d.innerHTML;
    },
    safeUrl: function (u) { return /^https?:\/\//i.test(u || "") ? u : "#"; },
    fmt: function (d, opts) { return new Date(d).toLocaleString("es-ES", opts); }
  };
  // ---------- Tarjetas que se arrastran con el ratón para cambiarlas de sitio ----------
  function readOrder(key) { try { var o = JSON.parse(localStorage.getItem(key)); return Array.isArray(o) ? o : []; } catch (_) { return []; } }
  // Aplica a «list» el orden manual guardado en «key»: los elementos ya ordenados a mano conservan ese orden entre sí
  // (ocupando sus mismos huecos) y los nuevos se quedan donde les toca por el orden automático.
  U.applyOrder = function (list, key, idOf) {
    var pos = {}; readOrder(key).forEach(function (id, i) { pos[id] = i; });
    var slots = [], known = [];
    list.forEach(function (x, i) { if (pos[idOf(x)] != null) { slots.push(i); known.push(x); } });
    known.sort(function (a, b) { return pos[idOf(a)] - pos[idOf(b)]; });
    slots.forEach(function (s, k) { list[s] = known[k]; });
    return list;
  };
  // box: rejilla de tarjetas (.card con data-id) · keyFn(): clave de localStorage del orden actual · repaint(): repinta con el orden automático
  U.sortable = function (box, keyFn, repaint) {
    if (!box) return;
    var EASE = "transform .26s cubic-bezier(.2,.8,.2,1)";
    var el = null, sx = 0, sy = 0, px = 0, py = 0, gx = 0, gy = 0, active = false, raf = 0, justDragged = false;
    function cards() { return Array.prototype.filter.call(box.children, function (c) { return c.classList.contains("card"); }); }
    box.classList.add("sortable");
    // Botón para volver al orden automático: solo se ve si hay un orden manual guardado
    var reset = document.createElement("button");
    reset.type = "button"; reset.className = "btn-ghost order-reset"; reset.textContent = "Restablecer el orden automático"; reset.hidden = true;
    box.parentNode.insertBefore(reset, box.nextSibling);
    function sync() { reset.hidden = !readOrder(keyFn()).length || cards().length < 2; }
    reset.addEventListener("click", function () { try { localStorage.removeItem(keyFn()); } catch (_) {} repaint(); sync(); });
    if (window.MutationObserver) new MutationObserver(function () { if (!active) sync(); }).observe(box, { childList: true });
    sync();
    // Coloca la tarjeta arrastrada bajo el puntero, sea cual sea el hueco que ocupa ahora en la rejilla
    function follow() {
      el.style.transform = "";
      var r = el.getBoundingClientRect();
      el.style.transform = "translate(" + (px - gx - r.left) + "px," + (py - gy - r.top) + "px) scale(1.03)";
    }
    // Hueco (tarjeta) sobre el que está el puntero, según la posición real en la rejilla y no la animada: así no hay vaivenes
    function target() {
      var b = box.getBoundingClientRect(), x = px - b.left - box.clientLeft, y = py - b.top - box.clientTop, list = cards();
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c !== el && x >= c.offsetLeft && x <= c.offsetLeft + c.offsetWidth && y >= c.offsetTop && y <= c.offsetTop + c.offsetHeight) return c;
      }
      return null;
    }
    // Mueve la tarjeta al hueco de «t» y anima a las demás desde donde estaban hasta su sitio nuevo (FLIP)
    function moveTo(t) {
      var list = cards(), others = list.filter(function (c) { return c !== el; });
      var before = others.map(function (c) { return c.getBoundingClientRect(); });
      if (list.indexOf(el) < list.indexOf(t)) box.insertBefore(el, t.nextSibling); else box.insertBefore(el, t);
      others.forEach(function (c, i) {
        c.style.transition = "none"; c.style.transform = "";
        var a = c.getBoundingClientRect(), dx = before[i].left - a.left, dy = before[i].top - a.top;
        if (!dx && !dy) { c.style.transition = ""; return; }
        c.style.transform = "translate(" + dx + "px," + dy + "px)";
        c.getBoundingClientRect(); // fija el punto de partida antes de animar
        c.style.transition = EASE; c.style.transform = "";
      });
    }
    function frame() {
      if (!active) return;
      // cerca del borde superior o inferior de la ventana, la página se desplaza sola
      var vh = window.innerHeight, edge = 70, d = py < edge ? py - edge : py > vh - edge ? py - (vh - edge) : 0;
      if (d) window.scrollBy({ top: d * 0.25, behavior: "instant" });
      var t = target(); if (t) moveTo(t);
      follow();
      raf = requestAnimationFrame(frame);
    }
    function start() {
      active = true;
      var r = el.getBoundingClientRect(); gx = sx - r.left; gy = sy - r.top;
      el.classList.add("dragging"); document.body.classList.add("card-dragging");
      var s = window.getSelection && window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges();
      raf = requestAnimationFrame(frame);
    }
    function end() {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); document.removeEventListener("pointercancel", end);
      document.body.classList.remove("card-pressing");
      if (!active) { el = null; return; }
      active = false; cancelAnimationFrame(raf);
      var c = el; el = null; justDragged = true; setTimeout(function () { justDragged = false; }, 0);
      document.body.classList.remove("card-dragging");
      c.classList.add("dropping"); c.style.transition = EASE; c.style.transform = "";
      var done = function () { c.removeEventListener("transitionend", done); c.classList.remove("dragging", "dropping"); c.style.transition = ""; };
      c.addEventListener("transitionend", done); setTimeout(done, 320);
      try { localStorage.setItem(keyFn(), JSON.stringify(cards().map(function (x) { return x.getAttribute("data-id"); }).filter(Boolean))); } catch (_) {}
      sync();
    }
    function move(e) {
      px = e.clientX; py = e.clientY;
      if (!active && Math.abs(px - sx) + Math.abs(py - sy) > 8) start();
    }
    box.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0 || el) return;
      var c = e.target.closest && e.target.closest(".card");
      if (!c || c.parentNode !== box || !c.getAttribute("data-id") || cards().length < 2) return;
      el = c; sx = px = e.clientX; sy = py = e.clientY;
      // con el botón pulsado sobre la tarjeta ya sale la mano de arrastrar (sobre «Ver torneo» no, ahí se pulsa)
      if (!e.target.closest("a, button")) document.body.classList.add("card-pressing");
      document.addEventListener("pointermove", move); document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    });
    box.addEventListener("dragstart", function (e) { e.preventDefault(); }); // sin el arrastre nativo de imágenes y enlaces
    box.addEventListener("click", function (e) { if (justDragged) { e.preventDefault(); e.stopPropagation(); } }, true); // soltar no abre el torneo
  };

  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // ---------- Contenidos de terceros (Google Maps, YouTube, Twitch) ----------
  // Pueden instalar cookies, así que no se cargan hasta que el visitante lo pide. La decisión se recuerda (ver cookies.html).
  var TK = "apejupoTerceros", pendientes = [];
  U.terceros = {
    ok: function () { try { return localStorage.getItem(TK) === "1"; } catch (_) { return false; } },
    acepta: function () {
      try { localStorage.setItem(TK, "1"); } catch (_) {}
      var p = pendientes; pendientes = []; p.forEach(function (f) { f(); }); // se cargan también los demás avisos de la página
    },
    retira: function () { try { localStorage.removeItem(TK); } catch (_) {} }
  };
  // Pone un aviso con botón dentro de «box»; al pulsarlo (o si ya se aceptó antes) se ejecuta «cargar»
  U.aviso = function (box, o, cargar) {
    var viejo = box.querySelector(":scope > .terceros"); if (viejo) viejo.remove();
    if (U.terceros.ok()) { cargar(); return; }
    var d = document.createElement("div"); d.className = "terceros";
    d.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (o.icono || '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>') + '</svg>' +
      '<p class="t-h">' + o.titulo + '</p>' +
      '<p class="t-p">Al cargarlo, ' + o.quien + ' puede instalar cookies en tu navegador. <a href="cookies.html">Más información</a></p>' +
      '<button type="button" class="t-btn">' + o.boton + '</button>';
    box.appendChild(d);
    var hecho = false, ir = function () { if (hecho) return; hecho = true; d.remove(); cargar(); };
    pendientes.push(ir);
    d.querySelector(".t-btn").addEventListener("click", function () { ir(); U.terceros.acepta(); });
  };

  // Pie de página: sede del club (foto, dirección y mapa), el mismo en todas las páginas
  var pie = document.querySelector(".site-footer .wrap");
  if (pie && !pie.querySelector(".sede")) {
    var mapa = "https://maps.app.goo.gl/yKii3MrJB7TaUyds5",
      embed = "https://www.google.com/maps?q=" + encodeURIComponent("Centro Ciudadano Parque Mediterráneo, Calle Francisco Jiménez Lomas 11, 29004 Málaga") + "&z=16&output=embed";
    // Iconos de trazo (24×24), heredan el color del texto
    var ico = function (d) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; },
      I = {
        ruta: ico('<path d="m3 11 19-9-9 19-2-8-8-2Z"/>'),
        pin: ico('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
        edificio: ico('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>'),
        copiar: ico('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
        ok: ico('<path d="M20 6 9 17l-5-5"/>'),
        foto: ico('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>'),
        arriba: ico('<path d="m18 15-6-6-6 6"/>'),
        movil: ico('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>')
      },
      dir = "C/ Francisco Jiménez Lomas, 11, 29004 Málaga";
    pie.insertAdjacentHTML("afterbegin",
      '<div class="sede" id="sede">' +
        '<div class="sede-txt">' +
          '<span class="sede-eti">' + I.pin + 'Sede del club</span>' +
          '<h2>Dónde estamos</h2>' +
          '<ul class="sede-datos">' +
            '<li><span class="sede-ic">' + I.edificio + '</span><span><strong>Centro Ciudadano Parque Mediterráneo</strong></span></li>' +
            '<li><span class="sede-ic">' + I.pin + '</span><address>C/ Francisco Jiménez Lomas, 11<br>29004 Málaga</address></li>' +
          '</ul>' +
          '<div class="sede-btns">' +
            '<button type="button" class="sede-btn" data-copiar>' + I.copiar + '<span>Copiar dirección</span></button>' +
          '</div>' +
        '</div>' +
        '<a class="sede-foto" href="' + mapa + '" target="_blank" rel="noopener"><img src="assets/sede-club.webp" width="1080" height="716" loading="lazy" alt="Fachada del Centro Ciudadano Parque Mediterráneo, sede del club"><span class="sede-cap">' + I.foto + 'Nuestra sede</span></a>' +
        '<div class="sede-gmap-box"></div>' +
        // En el móvil, botón grande para abrir la ubicación (el enlace «Abrir en Maps» del mapa es muy pequeño)
        '<a class="sede-btn sede-llegar" href="' + mapa + '" target="_blank" rel="noopener">' + I.ruta + '<span>Cómo llegar</span></a>' +
        // A la derecha del mapa: código QR para abrir la ubicación en el móvil
        '<div class="sede-movil">' +
          '<span class="sede-eti">' + I.movil + 'Llévatelo al móvil</span>' +
          '<a class="sede-qr" href="' + mapa + '" target="_blank" rel="noopener" title="Abrir la ubicación en Google Maps"><img src="assets/qr-sede.svg" width="264" height="264" loading="lazy" alt="Código QR con la ubicación de la sede en Google Maps"></a>' +
          '<p class="sede-qr-txt">Escanéalo con la cámara del móvil para abrir la ubicación</p>' +
        '</div>' +
      '</div>');
    var gbox = pie.querySelector(".sede-gmap-box");
    U.mapaPie = function () { gbox.innerHTML = ""; ponMapa(); }; // al retirar el permiso (cookies.html) el mapa vuelve a taparse
    var ponMapa = function () { U.aviso(gbox,{ titulo: "Mapa de Google Maps", quien: "Google", boton: "Cargar mapa", icono: '<path d="M14.1 6 9.9 4 3 7v13l6.9-3 4.2 2L21 16V3l-6.9 3ZM9.9 4v13M14.1 6v13"/>' }, function () {
      gbox.innerHTML = '<iframe class="sede-gmap" src="' + embed + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen title="Mapa: Centro Ciudadano Parque Mediterráneo, Málaga"></iframe>';
    }); };
    ponMapa();
    // Línea final: escudo del club delante del copyright y «Volver arriba» a la derecha
    var cp = pie.querySelector(":scope > p:last-child");
    if (cp) {
      var fila = document.createElement("div"); fila.className = "pie-fila";
      cp.parentNode.insertBefore(fila, cp); fila.appendChild(cp);
      var marca = document.createElement("div"); marca.className = "pie-marca";
      fila.insertBefore(marca, cp); marca.innerHTML = '<img src="assets/icon.svg" width="22" height="22" alt="">'; marca.appendChild(cp);
      fila.insertAdjacentHTML("beforeend", '<nav class="pie-legal" aria-label="Información legal"><a href="aviso-legal.html">Aviso legal</a><a href="privacidad.html">Privacidad</a><a href="cookies.html">Cookies</a></nav>' +
        '<a class="pie-arriba" href="#">' + I.arriba + 'Volver arriba</a>');
      fila.querySelector(".pie-arriba").addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    }
    var bc = pie.querySelector("[data-copiar]");
    bc.addEventListener("click", function () {
      var hecho = function () { bc.innerHTML = I.ok + "<span>¡Copiada!</span>"; bc.classList.add("ok"); setTimeout(function () { bc.innerHTML = I.copiar + "<span>Copiar dirección</span>"; bc.classList.remove("ok"); }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(dir).then(hecho, function () {}); else { var t = document.createElement("textarea"); t.value = dir; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); hecho(); } catch (_) {} t.remove(); }
    });
  }

  // Punto rojo junto a «Torneos Live» cuando hay torneos en directo. Se consulta Lichess como mucho cada 5 minutos por visitante.
  var liveA = document.querySelector('.site-header nav > a[href="torneos-live.html"]');
  if (liveA) {
    var LK = "apejupoHayDirecto", pon = function (n) {
      if (!n || liveA.querySelector(".nav-dot")) return;
      // Delante del texto («● Torneos Live»), como las etiquetas de «en directo»; en el móvil queda entre el icono y el texto
      var txt = Array.prototype.filter.call(liveA.childNodes, function (c) { return c.nodeType === 3 && c.nodeValue.trim(); })[0];
      var dot = document.createElement("span"); dot.className = "nav-dot"; dot.title = "Hay torneos en directo";
      liveA.insertBefore(dot, txt || liveA.firstChild);
      liveA.insertAdjacentHTML("beforeend", '<span class="vh">(hay ' + n + ' en directo)</span>');
    };
    var ld = null; try { ld = JSON.parse(localStorage.getItem(LK)); } catch (_) {}
    if (ld && Date.now() - ld.t < 5 * 60 * 1000) pon(ld.n);
    else fetch("https://lichess.org/api/broadcast/top").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      var n = (j.active || []).filter(function (x) { return x.round && U.enJuego(x.round); }).length;
      try { localStorage.setItem(LK, JSON.stringify({ t: Date.now(), n: n })); } catch (_) {}
      pon(n);
    }).catch(function () {});
  }

  // Correo de contacto: en el HTML va partido («contacto [arroba] apejupo.com») para que los robots que buscan correos no lo lean;
  // aquí se convierte en un enlace normal. data-t cambia el texto visible (p. ej. «escríbenos»).
  Array.prototype.forEach.call(document.querySelectorAll(".email[data-u][data-d]"), function (s) {
    var m = s.getAttribute("data-u") + "@" + s.getAttribute("data-d"), a = document.createElement("a");
    a.href = "mailto:" + m; a.textContent = s.getAttribute("data-t") || m;
    s.replaceWith(a);
  });
  // Botones que ya son enlaces (p. ej. «Escríbenos» de Quiénes somos): solo se completa la dirección
  Array.prototype.forEach.call(document.querySelectorAll("a[data-mail][data-dom]"), function (a) {
    a.href = "mailto:" + a.getAttribute("data-mail") + "@" + a.getAttribute("data-dom");
  });

  // Página de cookies: estado del permiso para contenidos de terceros y botón para darlo o retirarlo
  var cbox = document.getElementById("consent-box");
  if (cbox) {
    var cEst = document.getElementById("consent-estado"), cBtn = document.getElementById("consent-btn");
    var pinta = function () {
      var on = U.terceros.ok();
      cbox.classList.toggle("on", on);
      cEst.innerHTML = on ? "<b>Permitido:</b> los mapas y vídeos de terceros se cargan directamente." : "<b>No permitido:</b> los mapas y vídeos de terceros esperan a que pulses su botón.";
      cBtn.textContent = on ? "Retirar el permiso" : "Permitir siempre";
      cBtn.hidden = false;
    };
    cBtn.addEventListener("click", function () {
      if (U.terceros.ok()) { U.terceros.retira(); if (U.mapaPie) U.mapaPie(); } else U.terceros.acepta();
      pinta();
    });
    pinta();
  }

  // ---------- Banderas: código de federación FIDE -> país (flagcdn.com), como en ChessRival ----------
  var ESPECIAL = {
    ALG: "dz", ANG: "ao", ANT: "ag", ARU: "aw", BAH: "bs", BAN: "bd", BAR: "bb", BER: "bm", BHU: "bt", BIZ: "bz", BOT: "bw",
    BRN: "bh", BRU: "bn", BUL: "bg", BUR: "bf", CAM: "kh", CAY: "ky", CHA: "td", CHI: "cl", CRC: "cr", CRO: "hr", CUR: "cw",
    DEN: "dk", ENG: "gb-eng", ESA: "sv", ESP: "es", FAI: "fo", FIJ: "fj", GAM: "gm", GCI: "gg", GER: "de", GEQ: "gq", SUI: "ch",
    NED: "nl", GRE: "gr", GRN: "gd", GUA: "gt", GUI: "gn", HAI: "ht", HON: "hn", INA: "id", IOM: "im", IRI: "ir", ISV: "vi",
    IVB: "vg", JCI: "je", KOS: "xk", KSA: "sa", KUW: "kw", LAT: "lv", LBA: "ly", LES: "ls", MAD: "mg", MAS: "my", MAW: "mw",
    MGL: "mn", MNC: "mc", MRI: "mu", MTN: "mr", MYA: "mm", NCA: "ni", NEP: "np", NGR: "ng", NIG: "ne", OMA: "om", PAR: "py",
    PHI: "ph", PLE: "ps", POR: "pt", PUR: "pr", RSA: "za", SCO: "gb-sct", SEY: "sc", SKN: "kn", SLO: "si", SOL: "sb", SRI: "lk",
    SUD: "sd", TAN: "tz", TGA: "to", TOG: "tg", TPE: "tw", UAE: "ae", URU: "uy", VAN: "vu", VIE: "vn", VIN: "vc", WLS: "gb-wls",
    NIR: "gb-nir", ZAM: "zm", ZIM: "zw", FID: "", NON: ""
  };
  var ISO3 = {
    ALB: "al", AND: "ad", ARG: "ar", ARM: "am", AUS: "au", AUT: "at", AZE: "az", BEL: "be", BIH: "ba", BLR: "by", BOL: "bo",
    BRA: "br", CAN: "ca", CHN: "cn", COL: "co", CUB: "cu", CYP: "cy", CZE: "cz", DOM: "do", ECU: "ec", EGY: "eg", EST: "ee",
    FIN: "fi", FRA: "fr", GBR: "gb", GEO: "ge", GHA: "gh", HKG: "hk", HUN: "hu", IND: "in", IRL: "ie", IRQ: "iq", ISL: "is",
    ISR: "il", ITA: "it", JAM: "jm", JOR: "jo", JPN: "jp", KAZ: "kz", KEN: "ke", KGZ: "kg", KOR: "kr", LBN: "lb", LIE: "li",
    LTU: "lt", LUX: "lu", MAR: "ma", MDA: "md", MEX: "mx", MKD: "mk", MLT: "mt", MNE: "me", NOR: "no", NZL: "nz", PAK: "pk",
    PAN: "pa", PER: "pe", POL: "pl", PRK: "kp", QAT: "qa", ROU: "ro", RUS: "ru", SGP: "sg", SMR: "sm", SRB: "rs", SVK: "sk",
    SWE: "se", SYR: "sy", THA: "th", TJK: "tj", TKM: "tm", TUN: "tn", TUR: "tr", UKR: "ua", USA: "us", UZB: "uz", VEN: "ve",
    YEM: "ye"
  };
  U.flagCode = function (fed) { var c = (fed || "").trim().toUpperCase(); return c in ESPECIAL ? ESPECIAL[c] : c in ISO3 ? ISO3[c] : ""; };
  /** Nombre del país en español a partir del código de federación FIDE («NOR» -> «Noruega»). */
  U.pais = function (fed) {
    var code = U.flagCode(fed);
    try { if (code && /^[a-z]{2}$/.test(code)) return new Intl.DisplayNames(["es"], { type: "region" }).of(code.toUpperCase()); } catch (e) {}
    return fed || "";
  };
  U.flag = function (fed) {
    var c = (fed || "").trim().toUpperCase();
    var code = c in ESPECIAL ? ESPECIAL[c] : c in ISO3 ? ISO3[c] : "";
    return code ? '<img class="flag" src="https://flagcdn.com/w40/' + code + '.png" alt="" width="20" height="14" loading="lazy">' : "";
  };

  // ---------- Fotos de jugadores ----------
  // Se piden a la API gratuita de ChessRival, que busca la foto del perfil público de FIDE (y, si no hay, Lichess o
  // Wikimedia Commons). No se guardan copias: cada foto se carga cuando la fila es visible.
  // Igual que ChessRival: primero su servidor intermedio de Cloudflare y, si no devuelve foto, su servidor principal,
  // que además guarda copias verificadas de algunos jugadores para cuando FIDE no responde.
  var FOTO_FUENTES = [
    "https://chessrival-api.chessrival-worker.workers.dev/api/fide/foto?id=",
    "https://chessrival.net/api/fide/foto?id=",
    "https://apejupo-eventos.chessrival-worker.workers.dev/?foto="  // nuestro propio Worker: lee la foto del perfil de FIDE
  ];
  var SIN_FOTO_MIN = 5, MAX_A_LA_VEZ = 4, activas = 0, cola = [];

  function fotosActivas() {
    try { return localStorage.getItem("fotosOff") !== "1"; } catch (e) { return true; }
  }
  U.fotosActivas = fotosActivas;
  U.setFotos = function (on) { try { localStorage.setItem("fotosOff", on ? "0" : "1"); } catch (e) {} };

  function sinFoto(id) {
    try { var t = +localStorage.getItem("fotoNo:" + id); return !!t && Date.now() - t < SIN_FOTO_MIN * 60000; } catch (e) { return false; }
  }
  function marcarSinFoto(id) { try { localStorage.setItem("fotoNo:" + id, String(Date.now())); } catch (e) {} }
  function siguiente() { while (activas < MAX_A_LA_VEZ && cola.length) cargar(cola.shift()); }
  function cargar(el) {
    var id = el.getAttribute("data-fid"), i = 0;
    activas++;
    (function probar() {
      var img = new Image(), hecho = false, t;
      function sig() { // esa fuente no tiene la foto, falló o no contesta: se prueba la siguiente
        if (hecho) return; hecho = true; clearTimeout(t); img.onload = img.onerror = null;
        if (++i < FOTO_FUENTES.length * 2) probar(); // dos vueltas: un fallo puntual de un servidor no deja al jugador sin foto
        else { marcarSinFoto(id); fin(); }
      }
      img.alt = "";
      img.decoding = "async";
      img.onload = function () { if (hecho) return; hecho = true; clearTimeout(t); el.textContent = ""; el.appendChild(img); el.classList.add("con-foto"); fin(); };
      img.onerror = sig;
      t = setTimeout(sig, 7000); // si un servidor se queda sin responder, no se bloquea la cola de fotos
      img.src = FOTO_FUENTES[i % FOTO_FUENTES.length] + encodeURIComponent(id);
    })();
  }
  function fin() { activas--; siguiente(); }

  var vigilante = "IntersectionObserver" in window ? new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (!e.isIntersecting) return;
      vigilante.unobserve(e.target);
      if (sinFoto(e.target.getAttribute("data-fid"))) return;
      cola.push(e.target);
      siguiente();
    });
  }, { rootMargin: "150px" }) : null;

  /** Iniciales («Apellido, Nombre» -> «AN») para el círculo que se ve hasta que llega la foto. */
  U.iniciales = function (nombre) {
    var p = String(nombre || "").split(",");
    var a = (p[0] || "").trim().charAt(0), b = (p[1] || "").trim().charAt(0);
    return (a + (b || (p[0] || "").trim().split(" ")[1] || "").charAt(0)).toUpperCase() || "?";
  };
  /** Círculo con las iniciales; si hay número FIDE, U.fotos() lo sustituye por la foto cuando se ve. */
  U.avatar = function (nombre, fideId) {
    return '<span class="av"' + (fideId ? ' data-fid="' + U.esc(fideId) + '"' : "") + ">" + U.esc(U.iniciales(nombre)) + "</span>";
  };
  /** Activa la carga de fotos de los elementos [data-fid] que haya dentro de `raiz`. */
  U.fotos = function (raiz) {
    if (!vigilante || !fotosActivas()) return;
    Array.prototype.forEach.call((raiz || document).querySelectorAll("[data-fid]:not([data-vista])"), function (el) {
      el.setAttribute("data-vista", "1");
      vigilante.observe(el);
    });
  };
})();


// ---------- Cuadro de información al pasar el ratón por las tarjetas de torneos ----------
(function () {
  var tip = null, cur = null, prizes = {}, asked = {};
  // El premio no es un dato aparte en Lichess: se busca en la descripción del torneo (solo si el organizador lo escribe)
  function findPrize(txt) {
    txt = String(txt || "").replace(/[*_`]/g, "");
    var re = /(?:prizes?(?:\s+(?:fund|pool|money))?|premios?|preis(?:geld|fonds)|prix)[^\n]{0,70}?((?:€|\$|£|USD|EUR)\s?\d[\d.,]*(?:\s?[kK]\b)?|\d[\d.,]*(?:\s?[kK]\b)?\s?(?:€|\$|£|USD|EUR|dollars|euros))/i;
    var m = re.exec(txt);
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
  }
  function loadPrize(d, el) {
    if (!d.id || asked[d.id]) return; asked[d.id] = 1;
    fetch("https://lichess.org/api/broadcast/" + encodeURIComponent(d.id)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var p = j && j.tour && findPrize((j.tour.description || "") + " " + ((j.tour.info && j.tour.info.prize) || ""));
      if (!p) return; prizes[d.id] = p;
      if (cur === el && tip && !tip.hidden) { tip.innerHTML = build(d); }
    }).catch(function () {});
  }
  function es(x) {
    return (x || "")
      .replace(/(\d+)[- ]players?\b/gi, "$1 jugadores")
      .replace(/(\d+)[- ]rounds?\s+(Swiss|Round[- ]Robin|Knockout)/i, function (_, n, k) { return ({ swiss: "Swiss", "round-robin": "Round-Robin", "round robin": "Round-Robin", knockout: "Knockout" })[k.toLowerCase()] + " a " + n + " rondas"; })
      .replace(/\bfor teams\b/i, "por equipos")
      .replace(/(\d+)\s*-\s*rounds?\s+(Swiss|Round[- ]Robin|Knockout)/i, "$2 a $1 rondas")
      .replace(/\b(Swiss|Round[- ]Robin|Knockout)\s+(\d+)\s*rounds?\b/i, "$1 a $2 rondas")
      .replace(/\bround[- ]robin\b/gi, "Round-Robin").replace(/\bseg\b/gi, "s").replace(/\bafter\b/gi, "después de")
      .replace(/\bmin(utes?)?\b/gi, "min").replace(/\bsec(onds?)?\b/gi, "s").replace(/\/\s*move\b/i, "por jugada").replace(/\bper move\b/i, "por jugada")
      .replace(/\bmoves\b/gi, "jugadas").replace(/\bhours?\b/gi, "h").replace(/\bplus\b/gi, "+");
  }
  function dd(ms, z, o) { var d = new Date(ms); try { return d.toLocaleDateString("es-ES", Object.assign({ timeZone: z || undefined }, o)); } catch (_) { return d.toLocaleDateString("es-ES", o); } }
  function build(d) {
    var rows = [];
    function row(k, v) { if (v) rows.push('<div><b>' + k + '</b><span>' + U.esc(v) + '</span></div>'); }
    var fm = es(d.f.replace(/\s*\d+[- ]players?\b\s*/i, " ").trim()), np = (/(\d+)[- ]players?\b/i.exec(d.f) || [])[1];
    row("Sitio de juego", d.l);
    row("Premios", prizes[d.id] || "");
    row("Sistema", fm);
    row("Ritmo", U.ritmo(d.c));
    if (d.d && d.d[0]) {
      var a = dd(d.d[0], d.z, { day: "numeric", month: "short", year: "numeric" }), b = d.d[1] ? dd(d.d[1], d.z, { day: "numeric", month: "short", year: "numeric" }) : a;
      row("Fechas", a === b ? a : "del " + dd(d.d[0], d.z, { day: "numeric", month: "short" }) + " al " + b);
    }
    row("Jugadores", np ? np : "");
    if (!rows.length) rows.push('<div class="tp-none">Sin más datos del organizador.</div>');
    return '<div class="tp-h">' + U.esc(d.n) + '</div>' + rows.join("");
  }
  function place(x, y) {
    var w = tip.offsetWidth, h = tip.offsetHeight, nx = x + 18, ny = y + 14;
    if (nx + w > innerWidth - 8) nx = Math.max(8, x - w - 18);
    if (ny + h > innerHeight - 8) ny = Math.max(8, innerHeight - h - 8);
    tip.style.left = nx + "px"; tip.style.top = ny + "px";
  }
  function hide() { if (tip) tip.hidden = true; cur = null; }
  document.addEventListener("mouseover", function (e) {
    var c = e.target.closest && e.target.closest("[data-tip]");
    if (!c) { hide(); return; }
    if (c === cur) return;
    var d; try { d = JSON.parse(c.getAttribute("data-tip")); } catch (_) { return; }
    if (!tip) { tip = document.createElement("div"); tip.className = "tour-tip"; tip.hidden = true; document.body.appendChild(tip); }
    cur = c; tip.innerHTML = build(d); tip.hidden = false; place(e.clientX, e.clientY); loadPrize(d, c);
  });
  document.addEventListener("mousemove", function (e) { if (cur && tip && !tip.hidden) place(e.clientX, e.clientY); });
  document.addEventListener("scroll", hide, true);
})();
