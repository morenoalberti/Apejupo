(function () {
  // Temas: [nombre, identificador de tema, pieza que lo representa], agrupados en tres bloques plegables
  var GRUPOS = [
    ["Mates", [["Mate en 1", "mateIn1", "wK"], ["Mate en 2", "mateIn2", "wK"], ["Mate en 3", "mateIn3", "wK"],
      ["Mate del pasillo", "backRankMate", "wR"], ["Mate ahogado", "smotheredMate", "wN"]]],
    ["Tácticas", [["Combinaciones", "combinations", "wN"], ["Horquilla", "fork", "wN"], ["Clavada", "pin", "wB"],
      ["Enfilada", "skewer", "wR"], ["Ataque descubierto", "discoveredAttack", "wB"], ["Sacrificio", "sacrifice", "wQ"],
      ["Desviación", "deflection", "wQ"], ["Atracción", "attraction", "wK"], ["Despejar", "clearance", "wR"],
      ["Pieza colgada", "hangingPiece", "bP"], ["Pieza atrapada", "trappedPiece", "bN"]]],
    ["Fases y otros", [["Apertura", "opening", "wN"], ["Medio juego", "middlegame", "wQ"], ["Finales", "endgame", "wK"],
      ["Promoción", "promotion", "wP"], ["Peón avanzado", "advancedPawn", "wP"], ["Zugzwang", "zugzwang", "bK"],
      ["Jugada tranquila", "quietMove", "wB"]]]
  ];
  // Temas que coinciden con una categoria del entrenador; el resto se abre como t-<tema>
  var CATEGORIA = { mateIn1: "mate1", mateIn2: "mate2", mateIn3: "mate3", endgame: "finales", combinations: "combinaciones" };
  var botones = document.getElementById("grupos"), cont = document.getElementById("temas");

  botones.innerHTML = GRUPOS.map(function (g, i) {
    return '<button type="button" class="grupo" data-g="' + i + '" aria-expanded="false">' + U.esc(g[0]) +
      ' <small>' + g[1].length + ' temas</small><span class="chev" aria-hidden="true"></span></button>';
  }).join("");
  cont.innerHTML = GRUPOS.map(function (g, i) {
    return '<div class="theme-grid tg" data-g="' + i + '" hidden>' + g[1].map(function (t) {
      return '<a class="theme" href="#entrenador" data-id="' + (CATEGORIA[t[1]] || "t-" + t[1]) + '">' +
        '<span class="pc"><img src="assets/pieces/' + t[2] + '.png" alt="" width="32" height="32"></span>' +
        '<span class="tn">' + U.esc(t[0]) + '<small class="cnt"></small></span></a>';
    }).join("") + "</div>";
  }).join("");

  function abre(i) {
    Array.prototype.forEach.call(botones.children, function (b) {
      b.setAttribute("aria-expanded", b.getAttribute("data-g") === String(i) ? "true" : "false");
    });
    Array.prototype.forEach.call(cont.children, function (d) { d.hidden = d.getAttribute("data-g") !== String(i); });
  }
  botones.addEventListener("click", function (e) {
    var b = e.target.closest("button.grupo"); if (!b) return;
    abre(b.getAttribute("aria-expanded") === "true" ? -1 : b.getAttribute("data-g"));
  });

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
    abre(-1);
  });
})();
