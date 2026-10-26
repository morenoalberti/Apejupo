(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc;
  // ---------- Pestañas FIDE / FADA ----------
  var tabs = $("elo-tabs");
  tabs.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]");
    if (!b) return;
    Array.prototype.forEach.call(tabs.children, function (t) {
      var on = t === b;
      t.setAttribute("aria-selected", on ? "true" : "false");
      $("panel-" + t.getAttribute("data-p")).hidden = !on;
    });
  });

  // ---------- Ficha FIDE por número ----------
  // La búsqueda por nombre la hace el propio buscador de FIDE incrustado.
  $("fide-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("fide-q").value.trim();
    if (!/^\d{3,}$/.test(q)) {
      $("fide-hint").textContent = "Escribe solo el número FIDE (cifras). Para buscar por nombre, usa el buscador de FIDE de aquí abajo.";
      return;
    }
    var url = "https://ratings.fide.com/profile/" + q;
    $("fide-frame").src = url;
    $("fide-open").href = url;
  });

  // ---------- Clasificación del equipo ----------
  var players = D.players.slice().sort(function (a, b) { return b.elo - a.elo; });
  var body = $("elo-body");

  function cell(id, v) { return '<td class="num" data-c="' + id + '">' + (v == null ? "–" : esc(v)) + "</td>"; }

  body.innerHTML = players.map(function (p, i) {
    return '<tr data-i="' + i + '"><td class="pos">' + (i + 1) + '</td>' +
      '<td><strong>' + esc(p.name) + '</strong><div class="muted small">' + esc(p.title) + '</div></td>' +
      '<td class="num elo">' + esc(p.elo) + '</td>' +
      cell("lb", p.lichess ? "…" : null) + cell("lr", p.lichess ? "…" : null) +
      cell("cb", p.chesscom ? "…" : null) + cell("cr", p.chesscom ? "…" : null) + "</tr>";
  }).join("");

  function set(i, id, v) {
    var td = body.querySelector('tr[data-i="' + i + '"] td[data-c="' + id + '"]');
    if (td) td.textContent = v == null ? "–" : v;
  }

  players.forEach(function (p, i) {
    if (p.lichess) {
      fetch("https://lichess.org/api/user/" + encodeURIComponent(p.lichess))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var pf = j.perfs || {};
          set(i, "lb", pf.blitz && pf.blitz.rating);
          set(i, "lr", pf.rapid && pf.rapid.rating);
        })
        .catch(function () { set(i, "lb", null); set(i, "lr", null); });
    }
    if (p.chesscom) {
      fetch("https://api.chess.com/pub/player/" + encodeURIComponent(p.chesscom.toLowerCase()) + "/stats")
        .then(function (r) { return r.json(); })
        .then(function (j) {
          set(i, "cb", j.chess_blitz && j.chess_blitz.last && j.chess_blitz.last.rating);
          set(i, "cr", j.chess_rapid && j.chess_rapid.last && j.chess_rapid.last.rating);
        })
        .catch(function () { set(i, "cb", null); set(i, "cr", null); });
    }
  });
})();
