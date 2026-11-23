// Partidas jugadas: todas las partidas terminadas de los torneos online y los retos del club (archivo permanente
// del servidor de torneos), con buscador por jugador. Mismo formato que los emparejamientos de Torneos Live:
// número, blancas con su ELO, resultado, negras con su ELO y fecha.
// - Al pasar el ratón por una partida se ve un tablero pequeño con su posición final.
// - Pulsarla la abre en el tablero de análisis; el icono de la derecha descarga su PGN.
// Se usa en la tarjeta que despliega el menú («Partidas jugadas») y en la página partidas.html.
(function () {
  "use strict";
  if (window.PartidasJugadas) return;
  var api = function () { return (window.APEJUPO_TORNEOS_API || "").replace(/\/$/, ""); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var DOWNLOAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
  function day(at) { return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(at); }
  function pace(tc) { var m = /^(\d+)\+(\d+)$/.exec(tc || ""); return m ? m[1] + " + " + m[2] : tc || ""; }
  function player(name, elo) { return '<span translate="no">' + esc(name) + "</span>" + (elo ? " <small>" + esc(elo) + "</small>" : ""); }

  // ---- Tablero pequeño con la posición final (al pasar el ratón) ----
  var preview = null;
  function board(fen, last) {
    var rows = String(fen || "").split(" ")[0].split("/"), cells = [], from = last ? last.slice(0, 2) : "", to = last ? last.slice(2, 4) : "";
    if (rows.length !== 8) return "";
    rows.forEach(function (r, y) {
      var x = 0;
      r.split("").forEach(function (ch) {
        if (/\d/.test(ch)) { for (var k = 0; k < +ch; k++) { cells.push(cell(x, y, "")); x++; } return; }
        cells.push(cell(x, y, (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase())); x++;
      });
    });
    function cell(x, y, piece) {
      var sq = "abcdefgh"[x] + (8 - y), cls = ((x + y) % 2 ? "dk" : "") + (sq === from || sq === to ? " lm" : "");
      return '<i class="' + cls + '">' + (piece ? '<img src="assets/pieces/' + piece + '.png" alt="">' : "") + "</i>";
    }
    return cells.join("");
  }
  function showPreview(tr) {
    if (!tr.dataset.fen || !window.matchMedia("(hover: hover)").matches) return;
    if (!preview) { preview = document.createElement("div"); preview.className = "pj-preview"; preview.setAttribute("aria-hidden", "true"); document.body.appendChild(preview); }
    preview.innerHTML = '<div class="pj-mini">' + board(tr.dataset.fen, tr.dataset.last) + "</div>";
    var r = tr.getBoundingClientRect(), box = tr.closest(".pj-root").getBoundingClientRect(), size = 184, gap = 12;
    // A la izquierda de la lista si cabe; si no, a la derecha; y a la altura de la partida.
    var left = box.left - size - gap >= 8 ? box.left - size - gap : Math.min(innerWidth - size - 8, box.right + gap);
    var top = Math.max(8, Math.min(innerHeight - size - 8, r.top + r.height / 2 - size / 2));
    preview.style.left = left + "px"; preview.style.top = top + "px"; preview.hidden = false;
  }
  function hidePreview() { if (preview) preview.hidden = true; }

  // ---- Lista con buscador ----
  function mount(root) {
    root.classList.add("pj-root");
    root.innerHTML = '<input class="pj-q" type="search" placeholder="Buscar jugador" aria-label="Buscar partidas por jugador" autocomplete="off" maxlength="40">'
      + '<p class="muted pj-msg" role="status">Cargando partidas…</p>'
      + '<table class="lv-ptab pairs pj-table" hidden><thead><tr><th>N.º</th><th class="l">Blancas</th><th></th><th class="l">Negras</th><th>Fecha</th><th><span class="sr-only">PGN</span></th></tr></thead><tbody></tbody></table>'
      + '<button class="btn-ghost pj-more" type="button" hidden>Ver más partidas</button>';
    var q = root.querySelector(".pj-q"), msg = root.querySelector(".pj-msg"), table = root.querySelector(".pj-table"), body = table.tBodies[0], more = root.querySelector(".pj-more");
    var next = null, query = "", seq = 0, timer = null, n = 0, count = 0;
    function say(text, error) { msg.hidden = !text; msg.textContent = text || ""; msg.classList.toggle("error", !!error); }
    function rows(games) {
      return games.map(function (g) {
        n++;
        var res = { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½" }[g.result] || "–";
        var file = (g.white + "-" + g.black).replace(/[^\wÀ-ÿ-]+/g, "_") + ".pgn";
        var info = g.title + " · " + (g.kind === "reto" ? "Reto" : "Torneo") + " · " + pace(g.tc);
        return '<tr data-g="' + esc(g.id) + '" data-fen="' + esc(g.fen || "") + '" data-last="' + esc(g.lastMove || "") + '" title="' + esc(info) + '"><td>' + n + '</td><td class="l">' + player(g.white, g.whiteElo)
          + '</td><td class="rs" title="' + esc(g.reason) + '">' + res + '</td><td class="l">' + player(g.black, g.blackElo)
          + '</td><td class="pj-date">' + day(g.at) + '</td><td class="pj-dl"><button type="button" data-pgn="' + esc(g.id) + '" data-file="' + esc(file) + '" aria-label="Descargar el PGN" title="Descargar el PGN">' + DOWNLOAD + "</button></td></tr>";
      }).join("");
    }
    function load(reset) {
      if (!api()) { say("Las partidas no están disponibles en este momento.", true); return; }
      var mine = ++seq;
      if (reset) { next = null; n = 0; count = 0; body.innerHTML = ""; table.hidden = true; more.hidden = true; say(query ? "Buscando…" : "Cargando partidas…"); }
      more.disabled = true;
      fetch(api() + "/api/tournaments/partidas?q=" + encodeURIComponent(query) + (next ? "&antes=" + next : ""), { cache: "no-store", signal: AbortSignal.timeout(window.APEJUPO_TORNEOS_TIMEOUT || 15000) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); })
        .then(function (data) {
          if (mine !== seq) return; // llegó otra búsqueda después
          body.insertAdjacentHTML("beforeend", rows(data.games));
          count += data.games.length; next = data.next;
          more.hidden = !next; more.disabled = false; table.hidden = !count;
          say(count ? "" : query ? "No hay partidas de «" + query + "»." : "Todavía no hay partidas jugadas.");
        })
        .catch(function () { if (mine !== seq) return; more.disabled = false; say("No se pudieron cargar las partidas. Vuelve a intentarlo en unos momentos.", true); });
    }
    // Buscar mientras se escribe, sin pedir una lista por cada tecla.
    q.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { var v = q.value.trim(); if (v === query) return; query = v; load(true); }, 300);
    });
    more.addEventListener("click", function () { load(false); });
    body.addEventListener("mouseover", function (ev) { var tr = ev.target.closest("tr[data-g]"); if (tr) showPreview(tr); });
    body.addEventListener("mouseleave", hidePreview);
    body.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-pgn]");
      if (!btn) { var tr = ev.target.closest("tr[data-g]"); if (tr) location.href = "analisis.html?partida=" + encodeURIComponent(tr.dataset.g); return; }
      // Descargar el PGN (el servidor está en otro dominio: se descarga como archivo desde aquí).
      btn.disabled = true;
      fetch(api() + "/api/tournaments/partidas/" + encodeURIComponent(btn.dataset.pgn), { signal: AbortSignal.timeout(window.APEJUPO_TORNEOS_TIMEOUT || 15000) })
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
    return { focus: function () { q.focus(); } };
  }

  // ---- Tarjeta que despliega el menú «Partidas jugadas» (en cualquier página) ----
  var panel = null;
  function openPanel() {
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "pj-panel"; panel.setAttribute("aria-label", "Partidas jugadas"); panel.hidden = true;
      panel.innerHTML = '<div class="pj-panel-head"><h2>Partidas jugadas</h2><button type="button" class="pj-close" aria-label="Cerrar">×</button></div><div class="pj-panel-body"></div>';
      document.body.appendChild(panel);
      panel.list = mount(panel.querySelector(".pj-panel-body"));
      panel.querySelector(".pj-close").addEventListener("click", closePanel);
      panel.addEventListener("scroll", hidePreview, { passive: true });
      document.addEventListener("click", function (ev) { if (!panel.hidden && !panel.contains(ev.target) && !ev.target.closest('a[href$="partidas.html"]')) closePanel(); });
      document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !panel.hidden) closePanel(); });
    }
    var head = document.querySelector(".site-header");
    panel.style.top = Math.max(8, (head ? head.getBoundingClientRect().bottom : 0) + 8) + "px";
    panel.hidden = false;
  }
  function closePanel() { if (panel) { panel.hidden = true; hidePreview(); } }
  function togglePanel() { if (panel && !panel.hidden) closePanel(); else openPanel(); }

  window.PartidasJugadas = { mount: mount, toggle: togglePanel, close: closePanel };
})();
