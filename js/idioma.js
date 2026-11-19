// Idioma de la web: banderas inglesa y española a la izquierda de «Entrar».
// La web está escrita en español; en inglés se traduce «en caliente», sin recargar: se recogen los textos
// visibles (y títulos, avisos y textos de ayuda), se traducen en el Worker de eventos (IA de Cloudflare,
// con caché) y se sustituyen en su sitio. Lo que la página va cambiando (torneos en directo, ventanas…)
// se traduce según aparece. Al volver al español se reponen los textos originales.
(function () {
  "use strict";
  var API = "https://apejupo-eventos.chessrival-worker.workers.dev/traducir";
  // En local (localhost:8080) se usa el Worker de pruebas del equipo (npx wrangler dev, puerto 8787).
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) API = "http://127.0.0.1:8787/traducir";
  try { var q = /[?&]traductor=([^&]+)/.exec(location.search); if (q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/traducir$/.test(decodeURIComponent(q[1]))) API = decodeURIComponent(q[1]); } catch (_) {} // pruebas en local
  var CLAVE = "apejupo-idioma", CACHE = "apejupo-traducciones-en-2", LOTE = 20, MAX_CACHE = 4000;
  var ATRIBUTOS = ["placeholder", "title", "aria-label", "alt"];
  var SALTAR = "script,style,noscript,code,pre,textarea,svg,canvas,iframe,[translate='no'],.notranslate,.lang-flags,.cu-nick,.to-board,.board,cg-board,.cm-content";

  var idioma = "es";
  try { idioma = localStorage.getItem(CLAVE) === "en" ? "en" : "es"; } catch (_) {}
  if (idioma === "en") document.documentElement.lang = "en"; // las fechas que pinte la página saldrán ya en inglés

  // ── Diccionario de la web: data/i18n/en.json ──
  // Pares «texto en español» → «texto en inglés», revisables a mano. Es lo primero que se usa; solo lo que
  // no está en él (noticias, nombres de torneos…) se pide al traductor automático. Se completa con
  // «node scripts/traducciones.mjs» (ver el propio script).
  var diccionario = {};
  var diccionarioListo = fetch("data/i18n/en.json", { cache: "no-cache" })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (d) { diccionario = d && typeof d === "object" ? d : {}; comodines = null; });
  function esperarDiccionario(hecho) { // como mucho 1,5 s: sin diccionario, se sigue con el traductor
    var listo = false, una = function () { if (!listo) { listo = true; hecho(); } };
    diccionarioListo.then(una); setTimeout(una, 1500);
  }

  // ── Memoria de traducciones (también entre páginas, en este navegador) ──
  var memoria = {};
  try { memoria = JSON.parse(localStorage.getItem(CACHE)) || {}; } catch (_) {}
  var guardarPendiente = null;
  function guardar() {
    if (guardarPendiente) return;
    guardarPendiente = setTimeout(function () {
      guardarPendiente = null;
      var claves = Object.keys(memoria);
      if (claves.length > MAX_CACHE) claves.slice(0, claves.length - MAX_CACHE).forEach(function (k) { delete memoria[k]; });
      try { localStorage.setItem(CACHE, JSON.stringify(memoria)); } catch (_) {}
    }, 800);
  }

  // ── Qué se traduce ──
  var SIGLAS = /^(ELO|FIDE|FEDA|FADA|GM|IM|MI|FM|MF|CM|WGM|WIM|WFM|WCM|AIM|ACM|PGN|TRF|BH|BH-1|SB|PJ|PTS|PROG|ID|URL|QR|OK|ECF|USCF)$/i;
  // Nombres «Apellidos, Nombre» (p. ej. «Pérez de la Fuente, Juan»): todas las palabras en mayúscula, salvo partículas.
  var PAL = /(?:[A-ZÁÉÍÓÚÑÜ][\p{Ll}'’-]*\.?|de|del|la|las|los|y|da|di|van|von|der|el)/u.source;
  var NOMBRE = new RegExp("^[A-ZÁÉÍÓÚÑÜ][\\p{Ll}'’-]+(?: " + PAL + "){0,4}, [A-ZÁÉÍÓÚÑÜ][\\p{Ll}'’-]*\\.?(?: " + PAL + "){0,3}$", "u");
  function traducible(txt) {
    var t = txt.trim();
    if (t.length < 2 || t.length > 1200) return false;
    if (!/[a-záéíóúñü]{2}/i.test(t)) return false; // números, horas, resultados, «½»…
    if (SIGLAS.test(t) || !/[aeiouáéíóú]/i.test(t) || /^[A-ZÁÉÍÓÚÑ]{2,3}$/.test(t)) return false; // siglas (ELO, GM, FIDE…), iniciales y palabras sin vocales
    if (NOMBRE.test(t) || /^apejupo$/i.test(t) || /^https?:\/\//.test(t) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return false;
    if (/[♔-♟]/.test(t) || /^\d+\.{1,3}\s*(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8]|O-O)/.test(t)) return false; // jugadas: «1. e4 e6 2. ♘c3…»
    return true;
  }
  // Textos con números («27 Torneos en directo», «Profundidad 22»): se traducen como plantilla
  // («{0} Torneos en directo») una sola vez y se rellenan con los números de cada caso.
  function plantilla(texto) {
    var numeros = [];
    var p = texto.replace(/\d+(?:[.,:]\d+)*/g, function (m) { numeros.push(m); return "{" + (numeros.length - 1) + "}"; });
    return { p: p, numeros: numeros };
  }
  function rellenar(tr, numeros) {
    for (var i = 0; i < numeros.length; i++) if (tr.indexOf("{" + i + "}") < 0) return null;
    return tr.replace(/\{(\d+)\}/g, function (m, i) { return numeros[+i] != null ? numeros[+i] : m; });
  }
  // Entradas con comodín en el diccionario: «Ver estadísticas de {*}» → «View statistics for {*}».
  // Lo que cubre el comodín (un nombre, una fecha…) se deja tal cual.
  var comodines = null;
  function porComodin(texto) {
    if (!comodines) {
      comodines = Object.keys(diccionario).filter(function (k) { return k.indexOf("{*}") >= 0 && diccionario[k]; }).map(function (k) {
        var re = "^" + k.split("{*}").map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("([\\s\\S]+?)") + "$";
        return { re: new RegExp(re), tr: diccionario[k] };
      });
    }
    for (var i = 0; i < comodines.length; i++) {
      var m = comodines[i].re.exec(texto);
      if (m) { var k = 1; return comodines[i].tr.replace(/\{\*\}/g, function () { return m[k++] || ""; }); }
    }
    return null;
  }
  function conocida(texto) {
    return (Object.prototype.hasOwnProperty.call(diccionario, texto) && diccionario[texto]) || memoria[texto] || null;
  }
  function saltar(el) { return !el || !!(el.closest && el.closest(SALTAR)); }

  // Textos y atributos que ya hemos cambiado: así se reponen al volver al español.
  var textos = new Set(), estadoTexto = new WeakMap(), elementos = new Set(), estadoAttr = new WeakMap();

  function partir(valor) { var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(valor); return { a: m[1], t: m[2], z: m[3] }; }

  var pendientes = new Map(); // texto original → [aplicadores]
  function pedir(texto, aplicar) {
    var ya = conocida(texto);
    if (ya) { aplicar(ya); return; }
    // Orden: texto exacto → plantilla con números («Ronda {0} de {1}») → comodín («Ronda {*}») → traductor.
    var pl = plantilla(texto), conNumeros = pl.numeros.length && pl.p !== texto && /[a-záéíóúñ]{2}/i.test(pl.p);
    var hecha = conNumeros && conocida(pl.p), lleno = hecha && rellenar(hecha, pl.numeros);
    if (lleno) { aplicar(lleno); return; }
    var comodin = porComodin(texto);
    if (comodin) { aplicar(comodin); return; }
    if (conNumeros && !hecha) { // se pide la plantilla; si el traductor se come algún {n}, se pide el texto tal cual
      encolar(pl.p, function (tr) { var r = rellenar(tr, pl.numeros); if (r) aplicar(r); else encolar(texto, aplicar); });
      return;
    }
    encolar(texto, aplicar);
  }
  function encolar(texto, aplicar) {
    if (!pendientes.has(texto)) pendientes.set(texto, []);
    pendientes.get(texto).push(aplicar);
    programar();
  }

  function nodoTexto(n) {
    var st = estadoTexto.get(n), valor = n.nodeValue;
    if (st && valor === st.tr) return; // ya está traducido
    if (st && valor !== st.tr) st.orig = valor; // la página lo cambió: nuevo original
    if (!traducible(valor)) return;
    var p = partir(valor);
    if (!st) { st = { orig: valor, tr: null }; estadoTexto.set(n, st); textos.add(n); }
    // El elemento ya trae su versión en inglés (p. ej. las noticias: data-en="…"): se usa tal cual.
    var el = n.parentElement;
    if (el && el.hasAttribute("data-en") && el.childNodes.length === 1) {
      st.tr = p.a + el.getAttribute("data-en") + p.z; if (idioma === "en") n.nodeValue = st.tr;
      return;
    }
    pedir(p.t, function (tr) {
      if (idioma !== "en" || n.nodeValue !== st.orig) return;
      st.tr = p.a + tr + p.z; n.nodeValue = st.tr;
    });
  }
  function atributosDe(el) {
    ATRIBUTOS.forEach(function (at) {
      var valor = el.getAttribute(at); if (valor == null) return;
      var mapa = estadoAttr.get(el) || {}, st = mapa[at];
      if (st && valor === st.tr) return;
      if (!traducible(valor)) return;
      st = mapa[at] = { orig: valor, tr: null }; estadoAttr.set(el, mapa); elementos.add(el);
      pedir(valor.trim(), function (tr) {
        if (idioma !== "en" || el.getAttribute(at) !== st.orig) return;
        st.tr = tr; el.setAttribute(at, tr);
      });
    });
  }
  function recorrer(raiz) {
    if (raiz.nodeType === 3) { if (!saltar(raiz.parentElement)) nodoTexto(raiz); return; }
    if (raiz.nodeType !== 1) return;
    if (saltar(raiz)) { if (!raiz.closest("[translate='no'],.notranslate")) atributosDe(raiz); return; }
    atributosDe(raiz);
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && saltar(n)) { if (!n.closest("[translate='no'],.notranslate")) atributosDe(n); return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) nodoTexto(n); else atributosDe(n); }
  }

  // ── Envío por lotes al traductor ──
  var temporizador = null, enVuelo = 0;
  function programar() { if (!temporizador) temporizador = setTimeout(enviar, 60); }
  function enviar() {
    temporizador = null;
    var lista = Array.from(pendientes.keys()).filter(function (t) { return !pendientes.get(t).enviado; });
    for (var i = 0; i < lista.length; i += LOTE) lote(lista.slice(i, i + LOTE));
  }
  function lote(grupo) {
    grupo.forEach(function (t) { pendientes.get(t).enviado = true; });
    enVuelo++; marcar();
    fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "en", texts: grupo }), signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        if (!j || !Array.isArray(j.translations)) throw 0; // respuesta que no es del traductor
        grupo.forEach(function (t, i) {
          var tr = j.translations && j.translations[i];
          var esperan = pendientes.get(t) || []; pendientes.delete(t);
          if (typeof tr === "string" && tr.trim()) { memoria[t] = tr; esperan.forEach(function (f) { f(tr); }); }
        });
        guardar();
      })
      .catch(function () { grupo.forEach(function (t) { pendientes.delete(t); }); fallo(); }) // sin traductor: se queda en español y se avisa
      .then(function () { enVuelo--; marcar(); });
  }
  // Si el traductor no responde, se avisa y las banderas vuelven al español.
  var avisado = false;
  function fallo() {
    if (avisado || idioma !== "en") return;
    avisado = true; setTimeout(function () { avisado = false; }, 4000);
    cambiar("es");
    var aviso = document.createElement("div");
    aviso.className = "lang-aviso notranslate"; aviso.setAttribute("role", "status");
    aviso.textContent = "No se ha podido traducir la página ahora. Inténtalo de nuevo en unos minutos.";
    document.body.appendChild(aviso);
    setTimeout(function () { aviso.remove(); }, 5000);
  }
  function marcar() { document.documentElement.classList.toggle("traduciendo", enVuelo > 0 && idioma === "en"); }

  // ── Traducción por adelantado ──
  // Con la página en español, en cuanto el navegador está libre se piden ya (en segundo plano) las
  // traducciones de sus textos. Así, al pulsar la bandera inglesa todo cambia al instante.
  function recoger(raiz, salida) {
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.nodeType === 1 && saltar(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (traducible(n.nodeValue) && !(n.parentElement && n.parentElement.hasAttribute("data-en"))) salida.add(n.nodeValue.trim()); }
      else ATRIBUTOS.forEach(function (at) { var v = n.getAttribute(at); if (v != null && traducible(v)) salida.add(v.trim()); });
    }
    return salida;
  }
  function anticipar() {
    if (idioma !== "es" || !document.body) return;
    var lista = recoger(document.body, new Set());
    if (traducible(tituloOriginal)) lista.add(tituloOriginal.trim());
    lista.forEach(function (texto) { if (!conocida(texto) && !pendientes.has(texto)) pedir(texto, function () {}); });
  }
  function anticiparLuego() {
    if (window.requestIdleCallback) requestIdleCallback(anticipar, { timeout: 3000 }); else setTimeout(anticipar, 1500);
  }

  // ── Cambios que hace la página mientras está en inglés ──
  var observador = new MutationObserver(function (cambios) {
    if (idioma !== "en") return;
    cambios.forEach(function (c) {
      if (c.type === "characterData") { if (!saltar(c.target.parentElement)) nodoTexto(c.target); }
      else if (c.type === "attributes") { if (!saltar(c.target)) atributosDe(c.target); }
      else c.addedNodes.forEach(recorrer);
    });
  });

  // Título de la pestaña: algunas páginas lo cambian después de cargar (p. ej. con el nombre del torneo).
  var tituloOriginal = document.title, tituloPuesto = null;
  function traducirTitulo() {
    if (!traducible(tituloOriginal)) return;
    var original = tituloOriginal;
    pedir(original, function (tr) { if (idioma === "en" && tituloOriginal === original) { tituloPuesto = tr; document.title = tr; } });
  }
  new MutationObserver(function () {
    if (document.title === tituloPuesto) return; // es nuestra traducción
    tituloOriginal = document.title;           // la página ha puesto un título nuevo (en español)
    if (idioma === "en") traducirTitulo();
  }).observe(document.head, { subtree: true, childList: true, characterData: true });
  function aIngles() {
    document.documentElement.lang = "en";
    recorrer(document.body);
    traducirTitulo();
    observador.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
  }
  function aEspanol() {
    observador.disconnect();
    pendientes.clear();
    textos.forEach(function (n) { var st = estadoTexto.get(n); if (st && st.tr && n.nodeValue === st.tr) n.nodeValue = st.orig; estadoTexto.delete(n); });
    elementos.forEach(function (el) {
      var mapa = estadoAttr.get(el) || {};
      Object.keys(mapa).forEach(function (at) { var st = mapa[at]; if (st.tr && el.getAttribute(at) === st.tr) el.setAttribute(at, st.orig); });
      estadoAttr.delete(el);
    });
    textos.clear(); elementos.clear();
    document.documentElement.lang = "es";
    tituloPuesto = null; document.title = tituloOriginal;
  }

  // ── Banderas ──
  var GB = '<svg viewBox="0 0 60 30" aria-hidden="true"><clipPath id="lf-gb"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="lf-gb2"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#lf-gb)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#lf-gb2)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>';
  var ES = '<svg viewBox="0 0 60 40" aria-hidden="true"><path d="M0 0h60v40H0z" fill="#AA151B"/><path d="M0 10h60v20H0z" fill="#F1BF00"/></svg>';
  function botones() {
    var chip = document.getElementById("cuenta-chip");
    if (!chip || document.querySelector(".lang-flags")) return;
    var caja = document.createElement("div");
    caja.className = "lang-flags notranslate"; caja.setAttribute("translate", "no");
    caja.setAttribute("role", "group"); caja.setAttribute("aria-label", "Idioma / Language");
    caja.innerHTML = '<button type="button" data-lang="en" title="English" aria-label="English">' + GB + '</button>' +
      '<button type="button" data-lang="es" title="Español" aria-label="Español">' + ES + '</button>';
    chip.parentNode.insertBefore(caja, chip);
    caja.addEventListener("click", function (e) { var b = e.target.closest("[data-lang]"); if (b) cambiar(b.getAttribute("data-lang")); });
    // Al acercar el ratón (o el dedo) a la bandera inglesa se piden ya los textos que la página haya cargado después.
    caja.querySelector('[data-lang="en"]').addEventListener("pointerenter", anticipar);
    caja.querySelector('[data-lang="en"]').addEventListener("focus", anticipar);
    pintar();
  }
  function pintar() {
    Array.prototype.forEach.call(document.querySelectorAll(".lang-flags [data-lang]"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-lang") === idioma ? "true" : "false");
    });
  }
  function cambiar(nuevo) {
    if (nuevo === idioma) return;
    idioma = nuevo;
    try { localStorage.setItem(CLAVE, idioma); } catch (_) {}
    pintar();
    if (idioma === "en") aIngles(); else aEspanol();
  }

  function iniciar() {
    botones();
    // «Entrar» lo pone cuenta.js: si aún no está, se esperan las banderas un momento.
    if (!document.querySelector(".lang-flags")) { var n = 0, t = setInterval(function () { botones(); if (document.querySelector(".lang-flags") || ++n > 40) clearInterval(t); }, 100); }
    esperarDiccionario(function () {
      if (idioma === "en") aIngles();
      else { anticiparLuego(); setTimeout(anticipar, 6000); } // otra vez cuando la página ya ha cargado lo suyo (noticias, torneos…)
    });
  }
  // Para scripts/traducciones.mjs: los textos traducibles de la página y los que aún no están en el diccionario.
  window.ApejupoIdioma = {
    textos: function () { var s = recoger(document.body, new Set()); if (traducible(tituloOriginal)) s.add(tituloOriginal.trim()); return Array.from(s); },
    faltan: function () { return this.textos().filter(function (t) { return !diccionario[t]; }); },
    listo: function () { return diccionarioListo; },
    // Para scripts/comprobar-traducciones.mjs: con la página en inglés, lo que sigue en español
    // (salvo lo que el diccionario deja igual a propósito, como nombres propios).
    sinTraducir: function () {
      var igual = function (t) { return diccionario[t] === t || memoria[t] === t; }, fuera = new Set();
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) { return n.nodeType === 1 && saltar(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
      });
      var n;
      while ((n = w.nextNode())) {
        if (n.nodeType === 3) {
          var st = estadoTexto.get(n), v = n.nodeValue;
          if (traducible(v) && !(st && st.tr && v === st.tr) && !igual(v.trim())) fuera.add(v.trim());
        } else {
          var mapa = estadoAttr.get(n) || {};
          ATRIBUTOS.forEach(function (at) {
            var v = n.getAttribute(at), st = mapa[at];
            if (v != null && traducible(v) && !(st && st.tr && v === st.tr) && !igual(v.trim())) fuera.add("[" + at + "] " + v.trim());
          });
        }
      }
      if (traducible(tituloOriginal) && document.title === tituloOriginal && !igual(tituloOriginal.trim())) fuera.add("[título] " + tituloOriginal);
      return Array.from(fuera);
    },
    pendientes: function () { return pendientes.size + enVuelo; },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
