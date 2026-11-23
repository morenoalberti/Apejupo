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
  var CROSS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  // Administrador: la misma clave que usa la web para administrar (se comprueba en el servidor antes de mostrar la cruz).
  function adminKey() { try { return sessionStorage.getItem("apejupoAdminCuentas") || localStorage.getItem("apejupoAdminCuentas") || ""; } catch (e) { return ""; } }
  var adminCheck = null;
  function isAdmin() {
    if (!adminCheck) {
      var key = adminKey();
      adminCheck = !key || !api() ? Promise.resolve(false) : fetch(api() + "/api/tournaments/admin/comprobar", { method: "POST", headers: { Authorization: "Bearer " + key } })
        .then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { return j.ok === true; }, function () { return false; });
    }
    return adminCheck;
  }
  var DOWNLOAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
  // «19 nov» (este año) o «19 nov 2025».
  function day(at) { var same = new Date(at).getFullYear() === new Date().getFullYear(); return new Intl.DateTimeFormat("es", same ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(at).replace(".", ""); }
  function pace(tc) { var m = /^(\d+)\+(\d+)$/.exec(tc || ""); return m ? m[1] + " + " + m[2] : tc || ""; }
  // Ganador en blanco y negrita; perdedor algo apagado; ELO en gris detrás del nombre.
  function player(name, elo, cls) { return '<span class="pj-name ' + cls + '" translate="no">' + esc(name) + "</span>" + (elo ? ' <small class="pj-elo">' + esc(elo) + "</small>" : ""); }

  // ---- Tablero pequeño con la posición final (al pasar el ratón) ----
  // Dibujado en un lienzo (canvas): el modo oscuro de algunos móviles (Samsung Internet) recolorea los colores
  // y las imágenes de la página, pero no lo que se pinta en un lienzo.
  var preview = null, PIECES = {}, SIZE = 480;
  function pieceImg(code) { var i = PIECES[code]; if (!i) { i = new Image(); i.src = "assets/pieces/" + code + ".png"; PIECES[code] = i; } return i; }
  function drawBoard(canvas, fen, last) {
    var rows = String(fen || "").split(" ")[0].split("/"), from = last ? last.slice(0, 2) : "", to = last ? last.slice(2, 4) : "";
    if (rows.length !== 8) return;
    var ctx = canvas.getContext("2d"), s = SIZE / 8, pieces = [];
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
      var sq = "abcdefgh"[x] + (8 - y);
      ctx.fillStyle = (x + y) % 2 ? "#b58863" : "#f0d9b5"; ctx.fillRect(x * s, y * s, s, s);
      if (sq === from || sq === to) { ctx.fillStyle = "rgba(205, 210, 106, .75)"; ctx.fillRect(x * s, y * s, s, s); }
    }
    rows.forEach(function (r, y) {
      var x = 0;
      r.split("").forEach(function (ch) {
        if (/\d/.test(ch)) { x += +ch; return; }
        pieces.push({ x: x, y: y, img: pieceImg((ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase()) }); x++;
      });
    });
    pieces.forEach(function (p) {
      var paint = function () { if (canvas.dataset.fen === fen) ctx.drawImage(p.img, p.x * s, p.y * s, s, s); };
      if (p.img.complete && p.img.naturalWidth) paint(); else p.img.addEventListener("load", paint, { once: true });
    });
  }
  var shownFor = null;
  // Solo con ratón: en el móvil, tocar una partida la abre directamente (sin tablerito intermedio).
  function showPreview(tr, ev) {
    if (!tr.dataset.fen || ev.pointerType !== "mouse") return;
    if (!preview) { preview = document.createElement("div"); preview.className = "pj-preview"; preview.setAttribute("aria-hidden", "true"); preview.innerHTML = '<canvas class="pj-mini" width="' + SIZE + '" height="' + SIZE + '"></canvas>'; document.body.appendChild(preview); }
    if (shownFor !== tr) { shownFor = tr; var c = preview.firstChild; c.dataset.fen = tr.dataset.fen; drawBoard(c, tr.dataset.fen, tr.dataset.last); }
    preview.hidden = false;
    // A la derecha y debajo del puntero, siguiéndolo; si no cabe, al otro lado del puntero.
    var size = preview.offsetWidth || 260, gap = 18, x = ev.clientX, y = ev.clientY;
    var left = x + gap + size <= innerWidth - 8 ? x + gap : x - gap - size;
    var top = y + gap + size <= innerHeight - 8 ? y + gap : y - gap - size;
    preview.style.left = Math.max(8, left) + "px"; preview.style.top = Math.max(8, top) + "px";
  }
  function hidePreview() { if (preview) preview.hidden = true; shownFor = null; }

  // ---- Lista con buscador ----
  function mount(root) {
    root.classList.add("pj-root");
    root.innerHTML = '<div class="pj-bar"><label class="pj-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="pj-q" type="search" placeholder="Buscar jugador" aria-label="Buscar partidas por jugador" autocomplete="off" maxlength="40"></label><span class="pj-count" aria-live="polite"></span></div>'
      + '<p class="muted pj-msg" role="status">Cargando partidas…</p>'
      + '<table class="pj-table" hidden><thead><tr><th><button type="button" class="pj-sort" data-k="n" title="Ordenar por número">#</button></th><th class="l"><button type="button" class="pj-sort" data-k="white" title="Ordenar por blancas">Blancas</button></th><th><button type="button" class="pj-sort" data-k="result" title="Ordenar por resultado">Res.</button></th><th class="l"><button type="button" class="pj-sort" data-k="black" title="Ordenar por negras">Negras</button></th><th class="r"><button type="button" class="pj-sort" data-k="date" title="Ordenar por fecha">Fecha</button></th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody></tbody></table>'
      + '<button class="btn-ghost pj-more" type="button" hidden>Ver más partidas</button>';
    var counter = root.querySelector(".pj-count"), q = root.querySelector(".pj-q"), msg = root.querySelector(".pj-msg"), table = root.querySelector(".pj-table"), body = table.tBodies[0], more = root.querySelector(".pj-more");
    var next = null, query = "", seq = 0, timer = null, count = 0, admin = false;
    // Partidas cargadas (n = su número, de la más reciente a la más antigua) y orden elegido en la cabecera.
    var list = [], sort = { k: "n", dir: 1 };
    var byName = function (a, b) { return a.localeCompare(b, "es", { sensitivity: "base" }); };
    var score = { "1-0": 0, "1/2-1/2": 1, "0-1": 2 };
    var compare = {
      n: function (a, b) { return a.n - b.n; },
      white: function (a, b) { return byName(a.white, b.white) || a.n - b.n; },
      black: function (a, b) { return byName(a.black, b.black) || a.n - b.n; },
      result: function (a, b) { return (score[a.result] - score[b.result]) || a.n - b.n; },
      date: function (a, b) { return b.at - a.at || a.n - b.n; }
    };
    function render() {
      var sorted = list.slice().sort(function (a, b) { return compare[sort.k](a, b) * sort.dir; });
      body.innerHTML = rows(sorted);
      table.querySelectorAll(".pj-sort").forEach(function (b) {
        if (b.dataset.k === sort.k) b.setAttribute("aria-sort", sort.dir > 0 ? (sort.k === "date" ? "descending" : "ascending") : (sort.k === "date" ? "ascending" : "descending")); else b.removeAttribute("aria-sort");
      });
    }
    function setCount() { counter.textContent = count ? count + (next ? "+" : "") + (count === 1 ? " partida" : " partidas") : ""; }
    function say(text, error) { msg.hidden = !text; msg.textContent = text || ""; msg.classList.toggle("error", !!error); }
    function rows(games) {
      return games.map(function (g) {
        var res = { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½" }[g.result] || "–";
        var wc = g.result === "1-0" ? "won" : g.result === "0-1" ? "lost" : "drew", bc = g.result === "0-1" ? "won" : g.result === "1-0" ? "lost" : "drew";
        var file = (g.white + "-" + g.black).replace(/[^\wÀ-ÿ-]+/g, "_") + ".pgn";
        var info = g.title + " · " + (g.kind === "reto" ? "Reto" : "Torneo") + " · " + pace(g.tc);
        return '<tr data-g="' + esc(g.id) + '" data-fen="' + esc(g.fen || "") + '" data-last="' + esc(g.lastMove || "") + '" title="' + esc(info) + '"><td class="pj-n">' + g.n + '</td><td class="l">' + player(g.white, g.whiteElo, wc)
          + '</td><td class="rs"><span class="pj-res ' + (g.result === "1/2-1/2" ? "d" : "") + '" title="' + esc(g.reason) + '">' + res + '</span></td><td class="l">' + player(g.black, g.blackElo, bc)
          + '</td><td class="pj-date" title="' + esc(new Date(g.at).toLocaleString("es")) + '">' + day(g.at) + '</td><td class="pj-dl"><button type="button" data-pgn="' + esc(g.id) + '" data-file="' + esc(file) + '" aria-label="Descargar el PGN" title="Descargar el PGN">' + DOWNLOAD + "</button>"
          + (admin ? '<button type="button" class="pj-del" data-del="' + esc(g.id) + '" aria-label="Borrar la partida" title="Borrar la partida">' + CROSS + "</button>" : "") + "</td></tr>";
      }).join("");
    }
    function load(reset) {
      if (!api()) { say("Las partidas no están disponibles en este momento.", true); return; }
      var mine = ++seq;
      if (reset) { next = null; count = 0; list = []; body.innerHTML = ""; table.hidden = true; more.hidden = true; say(query ? "Buscando…" : "Cargando partidas…"); }
      more.disabled = true;
      fetch(api() + "/api/tournaments/partidas?q=" + encodeURIComponent(query) + (next ? "&antes=" + next : ""), { cache: "no-store", signal: AbortSignal.timeout(window.APEJUPO_TORNEOS_TIMEOUT || 15000) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); })
        .then(function (data) {
          if (mine !== seq) return; // llegó otra búsqueda después
          data.games.forEach(function (g) { g.n = list.length + 1; list.push(g); });
          count = list.length; next = data.next; setCount(); render();
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
    // Ordenar por una columna: primera pulsación, orden natural (A-Z, 1-0 primero, más recientes); segunda, al revés.
    table.tHead.addEventListener("click", function (ev) {
      var b = ev.target.closest(".pj-sort"); if (!b) return;
      sort = b.dataset.k === sort.k ? { k: sort.k, dir: -sort.dir } : { k: b.dataset.k, dir: 1 };
      hidePreview(); render();
    });
    body.addEventListener("pointermove", function (ev) { var tr = ev.target.closest("tr[data-g]"); if (tr) showPreview(tr, ev); });
    body.addEventListener("mouseleave", hidePreview);
    body.addEventListener("click", function (ev) {
      // Borrar una partida (solo el administrador).
      var del = ev.target.closest("[data-del]");
      if (del) {
        var tr = del.closest("tr");
        if (!window.confirm("¿Borrar esta partida de «Partidas jugadas»?\n" + tr.querySelectorAll("td.l")[0].innerText + " – " + tr.querySelectorAll("td.l")[1].innerText + "\n\nNo se puede deshacer.")) return;
        del.disabled = true;
        fetch(api() + "/api/tournaments/partidas/" + encodeURIComponent(del.dataset.del) + "/borrar", { method: "POST", headers: { Authorization: "Bearer " + adminKey() } })
          .then(function (r) {
            if (!r.ok) throw new Error();
            list = list.filter(function (g) { return g.id !== del.dataset.del; });
            list.forEach(function (g, i) { g.n = i + 1; }); // se vuelven a numerar
            count = list.length; setCount(); render(); hidePreview();
            if (!count) { table.hidden = true; say("Todavía no hay partidas jugadas."); }
          })
          .catch(function () { del.disabled = false; say("No se pudo borrar la partida. Vuelve a intentarlo.", true); });
        return;
      }
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
    isAdmin().then(function (a) { admin = a; root.classList.toggle("pj-admin", a); load(true); });
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
