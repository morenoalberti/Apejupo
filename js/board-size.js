(function () {
  "use strict";
  var grid = document.getElementById("lv-grid");
  if (!grid || document.getElementById("board-size-control") || !window.CSS || !CSS.supports("zoom", "1")) return;
  var KEY = "apejupoBoardSize", MIN = 75, MAX = 150, STEP = 5;
  var mobile = matchMedia("(max-width: 600px), (max-height: 500px) and (pointer: coarse)");
  function normalize(value) {
    var number = Number(value);
    return value === null || value === "" || !Number.isFinite(number) ? 100 : Math.max(MIN, Math.min(MAX, Math.round(number / STEP) * STEP));
  }
  var requested = 100;
  try { requested = normalize(localStorage.getItem(KEY)); } catch (_) {}
  var control = document.createElement("div"); control.id = "board-size-control"; control.className = "board-size-control";
  control.setAttribute("role", "group"); control.setAttribute("aria-label", "Tamaño de los tableros");
  control.innerHTML = '<label class="board-size-label" for="board-size-range">Tamaño de los tableros</label>' +
    '<div class="board-size-actions"><button type="button" id="board-size-less" aria-label="Reducir los tableros" title="Reducir los tableros">−</button>' +
    '<input type="range" id="board-size-range" min="75" max="150" step="5" value="100" aria-describedby="board-size-help">' +
    '<button type="button" id="board-size-more" aria-label="Ampliar los tableros" title="Ampliar los tableros">+</button>' +
    '<output id="board-size-value" for="board-size-range" translate="no">100 %</output>' +
    '<button type="button" id="board-size-reset">Restablecer</button></div>' +
    '<span id="board-size-help" class="sr-only">Ajusta el tablero, los nombres, el Elo y los relojes de cada partida.</span>';
  var toolbar = document.getElementById("lv-board-toolbar");
  if (toolbar) toolbar.insertBefore(control, toolbar.firstChild);
  else grid.parentNode.insertBefore(control, grid);
  var range = control.querySelector("input"), less = control.querySelector("#board-size-less"), more = control.querySelector("#board-size-more");
  var output = control.querySelector("output"), reset = control.querySelector("#board-size-reset");
  var effective = requested, lastWidth = -1, pending = 0;
  function apply() {
    var width = grid.clientWidth;
    if (width <= 0) return; // La ronda aún no se ha abierto.
    var gap = parseFloat(getComputedStyle(grid).columnGap) || 13;
    // Se conserva el ancho de referencia de la rejilla normal, sin medir tarjetas ya ampliadas.
    var columns = Math.max(1, Math.floor((width + gap) / (255 + gap)));
    var normalWidth = (width - gap * (columns - 1)) / columns;
    var available = mobile.matches ? 100 : Math.min(MAX, Math.floor(width / normalWidth * 100 / STEP) * STEP);
    effective = mobile.matches ? 100 : Math.min(requested, available);
    grid.style.setProperty("--match-scale", String(effective / 100));
    // Redondear hacia abajo evita que una fracción de píxel expulse la última columna.
    grid.style.setProperty("--match-column", Math.floor(normalWidth * effective / 100 * 64) / 64 + "px");
    grid.dataset.size = String(effective); grid.classList.add("lv-board-sized");
    range.max = String(available); range.value = String(effective);
    range.setAttribute("aria-valuetext", effective + " %"); output.textContent = effective + " %";
    less.disabled = effective <= MIN; more.disabled = effective >= available;
    more.title = more.disabled && available < MAX ? "Tamaño máximo para esta pantalla" : "Ampliar los tableros";
    reset.disabled = requested === 100;
  }
  function setSize(value) {
    if (mobile.matches) return;
    requested = normalize(value);
    try { if (requested === 100) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(requested)); } catch (_) {}
    apply();
  }
  range.addEventListener("input", function () { setSize(range.value); });
  less.addEventListener("click", function () { setSize(effective - STEP); });
  more.addEventListener("click", function () { setSize(effective + STEP); });
  reset.addEventListener("click", function () { setSize(100); });
  function resized() {
    var width = grid.clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    cancelAnimationFrame(pending); pending = requestAnimationFrame(apply);
  }
  if (window.ResizeObserver) new ResizeObserver(resized).observe(grid);
  window.addEventListener("resize", resized);
  mobile.addEventListener("change", apply);
  apply();
})();
