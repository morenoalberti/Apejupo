// Pestaña «Apejupo»: los jugadores registrados en la web (cuentas confirmadas) con su nick y su ELO del club.
// El ELO del club empieza en 1500 y lo actualizan las partidas de torneos y retos entre cuentas.
(function () {
  var $ = U.$, esc = U.esc, body = $("elo-body"), players = [];
  var API = window.APEJUPO_TORNEOS_API || "";

  function norm(s) {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_ -]/g, " ").replace(/\s+/g, " ").trim();
  }
  function aviso(texto) { body.innerHTML = '<tr><td colspan="4" class="muted">' + esc(texto) + "</td></tr>"; }
  function avatar(p) {
    var ini = esc(U.iniciales(p.nick));
    if (!p.photo) return '<span class="av">' + ini + "</span>";
    return '<span class="av con-foto"><img alt="" loading="lazy" src="' + esc(API + "/api/cuentas/foto/" + p.photo) + '" data-i="' + ini +
      '" onerror="this.parentNode.classList.remove(\'con-foto\');this.replaceWith(this.dataset.i)"></span>';
  }
  function pintar() {
    if (!players.length) { aviso("Todavía no hay jugadores registrados."); return; }
    body.innerHTML = players.map(function (p, i) {
      return '<tr data-k="' + esc(norm(p.nick)) + '"><td class="pos">' + (i + 1) + "</td>" +
        '<td><span class="jug">' + avatar(p) + "<span><strong translate=\"no\">" + esc(p.nick) + "</strong></span></span></td>" +
        '<td class="num elo">' + esc(p.elo) + "</td>" +
        '<td class="num">' + esc(p.games) + "</td></tr>";
    }).join("");
    U.eloLabels(body.closest("table"), ["Puesto", "Jugador", "ELO club", "Partidas"]);
    if (window.eloEquipo.alCargar) window.eloEquipo.alCargar();
  }

  aviso("Cargando los jugadores del club…");
  var ctl = window.AbortController ? new AbortController() : null;
  var tope = setTimeout(function () { if (ctl) ctl.abort(); }, window.APEJUPO_TORNEOS_TIMEOUT || 75000);
  fetch(API + "/api/cuentas/ranking", ctl ? { signal: ctl.signal } : {})
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) { players = Array.isArray(j.players) ? j.players : []; window.eloEquipo.total = players.length; pintar(); })
    .catch(function () { aviso("No se pudo cargar la lista de jugadores. Vuelve a intentarlo en unos minutos."); })
    .finally(function () { clearTimeout(tope); });

  // Buscador por nick: devuelve cuántos jugadores coinciden
  window.eloEquipo = {
    filtrar: function (texto) {
      var q = norm(texto), n = 0;
      Array.prototype.forEach.call(body.querySelectorAll("tr[data-k]"), function (tr) {
        var ok = !q || q.split(" ").every(function (t) { return tr.getAttribute("data-k").indexOf(t) >= 0; });
        tr.hidden = !ok;
        if (ok) n++;
      });
      return n;
    },
    total: 0,
    alCargar: null
  };
})();
