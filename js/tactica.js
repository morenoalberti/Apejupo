(function () {
  // Temas de Lichess: [nombre, identificador en lichess.org/training/<tema>, pieza que lo representa]
  var TEMAS = [
    ["Combinaciones", "combinations", "wN"], ["Mate en 1", "mateIn1", "wK"], ["Mate en 2", "mateIn2", "wK"], ["Mate en 3", "mateIn3", "wK"],
    ["Mate del pasillo", "backRankMate", "wR"], ["Mate ahogado", "smotheredMate", "wN"],
    ["Horquilla", "fork", "wN"], ["Clavada", "pin", "wB"], ["Enfilada", "skewer", "wR"],
    ["Ataque descubierto", "discoveredAttack", "wB"], ["Pieza colgada", "hangingPiece", "bP"],
    ["Sacrificio", "sacrifice", "wQ"], ["Desviación", "deflection", "wQ"], ["Atracción", "attraction", "wK"],
    ["Zugzwang", "zugzwang", "bK"], ["Pieza atrapada", "trappedPiece", "bN"], ["Despejar", "clearance", "wR"],
    ["Promoción", "promotion", "wP"], ["Peón avanzado", "advancedPawn", "wP"], ["Jugada tranquila", "quietMove", "wB"],
    ["Apertura", "opening", "wN"], ["Medio juego", "middlegame", "wQ"], ["Finales", "endgame", "wK"]
  ];
  // Temas que coinciden con una categoria del entrenador; el resto se abre como t-<tema>
  var CATEGORIA = { mateIn1: "mate1", mateIn2: "mate2", mateIn3: "mate3", endgame: "finales", combinations: "combinaciones" };
  var cont = document.getElementById("temas");
  cont.innerHTML = TEMAS.map(function (t) {
    return '<a class="theme" href="#entrenador-sec" data-id="' + (CATEGORIA[t[1]] || "t-" + t[1]) + '">' +
      '<span class="pc"><img src="assets/pieces/' + t[2] + '.png" alt="" width="32" height="32"></span>' +
      '<span class="tn">' + U.esc(t[0]) + '<small class="cnt"></small></span></a>';
  }).join("");
  // Numero de ejercicios de cada tema, desde el indice del entrenador
  fetch("data/tactica/indice.json").then(function (r) { return r.json(); }).then(function (d) {
    d.categorias.concat(d.temas || []).forEach(function (c) {
      var a = cont.querySelector('a.theme[data-id="' + c.id + '"] .cnt');
      if (a) a.textContent = c.n.toLocaleString("es-ES") + " ejercicios";
    });
  }).catch(function () {});
  cont.addEventListener("click", function (e) {
    var a = e.target.closest("a.theme"); if (!a || !window.Entrenador) return;
    e.preventDefault();
    window.Entrenador.abre(a.getAttribute("data-id"));
    document.getElementById("entrenador-sec").scrollIntoView({ behavior: "smooth" });
  });
})();
