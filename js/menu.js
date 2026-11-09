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
