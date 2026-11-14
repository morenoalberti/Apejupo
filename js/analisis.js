// Tablero de análisis: mover piezas (clic o arrastrar), recorrer la partida, cargar FEN o PGN
// y consultar a Stockfish (barra de evaluación y las 3 mejores líneas). Usa chess.js 0.10.3.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var FILES = "abcdefgh", START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  var rootFen = START, line = [], ply = 0, flipped = false, selected = null, drag = null, pendingPromo = null;

  // Jugadas con figuras, como en Lichess en español: Nf3 → ♘f3.
  var FIG = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" };
  function fig(san) { return san.replace(/[KQRBN]/g, function (c) { return FIG[c]; }); }
  function fenAt(k) { return k === 0 ? rootFen : line[k - 1].fen; }
  function game() { return new Chess(fenAt(ply)); }
  // En el editor los avisos salen en su panel, junto a «Analizar esta posición»; fuera, bajo el PGN.
  function msg(text, bad) {
    var m = (typeof editing !== "undefined" && editing && $("an-ed-msg")) || $("an-msg");
    m.textContent = text || ""; m.classList.toggle("bad", !!bad);
  }

  // ---------- Tablero ----------
  function squares() {
    var out = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var file = flipped ? 7 - c : c, rank = flipped ? r + 1 : 8 - r;
      out.push(FILES[file] + rank);
    }
    return out;
  }
  function render() {
    if (editing) return renderEditor();
    var g = game(), last = ply ? line[ply - 1] : null, targets = selected ? g.moves({ square: selected, verbose: true }).map(function (m) { return m.to; }) : [];
    var kingSq = null;
    if (g.in_check()) squares().forEach(function (sq) { var p = g.get(sq); if (p && p.type === "k" && p.color === g.turn()) kingSq = sq; });
    $("an-board").innerHTML = squares().map(function (sq, i) {
      var p = g.get(sq), dark = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;
      var cls = "an-sq" + (dark ? " dk" : "") + (last && (sq === last.from || sq === last.to) ? " an-lm" : "") + (sq === selected ? " an-sel" : "") + (sq === kingSq ? " an-chk" : "") + (targets.indexOf(sq) >= 0 ? (p ? " an-cap" : " an-dot") : "");
      var coords = (i % 8 === 0 ? '<span class="an-rk">' + sq[1] + "</span>" : "") + (i >= 56 ? '<span class="an-fl">' + sq[0] + "</span>" : "");
      var img = p ? '<img src="assets/pieces/' + p.color + p.type.toUpperCase() + '.png" alt="" draggable="false">' : "";
      return '<div class="' + cls + '" data-sq="' + sq + '">' + img + coords + "</div>";
    }).join("");
    $("an-board").setAttribute("aria-label", "Tablero. Juegan " + (g.turn() === "w" ? "blancas" : "negras") + (g.in_checkmate() ? ". Jaque mate" : g.in_check() ? ". Jaque" : ""));
    renderMoves(); renderFen(); renderNav(); analyse();
  }
  function renderNav() {
    $("an-first").disabled = $("an-prev").disabled = ply === 0;
    $("an-next").disabled = $("an-last").disabled = ply === line.length;
  }
  function renderFen() { if (document.activeElement !== $("an-fen")) $("an-fen").value = fenAt(ply); }
  function renderMoves() {
    var parts = fenAt(0).split(" "), num = Number(parts[5]) || 1, white = parts[1] === "w", html = "";
    if (!line.length) { $("an-moves").innerHTML = '<p class="an-empty">Mueve una pieza para empezar.</p>'; return; }
    line.forEach(function (m, i) {
      if (white) html += '<span class="an-num">' + num + ".</span>";
      else if (i === 0) html += '<span class="an-num">' + num + "…</span>";
      var j = judge(i);
      html += '<button type="button" class="an-mv' + (i + 1 === ply ? " cur" : "") + '" data-ply="' + (i + 1) + '">' + fig(m.san)
        + (j && j.mark ? '<b class="an-mark ' + j.kind + '">' + j.mark + "</b>" : "") + "</button>"
        + (j && j.sym ? '<span class="an-sym" title="' + j.symTitle + '">' + j.sym + "</span>" : "");
      if (!white) num++;
      white = !white;
    });
    var g = game(), end = g.in_checkmate() ? (g.turn() === "w" ? "0-1" : "1-0") : g.in_draw() || g.in_stalemate() ? "½-½" : "";
    var jc = ply ? judge(ply - 1) : null;
    $("an-moves").innerHTML = html + (end && ply === line.length ? '<span class="an-res">' + end + "</span>" : "")
      + (jc && jc.text ? '<p class="an-comment ' + jc.kind + '">' + jc.text + "</p>" : "");
    var cur = $("an-moves").querySelector(".cur");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  // ---------- Valoración de las jugadas ----------
  // Como Lichess: se compara la probabilidad de ganar de quien mueve antes y después de la jugada
  // (escala -1…1): baja ≥0,3 → ?? (error grave), ≥0,2 → ? (error), ≥0,1 → ?! (imprecisión).
  // Tras una jugada marcada se pone cómo queda la posición (=, ⩲, ±, +-…); si hay mate forzado, #N.
  function winChance(e) {
    if (e.mate) return e.v > 0 ? 1 : e.v < 0 ? -1 : 0;
    return 2 / (1 + Math.exp(-0.00368208 * e.v)) - 1;
  }
  function evalSym(e) {
    if (e.over) return "";
    if (e.mate) return { sym: (e.v > 0 ? "#" : "#-") + Math.abs(e.v), title: "Mate en " + Math.abs(e.v) + " para las " + (e.v > 0 ? "blancas" : "negras") };
    var a = Math.abs(e.v), w = e.v > 0;
    var t = a < 30 ? ["=", "Igualdad"] : a < 70 ? [w ? "⩲" : "⩱", "Ligera ventaja de las " + (w ? "blancas" : "negras")]
      : a < 200 ? [w ? "±" : "∓", "Ventaja de las " + (w ? "blancas" : "negras")] : [w ? "+-" : "-+", "Ventaja decisiva de las " + (w ? "blancas" : "negras")];
    return { sym: t[0], title: t[1] };
  }
  function uciSan(fen, uci) {
    if (!uci) return "";
    var m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? fig(m.san) : "";
  }
  // i: índice de la jugada en «line». Devuelve marca, símbolo y comentario, o null si falta evaluación.
  function judge(i) {
    var beforeFen = fenAt(i), afterFen = line[i].fen, before = evals[beforeFen], after = evals[afterFen];
    if (!before || !after || before.depth < 10 || (!after.over && after.depth < 10)) return null;
    var whiteMoved = beforeFen.split(" ")[1] === "w", sign = whiteMoved ? 1 : -1, who = whiteMoved ? "blancas" : "negras";
    var drop = (winChance(before) - winChance(after)) * sign;
    var r = { mark: "", kind: "", text: "", sym: "", symTitle: "" };
    if (drop >= 0.3) { r.mark = "??"; r.kind = "blunder"; r.text = "Error grave."; }
    else if (drop >= 0.2) { r.mark = "?"; r.kind = "mistake"; r.text = "Error."; }
    else if (drop >= 0.1) { r.mark = "?!"; r.kind = "dubious"; r.text = "Imprecisión."; }
    var best = before.best && before.best !== line[i].from + line[i].to ? uciSan(beforeFen, before.best) : "";
    if (r.mark && best) r.text += " Mejor era " + best + ".";
    // Mate perdido: había mate y tras la jugada ya no.
    if (before.mate && before.v * sign > 0 && !(after.mate && after.v * sign > 0) && !after.over) { r.mark = r.mark || "?"; r.kind = r.kind || "mistake"; if (r.text.indexOf("Mejor") < 0) r.text = "Se pierde el mate." + (best ? " Mejor era " + best + "." : ""); else r.text = "Se pierde el mate. " + r.text; }
    var s = evalSym(after);
    if (s && (r.mark || after.mate)) { r.sym = s.sym; r.symTitle = s.title; }
    if (after.mate && !after.over) r.text = (r.text ? r.text + " " : "") + "Mate en " + Math.abs(after.v) + " para las " + (after.v > 0 ? "blancas" : "negras") + ".";
    if (!r.mark && !r.sym) return null;
    if (!r.kind) r.kind = after.v * sign > 0 ? "good" : "info";
    return r;
  }

  // ---------- Jugadas ----------
  function play(from, to, promotion) {
    var g = game(), legal = g.moves({ square: from, verbose: true }).filter(function (m) { return m.to === to; });
    if (!legal.length) return false;
    if (legal[0].flags.indexOf("p") >= 0 && !promotion) { askPromotion(from, to, g.turn()); return true; }
    var m = g.move({ from: from, to: to, promotion: promotion || "q" });
    if (!m) return false;
    // Si se juega algo distinto a lo que seguía, la línea se sustituye desde aquí.
    if (!(line[ply] && line[ply].san === m.san)) line = line.slice(0, ply).concat([{ san: m.san, fen: g.fen(), from: m.from, to: m.to }]);
    ply++; selected = null; msg(""); render();
    return true;
  }
  function askPromotion(from, to, color) {
    pendingPromo = { from: from, to: to };
    $("an-promo-opts").innerHTML = ["q", "r", "b", "n"].map(function (p) { return '<button type="button" data-p="' + p + '" aria-label="' + { q: "Dama", r: "Torre", b: "Alfil", n: "Caballo" }[p] + '"><img src="assets/pieces/' + color + p.toUpperCase() + '.png" alt=""></button>'; }).join("");
    $("an-promo").showModal();
  }
  $("an-promo-opts").addEventListener("click", function (e) {
    var b = e.target.closest("[data-p]"); if (!b || !pendingPromo) return;
    var p = pendingPromo; pendingPromo = null; $("an-promo").close(); play(p.from, p.to, b.dataset.p);
  });
  $("an-promo").addEventListener("close", function () { pendingPromo = null; selected = null; render(); });

  function own(sq) { var g = game(), p = g.get(sq); return p && p.color === g.turn(); }
  // La casilla se calcula por la posición dentro del tablero (no por el elemento pulsado, que puede ser el tablero entero).
  function sqFromPoint(x, y) {
    var r = $("an-board").getBoundingClientRect(), c = Math.floor((x - r.left) / r.width * 8), w = Math.floor((y - r.top) / r.height * 8);
    if (c < 0 || c > 7 || w < 0 || w > 7) return null;
    return squares()[w * 8 + c];
  }
  $("an-board").addEventListener("pointerdown", function (e) {
    if (e.button > 0) return;
    var at = sqFromPoint(e.clientX, e.clientY), cell = at && $("an-board").querySelector('[data-sq="' + at + '"]'); if (!cell) return;
    if (editing) { editPointerDown(e, cell); return; }
    var sq = cell.dataset.sq;
    if (selected && sq !== selected && !own(sq)) { play(selected, sq) || (selected = null, render()); return; }
    if (!own(sq)) { selected = null; render(); return; }
    var img = cell.querySelector("img"); if (!img) return;
    e.preventDefault();
    var wasSelected = selected === sq;
    // El tamaño se mide antes de redibujar: después, esta casilla ya no está en la página y mediría 0.
    var size = cell.getBoundingClientRect().width;
    selected = sq; render();
    var ghost = img.cloneNode();
    ghost.className = "an-ghost"; ghost.style.width = ghost.style.height = size + "px";
    document.body.appendChild(ghost);
    drag = { from: sq, ghost: ghost, size: size, moved: false, wasSelected: wasSelected, x: e.clientX, y: e.clientY };
    moveGhost(e.clientX, e.clientY);
    var src = $("an-board").querySelector('[data-sq="' + sq + '"] img'); if (src) src.style.opacity = ".25";
  });
  function moveGhost(x, y) { drag.ghost.style.left = x - drag.size / 2 + "px"; drag.ghost.style.top = y - drag.size / 2 + "px"; }
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
    moveGhost(e.clientX, e.clientY);
  });
  window.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var d = drag; drag = null; d.ghost.remove();
    if (d.edit) { editDrop(d, e); return; }
    var to = sqFromPoint(e.clientX, e.clientY);
    if (d.moved && to && to !== d.from) { if (!play(d.from, to)) { selected = null; render(); } return; }
    if (d.wasSelected && !d.moved) selected = null; // segundo clic sobre la misma pieza: deseleccionar
    render();
  });

  // ---------- Navegación ----------
  function go(k) { ply = Math.max(0, Math.min(line.length, k)); selected = null; render(); }
  $("an-first").addEventListener("click", function () { go(0); });
  $("an-prev").addEventListener("click", function () { go(ply - 1); });
  $("an-next").addEventListener("click", function () { go(ply + 1); });
  $("an-last").addEventListener("click", function () { go(line.length); });
  function flip() { flipped = !flipped; render(); drawArrow(); }
  $("an-moves").addEventListener("click", function (e) { var b = e.target.closest("[data-ply]"); if (b) go(Number(b.dataset.ply)); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
    if (editing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector("dialog[open]")) return;
    if (e.key === "ArrowLeft") { go(ply - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { go(ply + 1); e.preventDefault(); }
    else if (e.key === "Home" || e.key === "ArrowUp") { go(0); e.preventDefault(); }
    else if (e.key === "End" || e.key === "ArrowDown") { go(line.length); e.preventDefault(); }
    else if (e.key === "f") flip();
  });

  // ---------- FEN y PGN ----------
  function loadFen(fen) {
    fen = fen.trim();
    var ok = new Chess().validate_fen(fen);
    if (!ok.valid) { msg("FEN no válido: " + ok.error, true); return false; }
    rootFen = fen; line = []; ply = 0; selected = null; flipped = fen.split(" ")[1] === "b"; msg("Posición cargada."); render(); return true;
  }
  $("an-fen").addEventListener("change", function () { if (this.value.trim() !== fenAt(ply)) loadFen(this.value); });
  $("an-fen").addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });
  $("an-load").addEventListener("click", function () {
    var text = $("an-pgn").value.trim(); if (!text) { msg("Pega una partida en PGN para cargarla.", true); return; }
    // chess.js pide una línea en blanco entre las cabeceras [Event …] y las jugadas: se añade si falta.
    text = text.replace(/\r\n?/g, "\n").replace(/^(\s*\[[^\n]*\]\s*\n)+(?!\s*\n)/, function (m) { return m.replace(/\s*$/, "") + "\n\n"; });
    var g = new Chess();
    if (!g.load_pgn(text, { sloppy: true })) { msg("No se pudo leer el PGN. Revisa que las jugadas sean correctas.", true); return; }
    var hist = g.history({ verbose: true }), headers = g.header(), start = headers.FEN || START, replay = new Chess(start);
    rootFen = start; line = hist.map(function (m) { replay.move(m); return { san: m.san, fen: replay.fen(), from: m.from, to: m.to }; });
    ply = line.length; selected = null; flipped = false;
    msg("Partida cargada: " + (headers.White ? headers.White + " – " + (headers.Black || "?") + " · " : "") + Math.ceil(line.length / 2) + " jugadas.");
    render();
  });
  // Copiar al portapapeles; si el navegador no deja, se prueba con un cuadro de texto temporal.
  function copyText(text, done) {
    function fallback() {
      var t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
      t.remove(); msg(ok ? done : "No se pudo copiar automáticamente.", !ok);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { msg(done); }, fallback);
    else fallback();
  }
  function pgnText() {
    var parts = rootFen.split(" "), num = Number(parts[5]) || 1, white = parts[1] === "w", out = [];
    line.forEach(function (m, i) { if (white) out.push(num + ". " + m.san); else out.push((i === 0 ? num + "... " : "") + m.san); if (!white) num++; white = !white; });
    var head = rootFen !== START ? '[SetUp "1"]\n[FEN "' + rootFen + '"]\n\n' : "";
    return head + out.join(" ");
  }
  $("an-copy").addEventListener("click", function () {
    var text = pgnText();
    $("an-pgn").value = text;
    copyText(text, "PGN copiado al portapapeles.");
  });
  $("an-reset").addEventListener("click", function () { rootFen = START; line = []; ply = 0; selected = null; flipped = false; $("an-pgn").value = ""; msg(""); render(); });

  // ---------- Stockfish ----------
  var evals = {}, movesTimer = null, sfBusy = false, sfStale = 0;
  var sf = null, sfReady = false, sfFen = null, sfLines = {}, sfTimer = null, sfOn = true;
  try { sfOn = localStorage.getItem("apejupoAnalisisMotor") !== "0"; } catch (_) {}
  $("an-sf").checked = sfOn;
  $("an-sf").addEventListener("change", function () {
    sfOn = this.checked; try { localStorage.setItem("apejupoAnalisisMotor", sfOn ? "1" : "0"); } catch (_) {}
    document.body.classList.toggle("an-off", !sfOn);
    if (!sfOn && sf) sf.postMessage("stop");
    analyse();
  });
  document.body.classList.toggle("an-off", !sfOn);
  function initSf() {
    if (sf !== null) return;
    try {
      sf = new Worker("assets/stockfish/stockfish-19-lite-single.js");
      sf.onerror = function () { sf = false; $("an-lines").innerHTML = '<p class="an-empty">No se pudo cargar Stockfish.</p>'; };
      sf.onmessage = function (e) {
        var l = String(e.data);
        if (l === "uciok") { sf.postMessage("setoption name MultiPV value 3"); sf.postMessage("isready"); return; }
        if (l === "readyok") { sfReady = true; analyse(); return; }
        if (l.indexOf("bestmove") === 0) { if (sfStale > 0) sfStale--; else sfBusy = false; return; }
        if (sfStale > 0 || l.indexOf("info") !== 0 || / bound /.test(l) || !sfFen) return;
        var m = /score (cp|mate) (-?\d+)/.exec(l), pv = / pv (.+)$/.exec(l), mp = /multipv (\d+)/.exec(l), dp = / depth (\d+)/.exec(l);
        if (!m) return;
        var black = sfFen.split(" ")[1] === "b", v = Number(m[2]) * (black ? -1 : 1);
        sfLines[mp ? mp[1] : 1] = { mate: m[1] === "mate", v: v, pv: pv ? pv[1].trim().split(/\s+/) : [], depth: dp ? dp[1] : "" };
        if (!mp || mp[1] === "1") {
          var depth = dp ? Number(dp[1]) : 0, old = evals[sfFen];
          if (!old || depth >= old.depth) {
            evals[sfFen] = { mate: m[1] === "mate", v: v, depth: depth, best: pv ? pv[1].trim().split(/\s+/)[0] : null };
            if (!movesTimer) movesTimer = setTimeout(function () { movesTimer = null; renderMoves(); }, 400);
          }
        }
        if (!sfTimer) sfTimer = setTimeout(function () { sfTimer = null; showEngine(); }, 120);
      };
      sf.postMessage("uci");
    } catch (_) { sf = false; }
  }
  function analyse() {
    var fen = fenAt(ply), g = new Chess(fen);
    if (!sfOn || editing) return;
    if (g.game_over()) {
      sfFen = null; if (sf) sf.postMessage("stop");
      var mate = g.in_checkmate(), winW = g.turn() === "b";
      evals[fen] = mate ? { mate: true, v: winW ? 1 : -1, depth: 99, over: true } : { mate: false, v: 0, depth: 99, over: true };
      setBar(mate ? { mate: true, v: winW ? 1 : -1 } : { mate: false, v: 0 });
      $("an-evaltext").textContent = mate ? (winW ? "1-0" : "0-1") : "½"; $("an-evalbig").textContent = $("an-evaltext").textContent; arrowMove = null; drawArrow();
      $("an-lines").innerHTML = '<p class="an-empty">' + (mate ? "Jaque mate." : "Tablas.") + "</p>"; $("an-depth").textContent = "";
      return;
    }
    initSf();
    if (!sf || !sfReady || fen === sfFen) return;
    sfFen = fen; sfLines = {}; arrowMove = null; drawArrow(); $("an-evalbig").textContent = "…";
    $("an-lines").innerHTML = '<p class="an-empty">Calculando…</p>';
    if (sfBusy) sfStale++; // lo que quede de la búsqueda anterior se descarta hasta su «bestmove»
    sfBusy = true;
    sf.postMessage("stop"); sf.postMessage("position fen " + fen); sf.postMessage("go depth 24");
  }
  function scoreText(r) { return r.mate ? (r.v > 0 ? "#" : "#-") + Math.abs(r.v) : (r.v > 0 ? "+" : "") + (r.v / 100).toFixed(2); }
  function setBar(r) {
    var pct = r.mate ? (r.v > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.004 * r.v)) - 1);
    $("an-evalw").style.height = Math.max(2, Math.min(98, pct)) + "%";
    $("an-evalbar").classList.toggle("wh", pct >= 50);
  }
  function pvSan(fen, pv) {
    var g = new Chess(fen), parts = fen.split(" "), num = Number(parts[5]) || 1, white = parts[1] === "w", out = [];
    for (var i = 0; i < pv.length && i < 12; i++) {
      var m = g.move({ from: pv[i].slice(0, 2), to: pv[i].slice(2, 4), promotion: pv[i][4] });
      if (!m) break;
      out.push((white ? num + ". " : i === 0 ? num + "… " : "") + fig(m.san));
      if (!white) num++; white = !white;
    }
    return out.join(" ");
  }
  function showEngine() {
    var best = sfLines[1]; if (!best || !sfFen) return;
    setBar(best); $("an-evaltext").textContent = scoreText(best).replace(/^\+/, ""); $("an-evalbig").textContent = scoreText(best);
    arrowMove = best.pv[0] || null; drawArrow();
    $("an-depth").textContent = "Profundidad " + best.depth;
    $("an-lines").innerHTML = [1, 2, 3].filter(function (k) { return sfLines[k]; }).map(function (k) {
      var r = sfLines[k];
      return '<button type="button" class="an-line" data-uci="' + (r.pv[0] || "") + '" title="Jugar ' + (r.pv[0] || "") + '"><b class="' + (r.mate ? (r.v > 0 ? "w" : "b") : r.v >= 0 ? "w" : "b") + '">' + scoreText(r) + "</b><span>" + pvSan(sfFen, r.pv) + "</span></button>";
    }).join("");
  }
  // Pulsar una línea juega su primera jugada.
  $("an-lines").addEventListener("click", function (e) {
    var b = e.target.closest("[data-uci]"); if (!b || !b.dataset.uci) return;
    var u = b.dataset.uci; play(u.slice(0, 2), u.slice(2, 4), u[4] || "q");
  });

  // ---------- Flecha de la mejor jugada ----------
  var arrowMove = null;
  function center(sq) {
    var f = FILES.indexOf(sq[0]), r = Number(sq[1]);
    return flipped ? [7 - f + 0.5, r - 0.5] : [f + 0.5, 8 - r + 0.5];
  }
  function drawArrow() {
    var svg = $("an-arrow");
    if (!arrowMove || !sfOn || editing) { svg.innerHTML = ""; return; }
    var a = center(arrowMove.slice(0, 2)), b = center(arrowMove.slice(2, 4)), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    var end = [b[0] - dx / len * 0.3, b[1] - dy / len * 0.3];
    svg.innerHTML = '<defs><marker id="an-head" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 V4 L3,2 z" fill="#15781B"/></marker></defs>'
      + '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + end[0] + '" y2="' + end[1] + '" stroke="#15781B" stroke-width="0.16" stroke-linecap="round" opacity=".8" marker-end="url(#an-head)"/>';
  }

  // ---------- Menú (≡) ----------
  function closeMenu() { $("an-menu").hidden = true; $("an-menu-btn").setAttribute("aria-expanded", "false"); }
  $("an-menu-btn").addEventListener("click", function (e) {
    e.stopPropagation(); var open = $("an-menu").hidden;
    $("an-menu").hidden = !open; this.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", function (e) { if (!e.target.closest("#an-menu")) closeMenu(); });
  $("an-menu").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    closeMenu();
    var act = b.dataset.act;
    if (act === "flip") flip();
    else if (act === "edit") startEditor();
    else if (act === "start") $("an-reset").click();
    else if (act === "link") copyLink(fenAt(ply));
    else if (act === "pgn") $("an-copy").click();
  });
  function copyLink(fen) {
    var url = location.origin + location.pathname + "?fen=" + encodeURIComponent(fen);
    copyText(url, "Enlace de la posición copiado.");
  }

  // ---------- Editor de tablero (como el de Lichess) ----------
  // Herramientas: «mano» (arrastrar piezas; soltarlas fuera del tablero las quita), una pieza (pulsar casillas
  // para colocarla) o la papelera (pulsar casillas para vaciarlas).
  var editing = false, editBoard = {}, tool = "hand", editTurn = "w", castle = { K: true, Q: true, k: true, q: true };
  var HAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V3.5a1.5 1.5 0 0 1 3 0V11M14 10.5V5a1.5 1.5 0 0 1 3 0v6.5M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a7 7 0 0 1-5.3-2.4L3.4 16a1.6 1.6 0 0 1 2.3-2.2L8 16"/></svg>';
  var TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>';
  function boardFromFen(fen) {
    var out = {};
    fen.split(" ")[0].split("/").forEach(function (row, r) {
      var c = 0;
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch >= "1" && ch <= "8") c += Number(ch);
        else { out[FILES[c] + (8 - r)] = (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase(); c++; }
      }
    });
    return out;
  }
  function castleAllowed() {
    return { K: editBoard.e1 === "wK" && editBoard.h1 === "wR", Q: editBoard.e1 === "wK" && editBoard.a1 === "wR", k: editBoard.e8 === "bK" && editBoard.h8 === "bR", q: editBoard.e8 === "bK" && editBoard.a8 === "bR" };
  }
  function editFen() {
    var rows = [];
    for (var r = 8; r >= 1; r--) {
      var row = "", empty = 0;
      for (var c = 0; c < 8; c++) {
        var p = editBoard[FILES[c] + r];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p[0] === "w" ? p[1] : p[1].toLowerCase();
      }
      rows.push(row + (empty || ""));
    }
    var ok = castleAllowed(), rights = ["K", "Q", "k", "q"].filter(function (k) { return castle[k] && ok[k]; }).join("");
    return rows.join("/") + " " + editTurn + " " + (rights || "-") + " - 0 1";
  }
  function startEditor() {
    editing = true; editBoard = boardFromFen(fenAt(ply)); editTurn = fenAt(ply).split(" ")[1]; tool = "hand";
    var rights = fenAt(ply).split(" ")[2]; castle = { K: rights.indexOf("K") >= 0, Q: rights.indexOf("Q") >= 0, k: rights.indexOf("k") >= 0, q: rights.indexOf("q") >= 0 };
    document.body.classList.add("an-editing");
    $("an-lines").hidden = $("an-moves").hidden = true; $("an-editor").hidden = false; $("an-pal-top").hidden = $("an-pal-bottom").hidden = false;
    if (sf) sf.postMessage("stop"); sfFen = null; arrowMove = null; drawArrow(); msg(""); render();
  }
  function stopEditor(fen) {
    editing = false; document.body.classList.remove("an-editing");
    $("an-lines").hidden = $("an-moves").hidden = false; $("an-editor").hidden = true; $("an-pal-top").hidden = $("an-pal-bottom").hidden = true;
    if (fen) loadFen(fen); else render();
  }
  function palette(color) {
    return '<button type="button" data-tool="hand" class="' + (tool === "hand" ? "on" : "") + '" aria-label="Mover piezas">' + HAND + "</button>"
      + ["K", "Q", "R", "B", "N", "P"].map(function (t) { var code = color + t; return '<button type="button" data-tool="' + code + '" class="' + (tool === code ? "on" : "") + '" aria-label="Colocar ' + { K: "rey", Q: "dama", R: "torre", B: "alfil", N: "caballo", P: "peón" }[t] + (color === "w" ? " blanco" : " negro") + '"><img src="assets/pieces/' + code + '.png" alt=""></button>'; }).join("")
      + '<button type="button" data-tool="trash" class="' + (tool === "trash" ? "on" : "") + '" aria-label="Quitar piezas">' + TRASH + "</button>";
  }
  function renderEditor() {
    $("an-board").innerHTML = squares().map(function (sq, i) {
      var p = editBoard[sq], dark = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;
      return '<div class="an-sq' + (dark ? " dk" : "") + '" data-sq="' + sq + '">' + (p ? '<img src="assets/pieces/' + p + '.png" alt="" draggable="false">' : "") + (i % 8 === 0 ? '<span class="an-rk">' + sq[1] + "</span>" : "") + (i >= 56 ? '<span class="an-fl">' + sq[0] + "</span>" : "") + "</div>";
    }).join("");
    $("an-pal-top").innerHTML = palette(flipped ? "w" : "b"); $("an-pal-bottom").innerHTML = palette(flipped ? "b" : "w");
    var ok = castleAllowed(), box = function (k, label) { return '<label><input type="checkbox" data-castle="' + k + '"' + (castle[k] && ok[k] ? " checked" : "") + (ok[k] ? "" : " disabled") + "> " + label + "</label>"; };
    $("an-editor").innerHTML = '<select id="an-ed-turn" aria-label="Turno"><option value="w"' + (editTurn === "w" ? " selected" : "") + '>Juegan las blancas</option><option value="b"' + (editTurn === "b" ? " selected" : "") + '>Juegan las negras</option></select>'
      + '<div class="an-castle"><strong>Enroque</strong><span>Blancas</span>' + box("K", "O-O") + box("Q", "O-O-O") + '<span>Negras</span>' + box("k", "O-O") + box("q", "O-O-O") + "</div>"
      + '<div class="an-ed-actions">'
      + '<button type="button" data-ed="start"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Posición inicial</button>'
      + '<button type="button" data-ed="clear">' + TRASH + "Limpiar el tablero</button>"
      + '<button type="button" data-ed="flip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/></svg>Girar el tablero</button>'
      + '<button type="button" data-ed="link"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>Copiar enlace</button>'
      + "</div>"
      + '<button type="button" class="an-ed-go" data-ed="ok">Analizar esta posición</button>'
      + '<p id="an-ed-msg" class="an-msg" role="alert"></p>'
      + '<button type="button" class="an-btn" data-ed="cancel">Cancelar</button>';
    $("an-evalbig").textContent = ""; $("an-depth").textContent = "Editor de tablero";
    if (document.activeElement !== $("an-fen")) $("an-fen").value = editFen();
  }
  function setSquare(sq, piece) { if (piece) editBoard[sq] = piece; else delete editBoard[sq]; }
  // Arrastre en el editor, como en Lichess: cualquier pieza del tablero se puede arrastrar a otra casilla
  // (o fuera, para quitarla) con la herramienta que sea; las piezas de las barras se arrastran al tablero.
  // Un clic sin arrastrar aplica la herramienta elegida: colocar esa pieza, quitar (papelera) o nada (mano).
  function startEditDrag(e, piece, from, size) {
    e.preventDefault();
    var ghost = document.createElement("img");
    ghost.src = "assets/pieces/" + piece + ".png"; ghost.alt = ""; ghost.className = "an-ghost";
    ghost.style.width = ghost.style.height = size + "px"; document.body.appendChild(ghost);
    drag = { edit: true, from: from, piece: piece, ghost: ghost, size: size, moved: false, x: e.clientX, y: e.clientY };
    moveGhost(e.clientX, e.clientY);
  }
  function editPointerDown(e, cell) {
    var sq = cell.dataset.sq, size = cell.getBoundingClientRect().width, piece = editBoard[sq];
    if (piece && tool !== "trash") {
      startEditDrag(e, piece, sq, size);
      var img = cell.querySelector("img"); if (img) img.style.opacity = ".25";
      return;
    }
    if (tool === "trash") { setSquare(sq, null); renderEditor(); return; }
    if (tool !== "hand") { setSquare(sq, tool); renderEditor(); }
  }
  function editDrop(d, e) {
    var to = sqFromPoint(e.clientX, e.clientY);
    if (!d.from) { if (to) setSquare(to, d.piece); renderEditor(); return; } // desde la barra
    if (!d.moved) {
      // Clic sin arrastrar sobre una pieza: con una pieza elegida, la cambia por esa o la quita si es la misma.
      if (tool !== "hand") setSquare(d.from, editBoard[d.from] === tool ? null : tool);
      renderEditor(); return;
    }
    setSquare(d.from, null);
    if (to) setSquare(to, d.piece); // soltar fuera del tablero quita la pieza
    renderEditor();
  }
  function palettePointerDown(e) {
    var b = e.target.closest("[data-tool]"); if (!b || e.button > 0) return;
    tool = b.dataset.tool;
    if (/^[wb][KQRBNP]$/.test(tool)) startEditDrag(e, tool, null, $("an-board").getBoundingClientRect().width / 8);
    $("an-pal-top").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x.dataset.tool === tool); });
    $("an-pal-bottom").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x.dataset.tool === tool); });
  }
  $("an-pal-top").addEventListener("pointerdown", palettePointerDown); $("an-pal-bottom").addEventListener("pointerdown", palettePointerDown);
  $("an-editor").addEventListener("change", function (e) {
    if (e.target.id === "an-ed-turn") editTurn = e.target.value;
    if (e.target.dataset.castle) castle[e.target.dataset.castle] = e.target.checked;
    renderEditor();
  });
  $("an-editor").addEventListener("click", function (e) {
    var b = e.target.closest("[data-ed]"); if (!b) return;
    var act = b.dataset.ed;
    if (act === "start") { editBoard = boardFromFen(START); editTurn = "w"; castle = { K: true, Q: true, k: true, q: true }; renderEditor(); }
    else if (act === "clear") { editBoard = {}; renderEditor(); }
    else if (act === "flip") { flipped = !flipped; renderEditor(); }
    else if (act === "link") copyLink(editFen());
    else if (act === "cancel") stopEditor(null);
    else if (act === "ok") {
      var all = Object.keys(editBoard).map(function (k) { return editBoard[k]; });
      if (all.filter(function (x) { return x === "wK"; }).length !== 1 || all.filter(function (x) { return x === "bK"; }).length !== 1) { msg("Tiene que haber un rey blanco y un rey negro.", true); return; }
      if (Object.keys(editBoard).some(function (sq) { return editBoard[sq][1] === "P" && (sq[1] === "1" || sq[1] === "8"); })) { msg("No puede haber peones en la primera ni en la última fila.", true); return; }
      var fen = editFen(), other = new Chess();
      if (!other.load(fen.replace(" " + editTurn + " ", " " + (editTurn === "w" ? "b" : "w") + " "))) { msg("Esa posición no es válida.", true); return; }
      if (other.in_check()) {
        var side = editTurn === "w" ? "negras" : "blancas", mover = editTurn === "w" ? "blancas" : "negras";
        msg("Posición imposible: las " + side + " están en jaque y les toca jugar a las " + mover + ". Cambia el turno a las " + side + " o mueve las piezas.", true); return;
      }
      stopEditor(fen);
    }
  });

  // ?fen=… abre esa posición (por ejemplo, desde un enlace compartido).
  var q = new URLSearchParams(location.search).get("fen");
  if (q && new Chess().validate_fen(q).valid) { rootFen = q; flipped = q.split(" ")[1] === "b"; }
  render();
})();

// El panel derecho acompaña la altura del tablero.
(function () {
  var board = document.getElementById("an-board");
  if (!board || !window.ResizeObserver) return;
  new ResizeObserver(function () { document.documentElement.style.setProperty("--an-board-h", board.getBoundingClientRect().height + "px"); }).observe(board);
})();

// Si el navegador cancela el arrastre (cambio de pestaña, gesto del sistema…), se quita la pieza que seguía al ratón.
window.addEventListener("pointercancel", function () {
  document.querySelectorAll(".an-ghost").forEach(function (g) { g.remove(); });
  document.querySelectorAll("#an-board img").forEach(function (i) { i.style.opacity = ""; });
});
