// Partidas jugadas: todas las partidas terminadas de los torneos online y los retos del club (archivo permanente
// del servidor de torneos), con buscador por jugador, «Analizar» en el tablero de análisis y descarga del PGN.
(function () {
  "use strict";
  var API = (window.APEJUPO_TORNEOS_API || "").replace(/\/$/, "");
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var list = $("pj-list"), more = $("pj-more"), msg = $("pj-msg"), q = $("pj-q");
  var next = null, query = "", seq = 0, timer = null;

  function say(text, error) { msg.hidden = !text; msg.textContent = text || ""; msg.classList.toggle("error", !!error); }
  // «23 nov 2026, 10:48»
  function when(at) {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(at);
  }
  // Ritmo «5+3» como en el resto de la web: «5 + 3».
  function pace(tc) { var m = /^(\d+)\+(\d+)$/.exec(tc || ""); return m ? m[1] + " + " + m[2] : esc(tc); }
  function player(name, elo, won) {
    return '<span class="pj-p' + (won ? " won" : "") + '"><span class="pj-name" translate="no">' + esc(name) + "</span>" + (elo ? ' <small class="pj-elo">' + esc(elo) + "</small>" : "") + "</span>";
  }
  function row(g) {
    var result = { "1-0": "1 – 0", "0-1": "0 – 1", "1/2-1/2": "½ – ½" }[g.result] || "–";
    var file = (g.white + "-" + g.black).replace(/[^\wÀ-ÿ-]+/g, "_") + ".pgn";
    return '<li class="pj-row">'
      + '<div class="pj-meta"><span class="pj-kind ' + (g.kind === "reto" ? "reto" : "torneo") + '">' + (g.kind === "reto" ? "Reto" : "Torneo") + "</span>"
      + '<span class="pj-title" translate="no">' + esc(g.title) + "</span>"
      + '<span class="pj-when">' + when(g.at) + " · " + pace(g.tc) + "</span></div>"
      + '<div class="pj-game">' + player(g.white, g.whiteElo, g.result === "1-0") + '<span class="pj-res" title="' + esc(g.reason) + '">' + result + "</span>" + player(g.black, g.blackElo, g.result === "0-1") + "</div>"
      + '<div class="pj-actions"><a class="btn pj-btn" href="analisis.html?partida=' + encodeURIComponent(g.id) + '">Analizar</a>'
      + '<button class="btn-ghost pj-btn" type="button" data-pgn="' + esc(g.id) + '" data-file="' + esc(file) + '">PGN</button></div>'
      + "</li>";
  }
  function load(reset) {
    if (!API) { say("Las partidas no están disponibles en este momento.", true); return; }
    var mine = ++seq;
    if (reset) { next = null; list.innerHTML = ""; more.hidden = true; say(query ? "Buscando…" : "Cargando partidas…"); }
    more.disabled = true;
    var url = API + "/api/tournaments/partidas?q=" + encodeURIComponent(query) + (next ? "&antes=" + next : "");
    fetch(url, { cache: "no-store", signal: AbortSignal.timeout(window.APEJUPO_TORNEOS_TIMEOUT || 15000) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "No se pudieron cargar las partidas."); return j; }); })
      .then(function (data) {
        if (mine !== seq) return; // llegó otra búsqueda después
        list.insertAdjacentHTML("beforeend", data.games.map(row).join(""));
        next = data.next; more.hidden = !next; more.disabled = false;
        say(list.children.length ? "" : query ? "No hay partidas de «" + query + "»." : "Todavía no hay partidas jugadas.");
      })
      .catch(function () { if (mine !== seq) return; more.disabled = false; say("No se pudieron cargar las partidas. Vuelve a intentarlo en unos momentos.", true); });
  }
  // Buscar mientras se escribe, sin pedir una lista por cada tecla.
  q.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () { var v = q.value.trim(); if (v === query) return; query = v; load(true); }, 300);
  });
  more.addEventListener("click", function () { load(false); });
  // Descargar el PGN (el servidor está en otro dominio: se descarga como archivo desde aquí).
  list.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-pgn]"); if (!btn) return;
    btn.disabled = true;
    fetch(API + "/api/tournaments/partidas/" + encodeURIComponent(btn.dataset.pgn), { signal: AbortSignal.timeout(window.APEJUPO_TORNEOS_TIMEOUT || 15000) })
      .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
      .then(function (text) {
        var a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: "application/x-chess-pgn" }));
        a.href = url; a.download = btn.dataset.file; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      })
      .catch(function () { say("No se pudo descargar el PGN. Vuelve a intentarlo.", true); })
      .then(function () { btn.disabled = false; });
  });
  load(true);
})();
