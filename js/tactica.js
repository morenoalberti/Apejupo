(function () {
  // Temas de Lichess: [nombre, identificador en lichess.org/training/<tema>, pieza que lo representa]
  var TEMAS = [
    ["Mate en 1", "mateIn1", "wK"], ["Mate en 2", "mateIn2", "wK"], ["Mate en 3", "mateIn3", "wK"],
    ["Mate del pasillo", "backRankMate", "wR"], ["Mate ahogado", "smotheredMate", "wN"],
    ["Horquilla", "fork", "wN"], ["Clavada", "pin", "wB"], ["Enfilada", "skewer", "wR"],
    ["Ataque descubierto", "discoveredAttack", "wB"], ["Pieza colgada", "hangingPiece", "bP"],
    ["Sacrificio", "sacrifice", "wQ"], ["Desviación", "deflection", "wQ"], ["Atracción", "attraction", "wK"],
    ["Zugzwang", "zugzwang", "bK"], ["Pieza atrapada", "trappedPiece", "bN"], ["Despejar", "clearance", "wR"],
    ["Promoción", "promotion", "wP"], ["Peón avanzado", "advancedPawn", "wP"], ["Jugada tranquila", "quietMove", "wB"],
    ["Apertura", "opening", "wN"], ["Medio juego", "middlegame", "wQ"], ["Finales", "endgame", "wK"]
  ];
  document.getElementById("temas").innerHTML = TEMAS.map(function (t) {
    return '<a class="theme" target="_blank" rel="noopener" href="https://lichess.org/training/' + t[1] + '">' +
      '<span class="pc"><img src="assets/pieces/' + t[2] + '.png" alt="" width="32" height="32"></span>' +
      "<span>" + U.esc(t[0]) + "</span></a>";
  }).join("");
})();
