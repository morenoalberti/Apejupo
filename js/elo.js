// Pestaña «Apejupo»: los jugadores del equipo, con su Elo de club y sus ratings en directo de Lichess y Chess.com.
(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc;
  var players = D.players.slice().sort(function (a, b) { return b.elo - a.elo; });
  var body = $("elo-body");

  function norm(s) {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }
  function cell(id, v) { return '<td class="num" data-c="' + id + '">' + (v == null ? "–" : esc(v)) + "</td>"; }

  body.innerHTML = players.map(function (p, i) {
    return '<tr data-i="' + i + '" data-k="' + esc(norm(p.name)) + '"><td class="pos">' + (i + 1) + "</td>" +
      '<td><span class="jug">' + (p.foto ? '<span class="av con-foto"><img alt="" src="' + esc(p.foto) + '"></span>' : U.avatar(p.name, p.fide)) +
      "<span><strong>" + esc(p.name) + '</strong><div class="muted small">' + esc(p.title) + "</div></span></span></td>" +
      '<td class="num elo">' + esc(p.elo) + "</td>" +
      cell("lb", p.lichess ? "…" : null) + cell("lr", p.lichess ? "…" : null) +
      cell("cb", p.chesscom ? "…" : null) + cell("cr", p.chesscom ? "…" : null) + "</tr>";
  }).join("");
  U.fotos(body);

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

  // Buscador por nombre del equipo: devuelve cuántos jugadores coinciden
  window.eloEquipo = {
    filtrar: function (texto) {
      var q = norm(texto), n = 0;
      Array.prototype.forEach.call(body.children, function (tr) {
        var ok = !q || q.split(" ").every(function (t) { return tr.getAttribute("data-k").indexOf(t) >= 0; });
        tr.hidden = !ok;
        if (ok) n++;
      });
      return n;
    },
    total: players.length
  };
})();
