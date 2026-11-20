// Tablero de análisis: mover piezas (clic o arrastrar), recorrer la partida, cargar FEN o PGN
// y consultar a Stockfish (barra de evaluación y las 3 mejores líneas). Usa chess.js 0.10.3.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var FILES = "abcdefgh", START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  var rootFen = START, line = [], ply = 0, flipped = false, selected = null, drag = null, pendingPromo = null;
  // Árbol de jugadas con variantes: cada nodo { id, san, fen, from, to, parent, children }; children[0] es la
  // continuación principal. «line» es el camino de la raíz a la jugada actual más su continuación principal,
  // y «ply» la posición en ese camino: así la navegación, la flecha y las marcas trabajan sobre «line».
  var players = null; // jugadores del PGN: { w: { name, title, elo }, b: … }
  var nodes = {}, nextId = 1, pgnResult = null, root = newNode(null, { fen: START }); // pgnResult: { node, text } del PGN
  function newNode(parent, data) {
    var n = { id: nextId++, san: data.san || "", fen: data.fen, from: data.from || "", to: data.to || "", parent: parent, children: [] };
    nodes[n.id] = n; return n;
  }
  function resetTree(fen) {
    nodes = {}; nextId = 1; rootFen = fen; root = newNode(null, { fen: fen }); line = []; ply = 0; pgnResult = null; players = null;
    if (typeof stopBatch === "function") stopBatch(true);
    var box = document.getElementById("an-game"); if (box) box.hidden = true; // el botón solo existe con un PGN cargado
  }
  function setCur(node) {
    var path = [];
    for (var n = node; n && n !== root; n = n.parent) path.unshift(n);
    ply = path.length;
    for (var c = node.children[0]; c; c = c.children[0]) path.push(c);
    line = path;
  }
  function curNode() { return ply ? line[ply - 1] : root; }
  function isMainline(node) { for (var n = node; n.parent; n = n.parent) if (n.parent.children[0] !== n) return false; return true; }

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
    renderMoves(); renderFen(); renderNav(); renderPlayers(); renderOpening(); drawArrow(); analyse();
  }
  // Nombres de los jugadores (si los trae el PGN), con título y Elo: arriba el bando que está arriba en el tablero.
  function renderPlayers() {
    ["top", "bottom"].forEach(function (pos) {
      var el = $("an-player-" + pos), color = (pos === "top") !== flipped ? "b" : "w", p = players && players[color];
      el.hidden = !p || editing;
      if (!p) return;
      var e = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
      el.innerHTML = '<span class="an-pdot ' + color + '" aria-hidden="true"></span>' + (p.title ? '<b class="an-ptitle">' + e(p.title) + "</b>" : "")
        + '<span class="an-pname">' + e(p.name) + "</span>" + (/^\d+$/.test(p.elo) && p.elo !== "0" ? '<span class="an-pelo">' + e(p.elo) + "</span>" : "");
    });
  }
  // Apertura o defensa (lista de js/aperturas.js): la más larga que coincide con las jugadas hasta la posición actual.
  var openingIndex = null;
  function renderOpening() {
    var el = $("an-opening");
    if (!openingIndex) { openingIndex = {}; (window.APERTURAS || []).forEach(function (a) { if (a[2]) openingIndex[a[2]] = a; }); }
    var found = null;
    if (rootFen === START && !editing) {
      var sans = line.slice(0, ply).map(function (n) { return n.san; });
      for (var k = sans.length; k > 0 && !found; k--) found = openingIndex[sans.slice(0, k).join(" ")] || null;
    }
    el.hidden = !found;
    if (found) el.innerHTML = "<b>" + found[0] + "</b>" + found[1];
  }
  function renderNav() {
    $("an-first").disabled = $("an-prev").disabled = ply === 0;
    $("an-next").disabled = $("an-last").disabled = ply === line.length;
  }
  function renderFen() { if (document.activeElement !== $("an-fen")) $("an-fen").value = fenAt(ply); }
  // Lista de jugadas como en Lichess: la línea principal seguida y, tras cada jugada que tiene alternativas,
  // las variantes en bloques entre paréntesis (que a su vez pueden tener variantes).
  function moveHtml(n, forceNum) {
    var parts = n.parent.fen.split(" "), num = Number(parts[5]) || 1, white = parts[1] === "w", j = judgeNode(n);
    var pre = white ? '<span class="an-num">' + num + ".</span>" : forceNum ? '<span class="an-num">' + num + "…</span>" : "";
    return pre + '<button type="button" class="an-mv' + (n === curNode() ? " cur" : "") + '" data-id="' + n.id + '">' + fig(n.san)
      + (j && j.mark ? '<b class="an-mark ' + j.kind + '">' + j.mark + "</b>" : "") + "</button>"
      + (j && j.sym ? '<span class="an-sym" title="' + j.symTitle + '">' + j.sym + "</span>" : "")
      + (j && j.mark && j.best ? '<span class="an-note ' + j.kind + '">mejor ' + j.best + "</span>" : "");
  }
  function seqHtml(first, forceNum) {
    var html = "", force = forceNum;
    for (var n = first; n; n = n.children[0]) {
      html += moveHtml(n, force); force = false;
      if (n.parent.children[0] === n && n.parent.children.length > 1) {
        n.parent.children.slice(1).forEach(function (v) { html += '<div class="an-var">' + seqHtml(v, true) + "</div>"; });
        force = true; // tras una variante, la siguiente jugada lleva su número
      }
    }
    return html;
  }
  function renderMoves() {
    if (!root.children.length) { $("an-moves").innerHTML = '<p class="an-empty">Mueve una pieza para empezar.</p>'; return; }
    // Resultado tras la última jugada de la línea principal: el del final de la partida (mate o tablas)
    // o, si no, el que trae el PGN (mientras esa siga siendo la última jugada).
    var cur = curNode(), last = root; while (last.children[0]) last = last.children[0];
    var lg = new Chess(last.fen), end = lg.in_checkmate() ? (lg.turn() === "w" ? "0-1" : "1-0") : lg.in_draw() || lg.in_stalemate() ? "½-½" : pgnResult && pgnResult.node === last ? pgnResult.text : "";
    var jc = ply ? judgeNode(cur) : null;
    $("an-moves").innerHTML = '<div class="an-tree">' + seqHtml(root.children[0], true) + (end ? '<span class="an-res" title="Resultado">' + end + "</span>" : "") + "</div>"
      + (jc && jc.text ? '<p class="an-comment ' + jc.kind + '">' + jc.text + "</p>" : "");
    var el = $("an-moves").querySelector(".cur");
    if (el) el.scrollIntoView({ block: "nearest" });
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
  // Devuelve marca, símbolo y comentario de la jugada de un nodo, o null si falta evaluación.
  function judgeNode(node) {
    var beforeFen = node.parent.fen, afterFen = node.fen, before = evals[beforeFen], after = evals[afterFen];
    if (!before || !after || before.depth < 10 || (!after.over && after.depth < 10)) return null;
    var whiteMoved = beforeFen.split(" ")[1] === "w", sign = whiteMoved ? 1 : -1, who = whiteMoved ? "blancas" : "negras";
    var drop = (winChance(before) - winChance(after)) * sign;
    var r = { mark: "", kind: "", text: "", sym: "", symTitle: "" };
    if (drop >= 0.3) { r.mark = "??"; r.kind = "blunder"; r.text = "Error grave."; }
    else if (drop >= 0.2) { r.mark = "?"; r.kind = "mistake"; r.text = "Error."; }
    else if (drop >= 0.1) { r.mark = "?!"; r.kind = "dubious"; r.text = "Imprecisión."; }
    var best = before.best && before.best !== node.from + node.to ? uciSan(beforeFen, before.best) : "";
    if (r.mark && best) { r.text += " Mejor era " + best + "."; r.best = best; }
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
    // Si esa jugada ya existe desde aquí se sigue por ella; si no, se añade como variante (o como
    // continuación principal si aún no había ninguna). Nunca se borra lo que ya había.
    var parent = curNode(), node = parent.children.filter(function (c) { return c.san === m.san; })[0];
    if (!node) { node = newNode(parent, { san: m.san, fen: g.fen(), from: m.from, to: m.to }); parent.children.push(node); }
    setCur(node); selected = null; msg(""); render();
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
  $("an-moves").addEventListener("click", function (e) { var b = e.target.closest("[data-id]"); if (b && nodes[b.dataset.id]) { setCur(nodes[b.dataset.id]); selected = null; render(); } });
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
    resetTree(fen); selected = null; flipped = fen.split(" ")[1] === "b"; msg("Posición cargada."); render(); return true;
  }
  $("an-fen").addEventListener("change", function () { if (this.value.trim() !== fenAt(ply)) loadFen(this.value); });
  $("an-fen").addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });
  // Carga un PGN (línea principal). Devuelve el texto del error, o null si se ha cargado.
  function loadPgn(text) {
    text = (text || "").trim(); if (!text) return "Pega una partida en PGN para cargarla.";
    // chess.js pide una línea en blanco entre las cabeceras [Event …] y las jugadas: se añade si falta.
    text = text.replace(/\r\n?/g, "\n").replace(/^(\s*\[[^\n]*\]\s*\n)+(?!\s*\n)/, function (m) { return m.replace(/\s*$/, "") + "\n\n"; });
    var g = new Chess();
    if (!g.load_pgn(text, { sloppy: true })) return "No se pudo leer el PGN. Revisa que las jugadas sean correctas.";
    var hist = g.history({ verbose: true }), headers = g.header(), start = headers.FEN || START, replay = new Chess(start);
    resetTree(start);
    var at = root;
    hist.forEach(function (m) { replay.move(m); var n = newNode(at, { san: m.san, fen: replay.fen(), from: m.from, to: m.to }); at.children.push(n); at = n; });
    var res = (headers.Result || "").trim();
    if (/^(1-0|0-1|1\/2-1\/2)$/.test(res)) pgnResult = { node: at, text: res === "1/2-1/2" ? "½-½" : res };
    var who = function (c) { var name = (headers[c] || "").trim(); return name && name !== "?" ? { name: name, title: (headers[c + "Title"] || "").trim(), elo: (headers[c + "Elo"] || "").trim() } : null; };
    var pw = who("White"), pb = who("Black");
    if (pw || pb) players = { w: pw || { name: "Blancas", title: "", elo: "" }, b: pb || { name: "Negras", title: "", elo: "" } };
    setCur(root); selected = null; flipped = false; // se empieza desde la posición inicial
    $("an-game").hidden = false; $("an-summary").innerHTML = ""; setAnalyzeButton();
    msg("Partida cargada: " + (headers.White ? headers.White + " – " + (headers.Black || "?") + " · " : "") + Math.ceil(hist.length / 2) + " jugadas.");
    render();
    return null;
  }
  $("an-load").addEventListener("click", function () { var err = loadPgn($("an-pgn").value); if (err) msg(err, true); });
  // Ventana «Cargar PGN» del menú.
  function openPgnDialog() { $("an-pgn-error").textContent = ""; $("an-pgn-file").value = ""; $("an-pgn-text").value = ""; $("an-pgn-fname").textContent = "Elegir archivo .pgn"; $("an-pgn-dialog").showModal(); $("an-pgn-text").focus(); }
  $("an-pgn-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = loadPgn($("an-pgn-text").value);
    if (err) { $("an-pgn-error").textContent = err; return; }
    $("an-pgn-dialog").close();
  });
  $("an-pgn-cancel").addEventListener("click", function () { $("an-pgn-dialog").close(); });
  $("an-pgn-file").addEventListener("change", function () {
    var f = this.files && this.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () { $("an-pgn-text").value = String(r.result || ""); $("an-pgn-error").textContent = ""; $("an-pgn-fname").textContent = f.name; };
    r.onerror = function () { $("an-pgn-error").textContent = "No se pudo leer el archivo."; };
    r.readAsText(f);
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
  function pgnSeq(first, forceNum) {
    var out = [], force = forceNum;
    for (var n = first; n; n = n.children[0]) {
      var parts = n.parent.fen.split(" "), num = Number(parts[5]) || 1, white = parts[1] === "w";
      out.push((white ? num + ". " : force ? num + "... " : "") + n.san); force = false;
      if (n.parent.children[0] === n && n.parent.children.length > 1) {
        n.parent.children.slice(1).forEach(function (v) { out.push("(" + pgnSeq(v, true) + ")"); });
        force = true;
      }
    }
    return out.join(" ");
  }
  function pgnText() {
    var head = rootFen !== START ? '[SetUp "1"]\n[FEN "' + rootFen + '"]\n\n' : "";
    return head + (root.children.length ? pgnSeq(root.children[0], true) : "");
  }
  $("an-copy").addEventListener("click", function () {
    var text = pgnText();
    $("an-pgn").value = text;
    copyText(text, "PGN copiado al portapapeles.");
  });
  $("an-reset").addEventListener("click", function () { resetTree(START); selected = null; flipped = false; $("an-pgn").value = ""; msg(""); render(); });

  // ---------- Stockfish ----------
  // Cada «go» termina siempre con un «bestmove». Mientras se espera el de una búsqueda que se ha mandado
  // parar (sfPending), no se lee nada: así los restos de la búsqueda vieja no se atribuyen a la posición nueva.
  var evals = {}, movesTimer = null, sfSearching = false, sfPending = null;
  function launch(fen, depth, lines) {
    sfFen = fen; sfLines = {}; sfSearching = true;
    sf.postMessage("setoption name MultiPV value " + (lines || nLines)); sf.postMessage("position fen " + fen); sf.postMessage("go depth " + (depth || 24));
  }
  // Número de líneas de análisis (1 a 5), elegido con el contador de la derecha y recordado en este navegador.
  var nLines = 3;
  try { nLines = Math.min(5, Math.max(1, Number(localStorage.getItem("apejupoAnalisisLineas")) || 3)); } catch (_) {}
  function setLines(n) {
    nLines = Math.min(5, Math.max(1, n));
    try { localStorage.setItem("apejupoAnalisisLineas", String(nLines)); } catch (_) {}
    $("an-pv-count").textContent = nLines; $("an-pv-less").disabled = nLines === 1; $("an-pv-more").disabled = nLines === 5;
    if (sf && sfReady) { sfFen = null; analyse(); }
  }
  setTimeout(function () { setLines(nLines); }, 0);
  $("an-pv-less").addEventListener("click", function () { setLines(nLines - 1); });
  $("an-pv-more").addEventListener("click", function () { setLines(nLines + 1); });
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
        if (l === "uciok") { sf.postMessage("setoption name MultiPV value " + nLines); sf.postMessage("isready"); return; }
        if (l === "readyok") { if (!sfReady) { sfReady = true; if (batch) batchNext(); else analyse(); } return; }
        if (l.indexOf("bestmove") === 0) {
          sfSearching = false;
          if (batch) { sfPending = null; batchNext(); return; }
          if (sfPending) { var next = sfPending; sfPending = null; launch(next); }
          return;
        }
        if (sfPending || !sfSearching || l.indexOf("info") !== 0 || / bound /.test(l) || !sfFen) return;
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
        if (!batch && !sfTimer) sfTimer = setTimeout(function () { sfTimer = null; showEngine(); }, 120);
      };
      sf.postMessage("uci");
    } catch (_) { sf = false; }
  }
  function analyse() {
    var fen = fenAt(ply), g = new Chess(fen);
    if (!sfOn || editing || batch) return; // mientras se analiza la partida, el motor está ocupado con ella
    if (g.game_over()) {
      sfFen = null; sfPending = null; if (sf && sfSearching) sf.postMessage("stop");
      var mate = g.in_checkmate(), winW = g.turn() === "b";
      evals[fen] = mate ? { mate: true, v: winW ? 1 : -1, depth: 99, over: true } : { mate: false, v: 0, depth: 99, over: true };
      setBar(mate ? { mate: true, v: winW ? 1 : -1 } : { mate: false, v: 0 });
      $("an-evaltext").textContent = mate ? (winW ? "1-0" : "0-1") : "½"; $("an-evalbig").textContent = $("an-evaltext").textContent; arrowMove = null; drawArrow();
      $("an-lines").innerHTML = '<p class="an-empty">' + (mate ? "Jaque mate." : "Tablas.") + "</p>"; $("an-depth").textContent = "";
      return;
    }
    initSf();
    if (!sf || !sfReady || fen === sfFen || fen === sfPending) return;
    sfFen = fen; sfLines = {}; arrowMove = null; drawArrow(); $("an-evalbig").textContent = "…";
    $("an-lines").innerHTML = '<p class="an-empty">Calculando…</p>';
    if (sfSearching) { if (!sfPending) sf.postMessage("stop"); sfPending = fen; sfFen = null; }
    else launch(fen);
  }
  // ---------- Analizar la partida (solo con un PGN cargado) ----------
  // Stockfish recorre todas las posiciones de la línea principal (profundidad 16, una línea) y guarda su
  // evaluación; con ellas cada jugada recibe su marca, su valoración y un comentario corto.
  var batch = null, BATCH_DEPTH = 16;
  function mainlineNodes() { var out = []; for (var n = root.children[0]; n; n = n.children[0]) out.push(n); return out; }
  function setAnalyzeButton() {
    var b = $("an-analyze"); if (!b) return;
    if (batch) { b.innerHTML = '<span class="an-spin" aria-hidden="true"></span>Analizando… ' + batch.done + "/" + batch.total + " · Detener"; b.classList.add("busy"); }
    else { b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/></svg>' + (mainlineNodes().every(function (n) { return evals[n.fen] && evals[n.fen].depth >= BATCH_DEPTH; }) && root.children.length ? "Partida analizada" : "Analizar partida"); b.classList.remove("busy"); }
    $("an-progress").style.width = batch ? Math.round(batch.done / batch.total * 100) + "%" : "0";
    $("an-progress").parentElement.hidden = !batch;
  }
  function startBatch() {
    var fens = [root.fen].concat(mainlineNodes().map(function (n) { return n.fen; }));
    batch = { queue: fens, total: fens.length, done: 0 };
    setAnalyzeButton(); $("an-summary").innerHTML = "";
    $("an-lines").innerHTML = '<p class="an-empty">Analizando la partida…</p>'; $("an-depth").textContent = "Análisis de la partida";
    initSf();
    if (!sf || !sfReady) return; // al estar listo («readyok») se empieza
    if (sfSearching) { sf.postMessage("stop"); sfPending = null; } // su «bestmove» lanzará la primera posición
    else batchNext();
  }
  function stopBatch(silent) {
    if (!batch) return;
    batch = null;
    if (sf && sfSearching) sf.postMessage("stop");
    if (!silent) { setAnalyzeButton(); sfFen = null; analyse(); }
  }
  function batchNext() {
    if (!batch) return;
    while (batch.queue.length) {
      var fen = batch.queue.shift(), g = new Chess(fen);
      if (g.game_over()) {
        var mate = g.in_checkmate();
        evals[fen] = mate ? { mate: true, v: g.turn() === "b" ? 1 : -1, depth: 99, over: true } : { mate: false, v: 0, depth: 99, over: true };
        batch.done++; continue;
      }
      if (evals[fen] && evals[fen].depth >= BATCH_DEPTH) { batch.done++; continue; }
      setAnalyzeButton();
      launch(fen, BATCH_DEPTH, 1);
      batch.done++;
      return;
    }
    // Terminado: marcas en la lista, resumen por bando y el motor vuelve a la posición actual.
    batch = null; sfFen = null;
    setAnalyzeButton(); renderSummary(); renderMoves(); analyse();
  }
  function renderSummary() {
    var count = { w: { "?!": 0, "?": 0, "??": 0 }, b: { "?!": 0, "?": 0, "??": 0 } };
    mainlineNodes().forEach(function (n) { var j = judgeNode(n); if (j && j.mark) count[n.parent.fen.split(" ")[1]][j.mark]++; });
    var row = function (c, name) {
      var n = function (k, one, many) { return c[k] + " " + (c[k] === 1 ? one : many); };
      return '<div class="an-sum-row"><strong>' + name + '</strong><span class="dubious">' + n("?!", "imprecisión", "imprecisiones") + "</span>"
        + '<span class="mistake">' + n("?", "error", "errores") + "</span>" + '<span class="blunder">' + n("??", "error grave", "errores graves") + "</span></div>";
    };
    $("an-summary").innerHTML = row(count.w, "Blancas") + row(count.b, "Negras");
  }
  $("an-analyze").addEventListener("click", function () { if (batch) stopBatch(); else startBatch(); });

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
    $("an-lines").innerHTML = Object.keys(sfLines).map(Number).filter(function (k) { return k <= nLines; }).sort(function (a, b) { return a - b; }).map(function (k) {
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
    // La flecha marca la última jugada hecha (de dónde a dónde), no la que recomienda el motor.
    var svg = $("an-arrow"), last = ply && !editing ? line[ply - 1] : null;
    if (!last) { svg.innerHTML = ""; return; }
    var a = center(last.from), b = center(last.to), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    var end = [b[0] - dx / len * 0.3, b[1] - dy / len * 0.3];
    svg.innerHTML = '<defs><marker id="an-head" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 V4 L3,2 z" fill="#15781B"/></marker></defs>'
      + '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + end[0] + '" y2="' + end[1] + '" stroke="#15781B" stroke-width="0.16" stroke-linecap="round" opacity=".7" marker-end="url(#an-head)"/>';
  }


  // ---------- Menú contextual de una jugada (clic derecho, o pulsación larga en el móvil) ----------
  var ctxNode = null, pressTimer = null;
  function closeCtx() { var m = $("an-ctx"); if (m) m.hidden = true; ctxNode = null; }
  function openCtx(node, x, y) {
    var m = $("an-ctx");
    if (!m) { m = document.createElement("div"); m.id = "an-ctx"; m.className = "an-ctx"; m.setAttribute("role", "menu"); document.body.appendChild(m); m.addEventListener("click", ctxAction); }
    ctxNode = node;
    var main = isMainline(node);
    var I = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; };
    m.innerHTML = '<p class="an-ctx-title">' + fig(node.san) + "</p>"
      + (!main ? '<button type="button" role="menuitem" data-ctx="promote">' + I('<path d="M12 19V5M5 12l7-7 7 7"/>') + "Promocionar variante</button>" : "")
      + (!main ? '<button type="button" role="menuitem" data-ctx="main">' + I('<path d="M4 12h16M14 6l6 6-6 6"/>') + "Convertir en línea principal</button>" : "")
      + '<button type="button" role="menuitem" data-ctx="delete" class="danger">' + I('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>') + "Borrar desde aquí</button>"
      + '<button type="button" role="menuitem" data-ctx="copy">' + I('<path d="M8 4h8a2 2 0 0 1 2 2v14H6V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h6M9 17h3"/>') + "Copiar PGN</button>";
    m.hidden = false;
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px"; m.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
    var firstBtn = m.querySelector("button"); if (firstBtn) firstBtn.focus();
  }
  function ctxAction(e) {
    var b = e.target.closest("[data-ctx]"); if (!b || !ctxNode) return;
    var node = ctxNode, act = b.dataset.ctx; closeCtx();
    if (act === "promote") {
      // Sube la variante un nivel: pasa a ser la continuación principal en el punto donde se separa.
      for (var n = node; n.parent; n = n.parent) if (n.parent.children[0] !== n) { var sib = n.parent.children; sib.splice(sib.indexOf(n), 1); sib.unshift(n); break; }
    } else if (act === "main") {
      for (var k = node; k.parent; k = k.parent) { var ch = k.parent.children; ch.splice(ch.indexOf(k), 1); ch.unshift(k); }
    } else if (act === "delete") {
      var cur = curNode(), inside = false;
      for (var c = cur; c; c = c.parent) if (c === node) inside = true;
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
      if (inside) { setCur(node.parent); render(); return; }
    } else if (act === "copy") { $("an-copy").click(); return; }
    setCur(curNode()); render();
  }
  $("an-moves").addEventListener("contextmenu", function (e) {
    var b = e.target.closest("[data-id]"); if (!b || !nodes[b.dataset.id]) return;
    e.preventDefault(); openCtx(nodes[b.dataset.id], e.clientX, e.clientY);
  });
  // Móvil: pulsación larga sobre una jugada.
  $("an-moves").addEventListener("touchstart", function (e) {
    var b = e.target.closest("[data-id]"); if (!b) return;
    var t = e.touches[0];
    pressTimer = setTimeout(function () { pressTimer = null; openCtx(nodes[b.dataset.id], t.clientX, t.clientY); }, 550);
  }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach(function (ev) { $("an-moves").addEventListener(ev, function () { clearTimeout(pressTimer); }, { passive: true }); });
  document.addEventListener("pointerdown", function (e) { if (!e.target.closest("#an-ctx")) closeCtx(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCtx(); });
  window.addEventListener("scroll", closeCtx, { passive: true });

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
    else if (act === "load") openPgnDialog();
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
    $("an-evalbig").textContent = ""; $("an-depth").textContent = "Editar tablero";
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
  if (q && new Chess().validate_fen(q).valid) { resetTree(q); flipped = q.split(" ")[1] === "b"; }
  render();

  // ?torneo=… (desde «Analizar partidas» de la sala): todas las partidas del torneo en un desplegable.
  var torneo = new URLSearchParams(location.search).get("torneo");
  // torneo-config.js (la dirección del servidor de torneos) se carga después de este script.
  if (torneo) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { loadTournament(torneo); }); else loadTournament(torneo); }
  function loadTournament(id) {
    var api = (window.APEJUPO_TORNEOS_API || "").replace(/\/$/, "");
    msg("Cargando las partidas del torneo…");
    var base = api + "/api/tournaments/" + encodeURIComponent(id);
    var pgnReq = fetch(base + "/pgn", { cache: "no-store" })
      .then(function (r) { return r.text().then(function (t) { if (!r.ok) { var e = "No se pudieron cargar las partidas del torneo."; try { e = JSON.parse(t).error || e; } catch (x) {} throw new Error(e); } return t; }); });
    // La clasificación trae la federación y el título FIDE de cada jugador (el PGN solo trae el nombre).
    var infoReq = fetch(base, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([pgnReq, infoReq])
      .then(function (res) {
        var text = res[0], info = res[1], byName = {};
        ((info && info.standings) || []).forEach(function (p) { if (p && p.name) byName[p.name] = p; });
        var games = text.replace(/\r\n?/g, "\n").split(/\n\s*\n(?=\[Event )/).map(function (t) { return t.trim(); }).filter(Boolean);
        if (!games.length) throw new Error("No hay partidas para analizar.");
        var head = function (t, k) { var m = t.match(new RegExp("\\[" + k + ' "([^"]*)"\\]')); return m ? m[1] : ""; };
        var e = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
        var title = head(games[0], "Event");
        // Cada partida como en el combo de Torneos Live: bandera, título, nombre · resultado · y lo mismo del rival.
        var side = function (name) {
          var p = byName[name] || {}, flag = p.fed && window.U && U.flag ? U.flag(p.fed) : "";
          return '<span class="lv-pick-p">' + flag + (p.title ? '<em class="lv-pick-tt">' + e(p.title) + "</em>" : "") + '<span class="lv-pick-name" title="' + e(name) + '">' + e(name || "?") + "</span></span>";
        };
        var row = function (t) {
          var r = { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½" }[head(t, "Result")] || "–";
          return side(head(t, "White")) + '<span class="lv-pick-r">' + r + "</span>" + side(head(t, "Black"));
        };
        var rounds = games.map(function (t) { return head(t, "Round"); }), several = rounds.some(function (r) { return r !== rounds[0]; });
        var pickB = $("an-pick-b"), pickL = $("an-pick-l"), cur = 0;
        pickL.innerHTML = games.map(function (t, i) {
          var sep = several && (i === 0 || rounds[i] !== rounds[i - 1]) ? '<div class="an-pick-round">Ronda ' + e(rounds[i]) + "</div>" : "";
          return sep + '<button type="button" role="option" translate="no" data-i="' + i + '">' + row(t) + "</button>";
        }).join("");
        function show(i) {
          cur = i; pickB.querySelector("span").innerHTML = row(games[i]);
          pickL.querySelectorAll("[data-i]").forEach(function (o) { o.setAttribute("aria-selected", String(+o.dataset.i === i)); });
          var err = loadPgn(games[i]); if (err) msg(err, true);
        }
        function open(o) { pickL.hidden = !o; pickB.setAttribute("aria-expanded", String(o)); if (o) { var s = pickL.querySelector('[aria-selected="true"]'); if (s) { s.focus(); s.scrollIntoView({ block: "nearest" }); } } }
        pickB.onclick = function (ev) { ev.stopPropagation(); open(pickL.hidden); };
        pickL.onclick = function (ev) { var o = ev.target.closest("[data-i]"); if (!o) return; show(+o.dataset.i); open(false); pickB.focus(); };
        pickL.onkeydown = function (ev) {
          var items = Array.prototype.slice.call(pickL.querySelectorAll("[data-i]")), k = items.indexOf(document.activeElement);
          if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); ev.stopPropagation(); var n = items[Math.max(0, Math.min(items.length - 1, k + (ev.key === "ArrowDown" ? 1 : -1)))]; if (n) n.focus(); }
          if (ev.key === "Escape") { open(false); pickB.focus(); }
        };
        document.addEventListener("click", function (ev) { if (!pickL.hidden && !$("an-games").contains(ev.target)) open(false); });
        $("an-games").hidden = false;
        document.title = (title ? title + " · " : "") + "Tablero de análisis · Apejupo Chess Club";
        show(0);
      })
      .catch(function (err) { msg(err.message || "No se pudieron cargar las partidas del torneo.", true); });
  }
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
