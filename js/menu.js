// Menú desplegable «Entrenamiento»: con el ratón se abre al pasar; con el dedo o el teclado, al pulsar
(function () {
  var m = document.querySelector(".menu"); if (!m) return;
  var b = m.querySelector(".menu-b");
  function set(o) { m.classList.toggle("open", o); if (!o) { var s = m.querySelector(".sub"); if (s) s.classList.remove("open"); } b.setAttribute("aria-expanded", o ? "true" : "false"); }
  b.addEventListener("click", function (e) { e.stopPropagation(); set(!m.classList.contains("open")); });
  // Submenú: con el dedo, el primer toque en «Finales» abre las secciones y el segundo entra en la página
  var st = m.querySelector(".sub-t");
  if (st) st.addEventListener("click", function (e) {
    var sub = st.parentNode;
    if (window.matchMedia("(hover: none)").matches && !sub.classList.contains("open")) { e.preventDefault(); sub.classList.add("open"); }
  });
  document.addEventListener("click", function (e) { if (!m.contains(e.target)) set(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
})();

// Menú del móvil: botón ☰ que despliega el menú en un panel, con un icono junto a cada opción
(function () {
  var head = document.querySelector(".site-header"), bar = head && head.querySelector(".bar"), nav = bar && bar.querySelector("nav");
  if (!nav) return;
  var svg = function (d) { return '<svg class="ni" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; };
  var ICONOS = {
    noticias: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>',
    "torneos-live": '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
    "torneos-proximos": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    elo: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    "quienes-somos": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    fotos: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    sede: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'
  };
  Array.prototype.forEach.call(nav.children, function (a) {
    if (a.tagName !== "A") return;
    var h = a.getAttribute("href") || "", k = /noticias/.test(h) ? "noticias" : /#sede/.test(h) ? "sede" : h.replace(/\.html.*$/, "");
    if (ICONOS[k]) a.insertAdjacentHTML("afterbegin", svg(ICONOS[k]));
  });
  if (!nav.id) nav.id = "menu-principal";
  var b = document.createElement("button");
  b.type = "button"; b.className = "nav-t"; b.setAttribute("aria-controls", nav.id); b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-label", "Abrir el menú");
  b.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path class="l1" d="M4 7h16"/><path class="l2" d="M4 12h16"/><path class="l3" d="M4 17h16"/></svg>';
  bar.insertBefore(b, nav);
  function abre(o) {
    head.classList.toggle("nav-open", o);
    b.setAttribute("aria-expanded", o ? "true" : "false");
    b.setAttribute("aria-label", o ? "Cerrar el menú" : "Abrir el menú");
  }
  b.addEventListener("click", function (e) { e.stopPropagation(); abre(!head.classList.contains("nav-open")); });
  nav.addEventListener("click", function (e) { var a = e.target.closest("a"); if (a && !a.classList.contains("sub-t")) abre(false); }); // al elegir una opción (p. ej. «Dónde estamos») se cierra
  document.addEventListener("click", function (e) { if (head.classList.contains("nav-open") && !head.contains(e.target)) abre(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") abre(false); });
  window.matchMedia("(min-width: 821px)").addEventListener("change", function (q) { if (q.matches) abre(false); });
})();
