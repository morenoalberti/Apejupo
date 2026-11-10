(function () {
  window.U = {
    // Nombre de ronda siempre en español («Round 3», «Runde 3», «Rodada 3»… → «Ronda 3»)
    ronda: function (n) {
      n = String(n || "").replace(/^\s*(\d+)\s*[.ºª°]*\s*(?:Round|Runde|Rodada|Ronde|Rond|Runda|Rundan|Kolo|Kierros|Tour|Turn|Turno|Raund|Раунд|Тур|Forduló|Tur)(?![A-Za-zÀ-ÿ])/i, "Ronda $1"); // «2.ª Rodada» → «Ronda 2»
      return n.replace(/^\s*(Round|Runde|Rodada|Ronde|Rond|Runda|Rundan|Kolo|Kierros|Tour|Turn|Turno|Raund|Раунд|Тур|Forduló|Tur)(?=\s*\d)/i, "Ronda");
    },
    // Datos del torneo para el cuadro que sale al pasar el ratón por una tarjeta (atributo data-tip)
    tipAttr: function (t) {
      t = t || {}; var i = t.info || {};
      var d = { id: t.id || "", n: t.name || "", f: i.format || "", c: i.tc || "", l: i.location || "", d: t.dates || [], z: i.timeZone || "", p: i.players || "", s: t.tier || 0 };
      return ' data-tip="' + JSON.stringify(d).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") + '"';
    },
    // Lo mismo para torneos que no son de Lichess: título y filas [etiqueta, valor] ya preparadas
    tipRows: function (name, rows) {
      var d = { n: name || "", r: rows.filter(function (x) { return x[1]; }) };
      return ' data-tip="' + JSON.stringify(d).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") + '"';
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
      document.addEventListener("pointermove", move); document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    });
    box.addEventListener("dragstart", function (e) { e.preventDefault(); }); // sin el arrastre nativo de imágenes y enlaces
    box.addEventListener("click", function (e) { if (justDragged) { e.preventDefault(); e.stopPropagation(); } }, true); // soltar no abre el torneo
  };

  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

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
    function row(k, v) { if (v) rows.push('<div><b>' + U.esc(k) + '</b><span>' + U.esc(v) + '</span></div>'); }
    if (d.r) { // filas ya preparadas (U.tipRows)
      d.r.forEach(function (x) { row(x[0], x[1]); });
      if (!rows.length) rows.push('<div class="tp-none">Sin más datos del organizador.</div>');
      return '<div class="tp-h">' + U.esc(d.n) + '</div>' + rows.join("");
    }
    var fm = es(d.f.replace(/\s*\d+[- ]players?\b\s*/i, " ").trim()), np = (/(\d+)[- ]players?\b/i.exec(d.f) || [])[1];
    row("Sitio de juego", d.l);
    row("Premios", prizes[d.id] || "");
    row("Sistema", fm);
    row("Ritmo", es(d.c));
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
