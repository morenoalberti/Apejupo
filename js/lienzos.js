// Tableros a prueba del modo oscuro de los móviles (Samsung Internet y otros): ese modo recolorea los colores CSS,
// las imágenes de fondo y algunas piezas <img> (las negras salen grises), pero no lo que se dibuja en un lienzo (canvas).
// En cada tablero de la página este script:
//   - pinta el fondo del tablero en un lienzo detrás de las casillas (el último hijo, para no mover la numeración
//     de las casillas), y
//   - cambia las piezas <img> por lienzos con la misma figura, y
//   - dibuja en un lienzo el logotipo de la cabecera.
// Sigue funcionando aunque el tablero se vuelva a dibujar (vigila los cambios de la página).
(function () {
  "use strict";
  if (window.ApejupoLienzos) return;
  var TABLEROS = ".ent-board, .lv-hv .hv-b, #to-board, .to-mini, .e404-tablero";
  var PIEZAS_SUELTAS = ".to-promotion-options";
  var FONDO = "assets/tactics-board.png";
  var IMGS = {};
  function imagen(src) { var i = IMGS[src]; if (!i) { i = new Image(); i.src = src; IMGS[src] = i; } return i; }
  function dibuja(lienzo, src, ancho) {
    var i = imagen(src);
    var pinta = function () {
      lienzo.width = ancho || i.naturalWidth; lienzo.height = ancho || i.naturalHeight;
      lienzo.getContext("2d").drawImage(i, 0, 0, lienzo.width, lienzo.height);
    };
    if (i.complete && i.naturalWidth) pinta(); else i.addEventListener("load", pinta, { once: true });
  }
  // Tablero decorativo de la página 404: 4 × 4 cuadros verdes.
  function cuadros(c) {
    c.width = c.height = 512; var g = c.getContext("2d"), s = 128;
    for (var y = 0; y < 4; y++) for (var x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? "#769656" : "#eeeed2"; g.fillRect(x * s, y * s, s, s); }
  }
  // Una pieza <img> pasa a ser un lienzo con las mismas clases (más «pz-lienzo» para los estilos).
  function cambiaPiezas(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('img[src*="assets/pieces/"]'), function (img) {
      var c = document.createElement("canvas");
      c.className = (img.className ? img.className + " " : "") + "pz-lienzo";
      c.setAttribute("aria-hidden", "true");
      c.dataset.src = img.getAttribute("src");
      img.replaceWith(c);
      dibuja(c, c.dataset.src);
    });
  }
  function arregla(tablero) {
    if (!tablero.querySelector(":scope > canvas.bg-lienzo")) {
      var c = document.createElement("canvas");
      c.className = "bg-lienzo"; c.setAttribute("aria-hidden", "true");
      tablero.appendChild(c);
      if (tablero.matches(".e404-tablero")) cuadros(c); else dibuja(c, FONDO, 512);
    }
    cambiaPiezas(tablero);
  }
  // Logotipo de la cabecera (SVG): el modo oscuro lo deja casi sin color; dibujado en un lienzo se ve con sus colores.
  function logo(img) {
    var c = document.createElement("canvas");
    c.className = "logo-lienzo"; c.setAttribute("role", "img"); c.setAttribute("aria-label", img.getAttribute("alt") || "Apejupo Chess Club");
    c.width = 236 * 4; c.height = 64 * 4; // a 4 veces el tamaño del dibujo: nítido en cualquier pantalla
    img.replaceWith(c);
    var i = imagen(img.getAttribute("src")), pinta = function () { var g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height); g.drawImage(i, 0, 0, c.width, c.height); };
    if (i.complete && i.naturalWidth) pinta(); else i.addEventListener("load", pinta, { once: true });
  }
  function revisa(raiz) {
    if (!raiz || raiz.nodeType !== 1) return;
    Array.prototype.forEach.call(raiz.querySelectorAll('.brand img[src*="logo.svg"]'), logo);
    if (raiz.matches(TABLEROS)) arregla(raiz);
    Array.prototype.forEach.call(raiz.querySelectorAll(TABLEROS), arregla);
    var dentro = raiz.closest(TABLEROS); if (dentro && dentro !== raiz) arregla(dentro);
    if (raiz.matches(PIEZAS_SUELTAS)) cambiaPiezas(raiz);
    Array.prototype.forEach.call(raiz.querySelectorAll(PIEZAS_SUELTAS), cambiaPiezas);
    var suelta = raiz.closest(PIEZAS_SUELTAS); if (suelta) cambiaPiezas(suelta);
  }
  var pendiente = new Set(), programado = false;
  function procesa() { programado = false; pendiente.forEach(revisa); pendiente.clear(); }
  function arranca() {
    revisa(document.body);
    new MutationObserver(function (cambios) {
      cambios.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) pendiente.add(n); else if (n.parentElement) pendiente.add(n.parentElement); }); });
      // Al momento (antes de pintar la pantalla), para que no se vea ni un instante el tablero recoloreado.
      if (!programado) { programado = true; queueMicrotask(procesa); }
    }).observe(document.body, { childList: true, subtree: true });
  }
  window.ApejupoLienzos = { dibuja: dibuja };
  if (document.body) arranca(); else document.addEventListener("DOMContentLoaded", arranca);
})();
