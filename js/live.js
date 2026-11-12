(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt;

  // Canvas conserva las figuras originales cuando el móvil invierte las imágenes transparentes.
  var pieceImages = {};
  function pieceHtml(key) {
    return '<canvas class="live-piece" width="80" height="80" data-piece="' + key + '" aria-hidden="true"></canvas>';
  }
  function paintPiece(canvas) {
    var key = canvas.getAttribute("data-piece"), img = pieceImages[key];
    if (!img) { img = new Image(); img.src = "assets/pieces/" + key + ".png"; pieceImages[key] = img; }
    function paint() {
      if (!canvas.isConnected) return;
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
    }
    if (img.complete && img.naturalWidth) paint();
    else img.addEventListener("load", paint, { once: true });
  }
  function paintPieces(root) { Array.prototype.forEach.call(root.querySelectorAll(".live-piece"), paintPiece); }

  // ---------- Tablero decorativo de la cabecera ----------
  (function () {
    var el = $("board"); if (!el) return;
    var FEN = "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R", cells = "";
    FEN.split("/").forEach(function (row, y) {
      var x = 0;
      row.split("").forEach(function (ch) {
        if (/\d/.test(ch)) { for (var k = 0; k < +ch; k++, x++) cells += '<i class="' + ((x + y) % 2 ? "d" : "l") + '"></i>'; }
        else {
          cells += '<i class="' + ((x + y) % 2 ? "d" : "l") + '">' + pieceHtml((ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase()) + '</i>';
          x++;
        }
      });
    });
    el.innerHTML = cells;
    paintPieces(el);
  })();

  // ---------- Torneos en directo (Lichess Broadcasts) ----------
  var bcCard = U.bcCard; // tarjeta compartida con la portada (js/util.js)

  try { // si algo del visor fallara, las tarjetas de torneos y los streams se cargan igualmente
    if (!$("viewer")) throw 0; // esta página no lleva visor (solo la de un torneo)
  // Visor propio: partida en vivo desde el PGN de la ronda (Lichess), con Stockfish y reloj en vivo.
  var viewer = $("viewer"), sel = $("viewer-games");
  var roundId = "", games = {}, curId = "", ply = -1, follow = true, poll = null, tick = null;
  var roundDone = false; // la ronda ya está terminada en Lichess: ninguna de sus partidas puede estar en juego
  var orient = "w", order = [], mode = "grid";
  var vari = null, curCh = null, dragging = false, pendingRender = false; // variante propuesta por el usuario al mover piezas
  var reviewState = null, reviewController = null;

  function parseGame(txt) {
    var g = { tags: {}, san: [], clk: [], over: false };
    txt.replace(/^\[(\w+) "([^"]*)"\]/gm, function (_, k, v) { g.tags[k] = v; return ""; });
    var body = txt.replace(/^\[.*\]\s*$/gm, "");
    var re = /(\{[^}]*\})|(\d+\.(?:\.\.)?)|(1-0|0-1|1\/2-1\/2|\*)|([^\s{}]+)/g, m;
    while ((m = re.exec(body))) {
      if (m[1]) {
        var c = /\[%clk (\d+):(\d+):(\d+)/.exec(m[1]);
        if (c && g.san.length) g.clk[g.san.length - 1] = (+c[1]) * 3600 + (+c[2]) * 60 + (+c[3]);
      } else if (m[3]) { if (m[3] !== "*") g.over = true; }
      else if (m[4] && !/^\$/.test(m[4])) g.san.push(m[4].replace(/[?!]+$/, ""));
    }
    g.over = g.over || (g.tags.Result && g.tags.Result !== "*");
    return g;
  }

  function loadRound(first) {
    var rd = roundId, tr = tourRounds.filter(function (x) { return x.id === rd; })[0];
    // Mismo camino que la precarga: usa el PGN ya guardado de las rondas terminadas y reintenta si Lichess responde «demasiadas peticiones» (429)
    return roundTxt({ id: rd, finished: roundDone || !!(tr && tr.finished) }, 0).then(function (t) {
      if (rd !== roundId) return; // se cambió de ronda mientras llegaba la respuesta: no se mezclan partidas de rondas distintas
      if (!t) { if (first) setTimeout(function () { if (rd === roundId && !order.length) loadRound(true); }, 5000); return; } // sin respuesta: se vuelve a intentar
      var parts = t.split(/\n\s*\n(?=\[Event )/), list = [], ended = [];
      parts.forEach(function (p) {
        if (!p.trim()) return;
        var g = parseGame(p), id = (g.tags.GameURL || g.tags.Site || "").split("/").pop();
        if (!id) return;
        var old = games[id];
        // En una ronda terminada, las partidas sin resultado en el PGN («*») no se están jugando: la retransmisión se cortó o no se anotó el resultado
        if (roundDone) g.over = true;
        g.id = id; g.seen = old && old.san.length === g.san.length ? old.seen : Date.now();
        if (!first && old && !old.over && g.over) ended.push(id);
        games[id] = g; list.push(g);
      });
      order = list.map(function (x) { return x.id; });
      if (!list.length) { if (first) sel.innerHTML = "<option>Sin partidas todavía</option>"; return; }
      var key = order.join(",");
      if (first || sel.getAttribute("data-k") !== key) { // la lista del combo se rehace si cambian las partidas (p. ej. si la primera carga llegó vacía)
        var keep = games[curId] ? curId : null;
        sel.innerHTML = list.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(optLabel(x)) + "</option>"; }).join("");
        sel.setAttribute("data-k", key);
        if (!keep) { var on = list.filter(function (x) { return !x.over; })[0] || list[0]; curId = on.id; follow = true; ply = -1; }
        sel.value = curId;
      }
      Array.prototype.forEach.call(sel.options, function (o) { if (games[o.value]) o.textContent = optLabel(games[o.value]); });
      refresh();
      if (ended.length) notifyEnd(ended);
    });
  }
  // Texto de cada partida en el desplegable: con el resultado si ya ha terminado
  function optLabel(g) {
    var r = g.over ? { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½" }[g.tags.Result] : "";
    return g.tags.White + " - " + g.tags.Black + (r ? "  ·  " + r : "");
  }

  var board = $("lv-board");
  // Caché por partida: FEN y última jugada de cada posición, para no repetir toda la partida en cada clic
  var fcache = {};
  function fenCache(g) {
    var san = g.san, c = fcache[g.id];
    if (!c) c = fcache[g.id] = { san: [], fens: [new Chess().fen()], last: [null] };
    for (var i = 0; i < c.san.length && i < san.length; i++) if (c.san[i] !== san[i]) { c.san = []; c.fens = [c.fens[0]]; c.last = [null]; break; }
    if (c.san.length > san.length) { c.san.length = san.length; c.fens.length = san.length + 1; c.last.length = san.length + 1; }
    if (c.san.length < san.length) {
      var ch = new Chess(c.fens[c.san.length]);
      for (var k = c.san.length; k < san.length; k++) {
        var mv = ch.move(san[k], { sloppy: true }); if (!mv) break;
        c.san.push(san[k]); c.fens.push(ch.fen()); c.last.push({ from: mv.from, to: mv.to });
      }
    }
    return c;
  }
  function posAt(g, n, inVar) {
    var c = fenCache(g), k = Math.min(inVar ? vari.base : n, c.san.length);
    var ch = new Chess(c.fens[k]), last = c.last[k];
    if (inVar) for (var i = 0; i < vari.pos; i++) { var mv = ch.move(vari.moves[i], { sloppy: true }); if (!mv) break; last = { from: mv.from, to: mv.to }; }
    return { ch: ch, last: last };
  }
  // Notación con figuritas (como en las revistas): la letra de la pieza se sustituye por su símbolo
  var FIG = { K: "♔︎", Q: "♕︎", R: "♖︎", B: "♗︎", N: "♘︎" }; // ︎: símbolo de texto, nunca emoji de color
  function fig(san) {
    return esc(san).replace(/^([KQRBN])|=([QRBN])/g, function (_, piece, promotion) {
      return (promotion ? "=" : "") + '<b class="fg">' + FIG[piece || promotion] + '</b>';
    });
  }
  function figComment(text) {
    return esc(text).replace(/\b(?:[KQRBN](?:[a-h][1-8]?|[1-8])?x?[a-h][1-8]|[a-h](?:x[a-h])?[18]=[QRBN])(?:[+#])?/g, fig);
  }
  function fmtClk(s, hours) {
    if (s == null) return "--:--";
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (hours ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function render() {
    var g = games[curId]; if (!g) return;
    reviewSync(g);
    if (dragging) { pendingRender = true; return; }
    var n = g.san.length;
    if (vari && vari.gid !== curId) vari = null;
    var inVar = !!(vari && vari.active);
    if (inVar) { ply = vari.base + vari.pos; follow = false; }
    else if (follow || ply < 0 || ply > n) ply = n;
    var st = posAt(g, ply, inVar), ch = st.ch, tab = ch.board(), html = "";
    curCh = ch;
    var ul = st.last ? [st.last.from, st.last.to] : [];
    for (var f = 0; f < 8; f++) for (var c = 0; c < 8; c++) {
      var r = orient === "w" ? f : 7 - f, k = orient === "w" ? c : 7 - c, s = "abcdefgh"[k] + (8 - r), pz = tab[r][k];
      html += '<div class="sq ' + ((r + k) % 2 ? "dk" : "lt") + (ul.indexOf(s) >= 0 ? " last" : "") + '">' +
        (c === 7 ? '<b class="rk">' + (orient === "w" ? 8 - r : r + 1) + '</b>' : "") + (f === 7 ? '<b class="fl">' + "abcdefgh"[k] + '</b>' : "") +
        (pz ? pieceHtml(pz.color + pz.type.toUpperCase()) : "") + "</div>";
    }
    if (st.last) { // flecha amarilla de la última jugada, como en ChessBase
      var xy = function (sq) { var fi = "abcdefgh".indexOf(sq[0]), ri = 8 - +sq[1]; return [(orient === "w" ? fi : 7 - fi) + .5, (orient === "w" ? ri : 7 - ri) + .5]; };
      var A = xy(st.last.from), B = xy(st.last.to), dx = B[0] - A[0], dy = B[1] - A[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
      var hx = B[0] - ux * .32, hy = B[1] - uy * .32; // el cuerpo termina donde empieza la punta
      html += '<svg class="lv-arrow" viewBox="0 0 8 8" aria-hidden="true"><line x1="' + (A[0] + ux * .2) + '" y1="' + (A[1] + uy * .2) + '" x2="' + hx + '" y2="' + hy +
        '" stroke="#f5e300" stroke-width=".13" stroke-linecap="round" opacity=".9"/><polygon points="' + B[0] + "," + B[1] + " " +
        (hx - uy * .2) + "," + (hy + ux * .2) + " " + (hx + uy * .2) + "," + (hy - ux * .2) + '" fill="#f5e300" opacity=".9"/></svg>';
    }
    board.innerHTML = html;
    paintPieces(board);
    function pl(t, nm, el) { return (t ? '<em class="ttl">' + esc(t) + '</em> ' : "") + esc(nm) + (el ? ' <small>(' + esc(el) + ')</small>' : ""); }
    var w = nameFlag(g, "w") + pl(g.tags.WhiteTitle, g.tags.White, g.tags.WhiteElo), b = nameFlag(g, "b") + pl(g.tags.BlackTitle, g.tags.Black, g.tags.BlackElo);
    $("lv-top-name").innerHTML = orient === "w" ? b : w; $("lv-bot-name").innerHTML = orient === "w" ? w : b;
    var res = g.over ? g.tags.Result : "", pts = { "1-0": ["1", "0"], "0-1": ["0", "1"], "1/2-1/2": ["\u00bd", "\u00bd"] }[res];
    var sc = function (v) { return pts ? ' <b class="lv-score">' + v + "</b>" : ""; };
    if (pts) {
      $("lv-top-name").innerHTML += sc(orient === "w" ? pts[1] : pts[0]);
      $("lv-bot-name").innerHTML += sc(orient === "w" ? pts[0] : pts[1]);
    }
    var bd = /\.(\d+)$/.exec(g.tags.Round || "");
    $("viewer-bd").textContent = bd ? "Tablero " + bd[1] : "Partida";
    $("viewer-op").textContent = g.tags.Opening ? (g.tags.ECO ? g.tags.ECO + " · " : "") + opEs(g.tags.Opening) : "";
    var mv = $("lv-moves");
    var key = curId + "|" + n + "|" + res + "|" + (vari ? vari.base + ":" + vari.moves.join(",") + ":" + vari.collapsed : "") + "|" + rvVer;
    if (key !== listKey) { listKey = key; mv.innerHTML = listHtml(g, n, res); }
    var prev = mv.querySelector(".cur"); if (prev) prev.classList.remove("cur");
    var cur = reviewState && reviewState.running ? null : inVar ? mv.querySelector('[data-v="' + vari.pos + '"]') : mv.querySelector('[data-p="' + ply + '"]');
    if (cur) {
      cur.classList.add("cur");
      if (cur.offsetTop < mv.scrollTop || cur.offsetTop + cur.offsetHeight > mv.scrollTop + mv.clientHeight) mv.scrollTop = cur.offsetTop - mv.clientHeight / 2;
    }
    $("lv-live").classList.toggle("on", !inVar && ply === n);
    clocks(); analyse(ch.fen()); rvKick();
  }
  var listKey = "";
  // Nombre de la apertura (Lichess lo envía en inglés): se traduce con reglas sencillas y las más habituales
  var OPADJ = { Symmetrical: "simétrica", Sicilian: "siciliana", French: "francesa", Spanish: "española", Italian: "italiana", English: "inglesa", Scandinavian: "escandinava", Dutch: "holandesa", Scotch: "escocesa", Russian: "rusa", Modern: "moderna", Catalan: "catalana", Slav: "eslava", Vienna: "vienesa", Hungarian: "húngara", Polish: "polaca", Danish: "danesa", Latvian: "letona", Indian: "india", Philidor: "Philidor", Petrov: "Petrov", Pirc: "Pirc", Alekhine: "Alekhine", "Caro-Kann": "Caro-Kann", Nimzowitsch: "Nimzowitsch", Reti: "Réti", Bird: "Bird", Benoni: "Benoni", Benko: "Benko", Grünfeld: "Grünfeld", Trompowsky: "Trompowsky", London: "londinense", Berlin: "berlinesa", Closed: "cerrada", Open: "abierta", Classical: "clásica", Exchange: "de cambio", Advance: "de avance", Accelerated: "acelerada", Fianchetto: "con fianchetto", "Old Indian": "india antigua", "King's Indian": "india de rey", "Queen's Indian": "india de dama", "Nimzo-Indian": "Nimzo-india", "Bishop's Opening": "Apertura del alfil", "Two Knights": "de los dos caballos", "Four Knights": "de los cuatro caballos", "Three Knights": "de los tres caballos" };
  var OPKIND = { Defense: "Defensa", Defence: "Defensa", Opening: "Apertura", Game: "Partida", Attack: "Ataque", System: "Sistema", Gambit: "Gambito", Variation: "Variante", Variant: "Variante" };
  function opSeg(x) {
    x = x.replace(/^Ruy Lopez/, "Española (Ruy López)").replace(/\bQueen's Gambit\b/, "Gambito de dama").replace(/\bKing's Gambit\b/, "Gambito de rey")
      .replace(/\bQueen's Pawn\b/, "peón de dama").replace(/\bKing's Pawn\b/, "peón de rey").replace(/\bAccepted\b/, "aceptado").replace(/\bDeclined\b/, "rehusado")
      .replace(/\bwith\b/, "con").replace(/\bwithout\b/, "sin").replace(/\bMainline\b|\bMain Line\b/, "línea principal");
    var m = /^(.*?)\s*\b(Defense|Defence|Opening|Game|Attack|System|Gambit|Variation|Variant)\b\s*(.*)$/.exec(x);
    if (!m) return x;
    var name = m[1].trim(), kind = OPKIND[m[2]], rest = m[3] ? " " + m[3] : "";
    if (/^Gambito de /.test(x)) return x;
    var key = Object.keys(OPADJ).filter(function (k) { return name.indexOf(k) === 0; }).sort(function (a, b) { return b.length - a.length; })[0];
    var nm = key ? OPADJ[key] + name.slice(key.length) : name;
    if (m[2] === "Gambit" || m[2] === "Variation" || m[2] === "Variant" || m[2] === "Attack") return kind + (nm ? " " + nm : "") + rest;
    return kind + (nm ? " " + nm : "") + rest;
  }
  function opEs(n) { return String(n).split(/:\s*/).map(function (a) { return a.split(/\s*,\s*/).map(opSeg).join(", "); }).join(": "); }
  // Lista de jugadas en pastillas: cada pareja (número, blancas, negras) en su caja; el resultado, al final
  function listHtml(g, n, res) {
    var h = "", open = false, notes = "";
    function closePair() { if (open) { h += notes + "</span>"; notes = ""; open = false; } }
    for (var i = 0; i < n; i++) {
      if (i % 2 === 0) { closePair(); h += '<span class="pr"><span class="n">' + (i / 2 + 1) + ".</span>"; open = true; }
      else if (!open) { h += '<span class="pr ct">'; open = true; } // continuación de una pareja cortada por una variante
      h += '<span data-p="' + (i + 1) + '">' + fig(g.san[i]) + rvBadge(g.id, i + 1) + "</span>";
      var entry = reviewEntry(g.id, i + 1);
      if (entry && entry.relevant) notes += '<small class="lv-move-comment ' + entry.kind + '" data-p="' + (i + 1) + '">' + fig(g.san[i]) + ' · ' + esc(entry.label) + '. ' + figComment(entry.text) + '</small>';
      if (vari && i === vari.base) { closePair(); h += varBlock(); } // la variante va justo después de la jugada que sustituye
    }
    closePair();
    if (vari && vari.base >= n) h += varBlock();
    var rt = { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "\u00bd-\u00bd" }[res];
    if (rt) h += '<span class="rp" title="' + (res === "1-0" ? "Ganan las blancas" : res === "0-1" ? "Ganan las negras" : "Tablas") + '">' + rt + "</span>";
    return h;
  }
  // Variante del usuario, como en ChessBase: en su propia línea, entre paréntesis y con botón para plegarla
  function varBlock() {
    var h = '<div class="lv-var"><button type="button" class="vt" data-vt="1" title="Plegar o desplegar la variante">' + (vari.collapsed ? "+" : "\u2212") + "</button> ( ";
    var lim = vari.collapsed ? 1 : vari.moves.length;
    for (var j = 0; j < lim; j++) {
      var q = vari.base + j;
      if (q % 2 === 0) h += '<span class="n">' + (q / 2 + 1) + ".</span> ";
      else if (j === 0) h += '<span class="n">' + ((q - 1) / 2 + 1) + "...</span> ";
      h += '<span data-v="' + (j + 1) + '">' + fig(vari.moves[j]) + "</span> ";
    }
    return h + (vari.collapsed && vari.moves.length > 1 ? "… " : "") + ")</div>";
  }
  function clkOf(g, color, n) {
    for (var i = n - 1; i >= 0; i--) if (i % 2 === (color === "w" ? 0 : 1) && g.clk[i] != null) return g.clk[i];
    return null;
  }
  function clocks() {
    var g = games[curId]; if (!g) return;
    var inVar = !!(vari && vari.active), cp = inVar ? vari.base : ply; // en una variante los relojes quedan como en la posición de partida
    var live = !g.over && !inVar && ply === g.san.length, turn = cp % 2 === 0 ? "w" : "b";
    var v = { w: clkOf(g, "w", cp), b: clkOf(g, "b", cp) }, run = {};
    ["w", "b"].forEach(function (col) {
      run[col] = live && turn === col && g.san.length > 1;
      if (run[col] && v[col] != null) v[col] -= (Date.now() - g.seen) / 1000;
    });
    var hours = (v.w || 0) >= 3600 || (v.b || 0) >= 3600; // los dos relojes con el mismo formato
    ["w", "b"].forEach(function (col) {
      var el = $(orient === col ? "lv-bot-clk" : "lv-top-clk");
      el.textContent = fmtClk(v[col], hours); el.classList.toggle("run", run[col]);
    });
  }

  // Stockfish (worker desde cdnjs): barra de evaluación (puntos de vista de las blancas) y las 5 mejores líneas
  var sf = null, outstanding = 0, turnNow = "w", evalCache = {}, curFen = "", anTimer = null, lines = {}, linesTimer = null;
  var DEPTH = 40, NLINES = 3, MAXLINES = 5;
  try { NLINES = Math.min(MAXLINES, Math.max(1, +localStorage.getItem("apejupoLines") || 3)); } catch (_) {}
  function initSf() {
    if (sf !== null) return;
    sf = false;
    try {
      sf = new Worker("assets/stockfish/stockfish-19-lite-single.js");
      sf.onerror = function () { sf = false; $("lv-lines").innerHTML = '<div class="ln muted">No se pudo cargar Stockfish.</div>'; };
      sf.onmessage = function (e) {
        var l = String(e.data);
        if (l.indexOf("bestmove") === 0) { outstanding = Math.max(0, outstanding - 1); return; }
        if (outstanding !== 1 || l.indexOf("info") !== 0 || /bound/.test(l)) return;
        var dm = / depth (\d+)/.exec(l), nm = / nps (\d+)/.exec(l);
        if (dm && / multipv 1 /.test(l + " ")) $("lv-stats").textContent = "Profundidad " + dm[1] + (nm ? " · " + Math.round(+nm[1] / 1000) + " kN/s" : "");
        var m = /score (cp|mate) (-?\d+)/.exec(l), pv = / pv (.+)$/.exec(l);
        if (!m || !pv) return;
        var mp = /multipv (\d+)/.exec(l), idx = mp ? +mp[1] : 1, v = +m[2];
        if (turnNow === "b") v = -v;
        lines[idx] = { mate: m[1] === "mate", v: v, fen: curFen, pv: pv[1].trim().split(/\s+/) };
        if (idx === 1) { evalCache[curFen] = { mate: lines[1].mate, v: v }; showEval(evalCache[curFen]); }
        if (!linesTimer) linesTimer = setTimeout(function () { linesTimer = null; showLines(); }, 250);
      };
      sf.postMessage("uci");
    } catch (_) { sf = false; }
  }
  function showEval(r) {
    var pct = r.mate ? (r.v > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.004 * r.v)) - 1);
    $("lv-evalw").style.height = Math.max(3, Math.min(97, pct)) + "%";
    $("lv-evalbar").title = "Stockfish: " + evalText(r);
  }
  // Valor de la línea desde el punto de vista de las blancas: (+0.72) o (#-3)
  function evalText(r) { return r.mate ? "#" + r.v : (r.v > 0 ? "+" : "") + (r.v / 100).toFixed(2); }
  // Símbolo de ventaja (= ⩲ ± +-, y los de las negras ⩱ ∓ -+)
  function evalSym(r) {
    if (r.mate) return r.v > 0 ? "+-" : "-+";
    var a = Math.abs(r.v), w = r.v > 0;
    if (a < 25) return "=";
    if (a < 75) return w ? "⩲" : "⩱";
    if (a < 200) return w ? "±" : "∓";
    return w ? "+-" : "-+";
  }
  function pvToSan(fen, pv) {
    var ch = new Chess(fen), f = fen.split(" "), num = +f[5] || 1, white = f[1] === "w", out = [], first = true;
    for (var i = 0; i < pv.length && i < 16; i++) {
      var mv = ch.move({ from: pv[i].slice(0, 2), to: pv[i].slice(2, 4), promotion: pv[i][4] || undefined });
      if (!mv) break;
      out.push((white ? num + ". " : first ? num + "..." : "") + fig(mv.san));
      if (!white) num++;
      white = !white; first = false;
    }
    return out;
  }
  function showLines() {
    var box = $("lv-lines"), h = "";
    if (!Object.keys(lines).length) return;
    for (var i = 1; i <= NLINES; i++) h += '<div class="ln' + (lines[i] ? "" : " muted") + '">…</div>';
    box.innerHTML = h;
    var rows = box.children;
    for (var i = 1; i <= NLINES; i++) {
      var r = lines[i]; if (!r) continue;
      var row = rows[i - 1], head = '<b>' + i + ".</b> <em>" + evalSym(r) + " (" + evalText(r) + ")</em> ", mv = pvToSan(r.fen, r.pv), n = mv.length;
      // solo las jugadas que caben en una línea, hasta el borde del tablero
      do { row.innerHTML = head + mv.slice(0, n).join(" "); n--; } while (n > 0 && row.scrollWidth > row.clientWidth);
    }
  }
  var anFen = "", engineOn = true;
  try { engineOn = localStorage.getItem("apejupoSf") !== "off"; } catch (_) {}
  function analyse(fen) {
    if (reviewState && reviewState.running) return;
    if (fen === anFen) return; // la misma posición (p. ej. al refrescar la partida): no se reinicia el análisis
    anFen = fen; curFen = fen; turnNow = fen.split(" ")[1];
    if (evalCache[fen]) showEval(evalCache[fen]);
    clearTimeout(anTimer);
    anTimer = setTimeout(function () {
      initSf(); if (!sf) return;
      if (outstanding > 0) sf.postMessage("stop");
      if (!engineOn) return;
      // se conservan las líneas anteriores hasta que llegan las nuevas, para que el panel no parpadee
      if (!Object.keys(lines).length) $("lv-lines").innerHTML = '<div class="ln muted">Stockfish analizando…</div>';
      sf.postMessage("setoption name MultiPV value " + NLINES);
      sf.postMessage("position fen " + fen); sf.postMessage("go depth " + DEPTH); outstanding++;
    }, 150);
  }

  function setLines(n) {
    n = Math.min(MAXLINES, Math.max(1, n)); if (n === NLINES) return;
    NLINES = n; try { localStorage.setItem("apejupoLines", n); } catch (_) {}
    $("lv-less").disabled = n <= 1; $("lv-more").disabled = n >= MAXLINES; $("lv-nl").textContent = n;
    showLines();
    var f = curFen; anFen = ""; if (f) analyse(f);
  }
  $("lv-less").addEventListener("click", function () { setLines(NLINES - 1); });
  $("lv-more").addEventListener("click", function () { setLines(NLINES + 1); });
  $("lv-less").disabled = NLINES <= 1; $("lv-more").disabled = NLINES >= MAXLINES; $("lv-nl").textContent = NLINES;
  function applyOn() {
    $("lv-on").checked = engineOn; $("lv-ontxt").textContent = engineOn ? "On" : "Off";
    $("lv-dot").classList.toggle("off", !engineOn);
    if (!engineOn) {
      if (sf) { sf.terminate(); sf = null; outstanding = 0; }
      $("lv-lines").innerHTML = '<div class="ln muted">Análisis desactivado.</div>'; $("lv-stats").textContent = "";
    } else { var f = curFen; anFen = ""; if (f) analyse(f); }
  }
  $("lv-on").addEventListener("change", function () {
    engineOn = $("lv-on").checked; try { localStorage.setItem("apejupoSf", engineOn ? "on" : "off"); } catch (_) {}
    applyOn();
  });
  $("lv-on").checked = engineOn; $("lv-ontxt").textContent = engineOn ? "On" : "Off"; $("lv-dot").classList.toggle("off", !engineOn);

  // ---------- Miniaturas: las 10 primeras partidas del torneo, cada una con su barra de Stockfish ----------
  function setMode(m) { $("lv-thumbs").hidden = m !== "open"; }
  function refresh() { renderGrid(); fillMore(); if (!viewer.hidden) render(); }
  function pctOf(r) { return r.mate ? (r.v > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.004 * r.v)) - 1); }

  // Un motor aparte, con cola: analiza una partida tras otra (0,7 s cada una)
  var mini = null, miniQ = [], miniBusy = null, miniScore = null, miniEval = {};
  function miniInit() {
    if (mini !== null) return;
    mini = false;
    try {
      mini = new Worker("assets/stockfish/stockfish-19-lite-single.js");
      mini.onerror = function () { mini = false; };
      mini.onmessage = function (e) {
        var l = String(e.data);
        if (!miniBusy) return;
        if (l.indexOf("info") === 0 && !/bound/.test(l)) {
          var m = /score (cp|mate) (-?\d+)/.exec(l);
          if (m) { var v = +m[2]; if (miniBusy.turn === "b") v = -v; miniScore = { mate: m[1] === "mate", v: v }; }
        } else if (l.indexOf("bestmove") === 0) {
          var job = miniBusy; miniBusy = null;
          if (miniScore) { miniEval[job.id] = { fen: job.fen, r: miniScore }; setThumbBar(job.id); voiceCheck(job.id, miniScore); }
          miniScore = null; miniNext();
        }
      };
      mini.postMessage("uci");
    } catch (_) { mini = false; }
  }
  function miniNext() {
    if (miniBusy || !miniQ.length || !mini || (reviewState && reviewState.running)) return;
    miniBusy = miniQ.shift(); miniScore = null;
    mini.postMessage("position fen " + miniBusy.fen); mini.postMessage("go movetime 700");
  }
  function miniAsk(id, fen) {
    if (reviewState && reviewState.running) return;
    var e = miniEval[id];
    if (e && e.fen === fen) return;
    if ((miniBusy && miniBusy.id === id && miniBusy.fen === fen) || miniQ.some(function (j) { return j.id === id && j.fen === fen; })) return;
    miniQ = miniQ.filter(function (j) { return j.id !== id; });
    miniQ.push({ id: id, fen: fen, turn: fen.split(" ")[1] });
    miniInit(); miniNext();
  }
  function miniPause() { if (mini) mini.terminate(); mini = null; miniQ = []; miniBusy = null; miniScore = null; }
  function miniStop() { miniPause(); miniEval = {}; }

  function setThumbBar(id) {
    var el = $("lv-grid").querySelector('[data-g="' + id + '"] .th-w'), g = games[id]; if (!el || !g) return;
    var pct = 50;
    if (g.over) pct = { "1-0": 100, "0-1": 0, "1/2-1/2": 50 }[g.tags.Result] != null ? { "1-0": 100, "0-1": 0, "1/2-1/2": 50 }[g.tags.Result] : 50;
    else if (miniEval[id]) pct = pctOf(miniEval[id].r);
    el.style.height = Math.max(3, Math.min(97, pct)) + "%";
  }
  // Flecha amarilla de la última jugada también en las miniaturas (blancas abajo)
  function thumbArrow(last) {
    if (!last) return "";
    var xy = function (sq) { return ["abcdefgh".indexOf(sq[0]) + .5, 8 - +sq[1] + .5]; };
    var A = xy(last.from), B = xy(last.to), dx = B[0] - A[0], dy = B[1] - A[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
    var hx = B[0] - ux * .4, hy = B[1] - uy * .4;
    return '<svg class="th-arrow" viewBox="0 0 8 8" aria-hidden="true"><line x1="' + (A[0] + ux * .2) + '" y1="' + (A[1] + uy * .2) + '" x2="' + hx + '" y2="' + hy +
      '" stroke="#f5e300" stroke-width=".2" stroke-linecap="round" opacity=".92"/><polygon points="' + B[0] + "," + B[1] + " " +
      (hx - uy * .28) + "," + (hy + ux * .28) + " " + (hx + uy * .28) + "," + (hy - ux * .28) + '" fill="#f5e300" opacity=".92"/></svg>';
  }
  // Orden de las miniaturas: el que el usuario les da arrastrándolas (se recuerda por ronda)
  var TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
  var EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var removed = [];
  var userOrder = [], thDrag = null, justDragged = false, extras = [];
  function orderKey() { return "apejupoOrd" + roundId; }
  function loadUserOrder() { try { return JSON.parse(localStorage.getItem(orderKey())) || []; } catch (_) { return []; } }
  function sortedIds() {
    var base = order.slice(0, 10); extras.forEach(function (id) { if (order.indexOf(id) >= 0 && base.indexOf(id) < 0) base.push(id); });
    base = base.filter(function (id) { return removed.indexOf(id) < 0; });
    return base.map(function (id, i) { var k = userOrder.indexOf(id); return { id: id, k: k >= 0 ? k : 1000 + i }; })
      .sort(function (a, b) { return a.k - b.k; }).map(function (x) { return x.id; });
  }
  function thumbName(g, col) {
    var t = g.tags[col === "w" ? "WhiteTitle" : "BlackTitle"], n = g.tags[col === "w" ? "White" : "Black"];
    return nameFlag(g, col) + (t ? '<em class="ttl">' + esc(t) + "</em> " : "") + esc(n);
  }
  function thumbMeta(g, col) {
    var el = g.tags[col === "w" ? "WhiteElo" : "BlackElo"];
    var pt = g.over ? ({ "1-0": { w: "1", b: "0" }, "0-1": { w: "0", b: "1" }, "1/2-1/2": { w: "½", b: "½" } }[g.tags.Result] || {})[col] : "";
    return (el ? '<span class="el">' + esc(el) + "</span>" : "") + (pt ? '<b class="lv-score">' + pt + "</b>" : "");
  }
  // Relojes de las miniaturas: el del jugador al que le toca corre en vivo
  function thumbClocks() {
    if ($("lv-thumbs").hidden) return;
    Array.prototype.forEach.call($("lv-grid").querySelectorAll("[data-g]"), function (b) {
      var g = games[b.getAttribute("data-g")]; if (!g) return;
      var n = g.san.length, turn = n % 2 === 0 ? "w" : "b", live = !g.over && n > 1;
      var v = { w: clkOf(g, "w", n), b: clkOf(g, "b", n) };
      if (live && v[turn] != null) v[turn] -= (Date.now() - g.seen) / 1000;
      var hours = (v.w || 0) >= 3600 || (v.b || 0) >= 3600;
      ["w", "b"].forEach(function (col) {
        var el = b.querySelector('[data-c="' + col + '"]');
        el.textContent = fmtClk(v[col], hours); el.classList.toggle("run", live && turn === col);
      });
    });
  }
  function renderGrid() {
    if (thDrag) return; // mientras se arrastra una miniatura no se toca la rejilla
    var grid = $("lv-grid"), ids = sortedIds(), key = ids.join(",");
    if (grid.getAttribute("data-k") !== key) {
      grid.setAttribute("data-k", key);
      grid.innerHTML = ids.map(function (id) {
        var g = games[id];
        return '<button type="button" class="th" data-g="' + esc(id) + '" title="' + esc(optLabel(g)) + '"><span class="th-p"><span class="nm">' + thumbName(g, "b") + '</span><span class="mt">' + thumbMeta(g, "b") + '</span><span class="th-eye" role="button" data-eye="1" title="Ver la ficha de los jugadores" aria-label="Ver la ficha de los jugadores">'+EYE+'</span><span class="ck" data-c="b">--:--</span></span><span class="th-row"><span class="th-bar"><i class="th-w"></i></span><span class="th-board ent-board"></span></span><span class="th-p"><span class="nm">' + thumbName(g, "w") + '</span><span class="mt">' + thumbMeta(g, "w") + '</span><span class="ck" data-c="w">--:--</span></span><span class="th-del" role="button" data-del="1" title="Quitar esta partida" aria-label="Quitar esta partida">'+TRASH+'</span></button>';
      }).join("");
    }
    ids.forEach(function (id) {
      var g = games[id], b = grid.querySelector('[data-g="' + id + '"]'); if (!g || !b) return;
      b.title = optLabel(g); b.classList.toggle("sel", id === curId);
      var nms = b.querySelectorAll(".nm"), hb = thumbName(g, "b"), hw = thumbName(g, "w"); // el resultado aparece cuando la partida termina
      var mts = b.querySelectorAll(".mt"), mb = thumbMeta(g, "b"), mw = thumbMeta(g, "w");
      if (nms[0].innerHTML !== hb) nms[0].innerHTML = hb;
      if (nms[1].innerHTML !== hw) nms[1].innerHTML = hw;
      if (mts[0].innerHTML !== mb) mts[0].innerHTML = mb;
      if (mts[1].innerHTML !== mw) mts[1].innerHTML = mw;
      // Partida terminada: el resultado, grande, en medio del tablero
      var res = g.over ? { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½" }[g.tags.Result] || "" : "";
      var c = fenCache(g), k = c.san.length, bd = b.querySelector(".th-board"), sig = k + "|" + c.fens[k] + "|" + res;
      if (bd.getAttribute("data-s") !== sig) {
        bd.setAttribute("data-s", sig);
        var tab = new Chess(c.fens[k]).board(), ul = c.last[k] ? [c.last[k].from, c.last[k].to] : [], h = "";
        for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
          var pz = tab[r][f], s = "abcdefgh"[f] + (8 - r);
          h += '<div class="sq ' + ((r + f) % 2 ? "dk" : "lt") + (ul.indexOf(s) >= 0 ? " last" : "") + '">' +
            (pz ? pieceHtml(pz.color + pz.type.toUpperCase()) : "") + "</div>";
        }
        bd.innerHTML = h + thumbArrow(c.last[k]) + (res ? '<span class="th-res" aria-label="Resultado: ' + res + '">' + res + "</span>" : "");
        bd.classList.toggle("terminada", !!res);
        paintPieces(bd);
      }
      setThumbBar(id);
      if (!g.over) miniAsk(id, c.fens[k]);
    });
  }
  // Arrastrar una miniatura con el ratón la cambia de posición
  $("lv-grid").addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || thDrag) return;
    var el = e.target.closest(".th"); if (!el || e.target.closest("[data-del],[data-eye]")) return;
    var touch = e.pointerType === "touch";
    var st = { el: el, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, on: false, armed: !touch, timer: null, ghost: null, dx: 0, dy: 0 };
    thDrag = st;
    function begin() {
      st.on = true;
      var r = el.getBoundingClientRect();
      st.dx = st.x - r.left; st.dy = st.y - r.top;
      var g = el.cloneNode(true); g.className = "th th-ghost"; g.style.width = r.width + "px"; g.style.height = r.height + "px";
      g.style.left = st.lx - st.dx + "px"; g.style.top = st.ly - st.dy + "px";
      document.body.appendChild(g); paintPieces(g); st.ghost = g; el.classList.add("dragging");
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
    }
    function cancel() {
      clearTimeout(st.timer);
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      thDrag = null;
    }
    if (touch) st.timer = setTimeout(function () { st.armed = true; begin(); }, 380);
    function move(ev) {
      st.lx = ev.clientX; st.ly = ev.clientY;
      if (!st.armed) { if (Math.abs(ev.clientX - st.x) + Math.abs(ev.clientY - st.y) > 10) cancel(); return; } // el dedo se mueve antes de tiempo: es un desplazamiento
      if (!st.on) {
        if (Math.abs(ev.clientX - st.x) + Math.abs(ev.clientY - st.y) < 7) return;
        begin();
      }
      if (!st.ghost) return;
      st.ghost.style.left = ev.clientX - st.dx + "px"; st.ghost.style.top = ev.clientY - st.dy + "px";
      var under = document.elementFromPoint(ev.clientX, ev.clientY), t = under && under.closest && under.closest(".th");
      if (t && t !== el && t.parentNode === el.parentNode) {
        var tr = t.getBoundingClientRect(), after = ev.clientX > tr.left + tr.width / 2 && ev.clientY > tr.top || ev.clientY > tr.bottom - tr.height / 4;
        var sameRow = ev.clientY >= tr.top && ev.clientY <= tr.bottom;
        if (sameRow) {
          // el hueco se abre con animación: las demás miniaturas se deslizan a su nuevo sitio
          var sibs = Array.prototype.filter.call(el.parentNode.children, function (x) { return x !== el && x.classList.contains("th"); });
          var from = sibs.map(function (x) { var q = x.getBoundingClientRect(); return [q.left, q.top]; });
          el.parentNode.insertBefore(el, (ev.clientX > tr.left + tr.width / 2) ? t.nextSibling : t);
          var moved = [];
          sibs.forEach(function (x, i) {
            var q = x.getBoundingClientRect(), dx = from[i][0] - q.left, dy = from[i][1] - q.top;
            if (dx || dy) { x.style.transition = "none"; x.style.transform = "translate(" + dx + "px," + dy + "px)"; moved.push(x); }
          });
          if (moved.length) {
            void el.parentNode.offsetWidth;
            moved.forEach(function (x) { x.style.transition = "transform .22s ease"; x.style.transform = ""; });
            setTimeout(function () { moved.forEach(function (x) { x.style.transition = ""; }); }, 260);
          }
        }
      }
    }
    function up() {
      clearTimeout(st.timer);
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      if (st.on) {
        if (st.ghost.parentNode) st.ghost.parentNode.removeChild(st.ghost);
        el.classList.remove("dragging");
        var ids = Array.prototype.map.call($("lv-grid").querySelectorAll("[data-g]"), function (x) { return x.getAttribute("data-g"); });
        userOrder = ids; $("lv-grid").setAttribute("data-k", ids.join(","));
        try { localStorage.setItem(orderKey(), JSON.stringify(ids)); } catch (_) {}
        justDragged = true; setTimeout(function () { justDragged = false; }, 350); // el clic que sigue al soltar no cuenta
      }
      thDrag = null;
    }
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  });

  // Con el dedo, mientras se arrastra una miniatura no debe desplazarse la página
  document.addEventListener("touchmove", function (e) { if (thDrag && thDrag.on) e.preventDefault(); }, { passive: false });
  // Flecha circular: los tableros vuelven al orden de origen (el que da la retransmisión)
  $("viewer-reset").addEventListener("click", function () {
    userOrder = []; try { localStorage.removeItem(orderKey()); } catch (_) {}
    $("lv-grid").removeAttribute("data-k"); renderGrid();
  });
  $("lv-grid").addEventListener("contextmenu", function (e) { if (thDrag) e.preventDefault(); });
  // Un clic marca la miniatura; doble clic (o doble toque) trae su partida al frente en una tarjeta independiente
  var lastTap = { id: null, t: 0 };
  $("lv-grid").addEventListener("click", function (e) {
    var ey = e.target.closest("[data-eye]");
    if (ey) { openFide(ey.closest("[data-g]").getAttribute("data-g")); return; }
    var d = e.target.closest("[data-del]");
    if (d) {
      var id = d.closest("[data-g]").getAttribute("data-g");
      removed.push(id); extras = extras.filter(function (x) { return x !== id; });
      try { localStorage.setItem("apejupoDel" + roundId, JSON.stringify(removed)); localStorage.setItem("apejupoExtra" + roundId, JSON.stringify(extras)); } catch (_) {}
      if (curId === id) curId = null;
      $("lv-grid").removeAttribute("data-k"); more.removeAttribute("data-k"); renderGrid(); fillMore();
      return;
    }
    var b = e.target.closest("[data-g]"); if (!b || justDragged) return;
    var gid = b.getAttribute("data-g"), now = Date.now();
    if (lastTap.id === gid && now - lastTap.t < 420) { lastTap.id = null; openBig(gid); return; } // doble toque
    lastTap = { id: gid, t: now };
    curId = gid; renderGrid();
  });
  $("lv-grid").addEventListener("dblclick", function (e) {
    var b = e.target.closest("[data-g]"); if (!b || justDragged) return;
    openBig(b.getAttribute("data-g"));
  });
  function openBig(id) {
    curId = id; sel.value = id; follow = true; ply = -1; vari = null; listKey = ""; anFen = "";
    viewer.style.left = viewer.style.top = viewer.style.transform = ""; // vuelve al centro
    $("lv-backdrop").hidden = false; viewer.hidden = false;
    render(); renderGrid();
  }
  function closeBig() {
    reviewStop("Revisión detenida al cerrar la partida.");
    viewer.hidden = true; $("lv-backdrop").hidden = true; vari = null;
    if (sf) { sf.terminate(); sf = null; outstanding = 0; } anFen = ""; rvStop();
  }
  $("lv-closebig").addEventListener("click", closeBig);
  $("lv-backdrop").addEventListener("click", closeBig);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !viewer.hidden && !drag) closeBig(); });
  // La tarjeta se puede arrastrar desde su cabecera
  (function () {
    var bar = viewer.querySelector(".viewer-bar"), mv = null;
    bar.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest("select, button, option")) return;
      var r = viewer.getBoundingClientRect(); mv = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      viewer.style.transform = "none"; viewer.style.left = r.left + "px"; viewer.style.top = r.top + "px";
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    });
    bar.addEventListener("pointermove", function (e) {
      if (!mv) return;
      viewer.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - mv.dx)) + "px";
      viewer.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - mv.dy)) + "px";
    });
    bar.addEventListener("pointerup", function () { mv = null; });
  })();

  sel.addEventListener("change", function () { curId = sel.value; follow = true; ply = -1; vari = null; listKey = ""; render(); renderGrid(); });
  $("lv-moves").addEventListener("click", function (e) {
    var t = e.target.closest("[data-p],[data-v],[data-vt]"), g = games[curId]; if (!t || !g) return;
    if (t.getAttribute("data-vt")) { vari.collapsed = !vari.collapsed; render(); return; }
    var v = t.getAttribute("data-v");
    if (v && vari) { vari.active = true; vari.pos = +v; render(); return; }
    var p = t.getAttribute("data-p"); if (!p) return;
    if (vari) vari.active = false; // se pulsa una jugada de la partida: se sale de la variante (queda anotada)
    ply = +p; follow = ply === g.san.length; render();
  });
  // Vista previa al pasar el ratón por una jugada: tablero en esa posición, como en RondaRival
  (function () {
    var tip = document.createElement("div"); tip.className = "lv-hv"; tip.hidden = true; document.body.appendChild(tip);
    var shown = "", shownFen = "";
    // Barra de Stockfish de la vista previa: motor propio y ligero (0,6 s por posición), con caché por posición
    var hw = null, hvBusy = null, hvWant = null, hvScore = null, hvStopped = false, hvEval = {}, hvTimer = null;
    function paintBar(r) {
      var el = tip.querySelector(".hv-ew"); if (!el) return;
      el.style.height = Math.max(3, Math.min(97, r ? pctOf(r) : 50)) + "%";
      var eb = tip.querySelector(".hv-eb"); if (eb) eb.title = r ? "Stockfish: " + evalText(r) : "Stockfish analizando…";
    }
    function hvStart() {
      if (hvBusy || !hvWant || !hw) return;
      hvBusy = { fen: hvWant, turn: hvWant.split(" ")[1] }; hvWant = null; hvScore = null; hvStopped = false;
      hw.postMessage("position fen " + hvBusy.fen); hw.postMessage("go movetime 600");
    }
    function hvInit() {
      if (hw !== null) return;
      hw = false;
      try {
        hw = new Worker("assets/stockfish/stockfish-19-lite-single.js");
        hw.onerror = function () { hw = false; };
        hw.onmessage = function (e) {
          var l = String(e.data);
          if (!hvBusy) return;
          if (l.indexOf("info") === 0 && !/bound/.test(l)) {
            var m = /score (cp|mate) (-?\d+)/.exec(l);
            if (m) { var v = +m[2]; if (hvBusy.turn === "b") v = -v; hvScore = { mate: m[1] === "mate", v: v }; }
          } else if (l.indexOf("bestmove") === 0) {
            var job = hvBusy; hvBusy = null;
            if (hvScore && !hvStopped) { hvEval[job.fen] = hvScore; if (job.fen === shownFen && !tip.hidden) paintBar(hvScore); }
            hvStart();
          }
        };
        hw.postMessage("uci");
      } catch (_) { hw = false; }
    }
    function barFor(fen) {
      shownFen = fen;
      var c = hvEval[fen] || evalCache[fen];
      if (c) { paintBar(c); return; }
      var ch = new Chess(fen);
      if (ch.game_over()) { paintBar(ch.in_checkmate() ? { mate: true, v: fen.split(" ")[1] === "b" ? 1 : -1 } : { mate: false, v: 0 }); return; }
      paintBar(null);
      clearTimeout(hvTimer);
      hvTimer = setTimeout(function () {
        hvInit(); if (!hw) return;
        hvWant = fen;
        if (hvBusy && hvBusy.fen !== fen) { hvStopped = true; hw.postMessage("stop"); } else hvStart();
      }, 180);
    }
    function hide() { tip.hidden = true; shown = ""; barKey = ""; clearTimeout(hvTimer); hvWant = null; }
    function place(x, y) {
      var w = tip.offsetWidth, h = tip.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      var l = x + 22; if (l + w > vw - 8) l = Math.max(8, x - w - 18); // a la derecha del puntero; a la izquierda solo si no cabe
      var t = Math.max(8, Math.min(y - h / 2, vh - h - 8));
      tip.style.left = l + "px"; tip.style.top = t + "px";
    }
    function show(g, p, x, y, hint) {
      var key = g.id + "|" + p + "|" + orient + "|" + (hint || "");
      if (shown !== key) {
        shown = key;
        var c = fenCache(g); if (p > c.san.length) p = c.san.length;
        var tab = new Chess(c.fens[p]).board(), last = c.last[p], ul = last ? [last.from, last.to] : [], b = "";
        for (var f = 0; f < 8; f++) for (var q = 0; q < 8; q++) {
          var r = orient === "w" ? f : 7 - f, k = orient === "w" ? q : 7 - q, sq = "abcdefgh"[k] + (8 - r), pz = tab[r][k];
          b += '<i class="' + ((r + k) % 2 ? "dk" : "lt") + (ul.indexOf(sq) >= 0 ? " last" : "") + '">' +
            (pz ? pieceHtml(pz.color + pz.type.toUpperCase()) : "") + "</i>";
        }
        function pn(t, nm, el) { return (t ? esc(t) + " " : "") + esc(nm) + (el ? " (" + esc(el) + ")" : ""); }
        var res = g.over ? { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "\u00bd-\u00bd" }[g.tags.Result] : "";
        var num = Math.ceil(p / 2), dots = p % 2 ? "." : "...";
        var arrow = "";
        if (last) {
          var xy = function (q) { var fi = "abcdefgh".indexOf(q[0]), ri = 8 - +q[1]; return [(orient === "w" ? fi : 7 - fi) + .5, (orient === "w" ? ri : 7 - ri) + .5]; };
          var A = xy(last.from), B = xy(last.to), dx = B[0] - A[0], dy = B[1] - A[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, hx = B[0] - ux * .32, hy = B[1] - uy * .32;
          arrow = '<svg class="hv-a" viewBox="0 0 8 8" aria-hidden="true"><line x1="' + (A[0] + ux * .2) + '" y1="' + (A[1] + uy * .2) + '" x2="' + hx + '" y2="' + hy + '" stroke="#f5e300" stroke-width=".13" stroke-linecap="round" opacity=".9"/><polygon points="' + B[0] + "," + B[1] + " " + (hx - uy * .2) + "," + (hy + ux * .2) + " " + (hx + uy * .2) + "," + (hy - ux * .2) + '" fill="#f5e300" opacity=".9"/></svg>';
        }
        tip.innerHTML = '<div class="hv-h">' + pn(g.tags.WhiteTitle, g.tags.White, g.tags.WhiteElo) + " \u2013 " + pn(g.tags.BlackTitle, g.tags.Black, g.tags.BlackElo) + (res ? " &nbsp;" + res : "") + "</div>" +
          '<div class="hv-row"><div class="hv-eb"><div class="hv-ew"></div></div><div class="hv-b">' + b + arrow + "</div></div>" +
          '<div class="hv-c">' + (p ? "Posición tras " + num + dots + fig(g.san[p - 1]) : "Posición inicial") + "</div>" +
          '<div class="hv-f">' + (hint || "Pulsa para ir a esta posición.") + "</div>";
        paintPieces(tip);
      }
      tip.hidden = false; place(x, y);
      var cc = fenCache(g), pp = Math.min(p, cc.san.length);
      if (barKey !== key) { barKey = key; barFor(cc.fens[pp]); }
    }
    var barKey = "";
    var mvEl = $("lv-moves");
    mvEl.addEventListener("mousemove", function (e) {
      if (reviewState && reviewState.running) { hide(); return; }
      var t = e.target.closest("[data-p]"), g = games[curId], p = t && t.getAttribute("data-p");
      if (!p || !g) { hide(); return; }
      show(g, +p, e.clientX, e.clientY);
    });
    mvEl.addEventListener("mouseleave", hide);
    mvEl.addEventListener("click", hide);
    mvEl.addEventListener("scroll", hide);
    // Lo mismo en Emparejamientos: posición actual de la partida de la fila
    var fb = $("lv-fide");
    fb.addEventListener("mousemove", function (e) {
      var tr = e.target.closest && e.target.closest("tr[data-g]"), g = tr && games[tr.getAttribute("data-g")];
      if (!g || !fb.classList.contains("wide")) { hide(); return; }
      show(g, g.san.length, e.clientX, e.clientY, "Pulsa para abrir la partida.");
    });
    fb.addEventListener("mouseleave", hide);
    fb.addEventListener("click", hide);
    fb.addEventListener("scroll", hide, true);
  })();
  $("lv-prev").addEventListener("click", function () {
    if (vari && vari.active) {
      if (vari.pos > 0) vari.pos--; else { vari.active = false; ply = vari.base; follow = false; }
      render(); return;
    }
    follow = false; ply = Math.max(0, ply - 1); render();
  });
  $("lv-next").addEventListener("click", function () {
    if (vari && vari.active) { vari.pos = Math.min(vari.moves.length, vari.pos + 1); render(); return; }
    var n = games[curId].san.length; ply = Math.min(n, ply + 1); follow = ply === n; render();
  });
  // La lista de jugadas se ve siempre en varias parejas por fila
  $("lv-live").addEventListener("click", function () { vari = null; follow = true; render(); });

  // ---------- Mover piezas arrastrando con el ratón (variantes del usuario) ----------
  var drag = null;
  function sqAt(ev) {
    var r = board.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    var c = Math.floor(x * 8), rr = Math.floor(y * 8);
    return "abcdefgh"[orient === "w" ? c : 7 - c] + (orient === "w" ? 8 - rr : rr + 1);
  }
  function sqEl(sq) {
    var fi = "abcdefgh".indexOf(sq[0]), ri = 8 - +sq[1];
    var c = orient === "w" ? fi : 7 - fi, r = orient === "w" ? ri : 7 - ri;
    return board.children[r * 8 + c];
  }
  function endDrag() {
    if (!drag) return;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    Array.prototype.forEach.call(board.querySelectorAll(".dest, .from"), function (x) { x.classList.remove("dest", "from"); });
    var el = sqEl(drag.from), img = el && el.querySelector(".live-piece"); if (img) img.style.opacity = "";
    drag = null; dragging = false;
    if (pendingRender) { pendingRender = false; render(); }
  }
  board.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || !curCh || drag) return;
    var sq = sqAt(e); if (!sq) return;
    var pz = curCh.get(sq); if (!pz || pz.color !== curCh.turn()) return;
    var moves = curCh.moves({ square: sq, verbose: true });
    if (!moves.length) return;
    e.preventDefault();
    var ghost = document.createElement("canvas");
    ghost.setAttribute("data-piece", pz.color + pz.type.toUpperCase()); ghost.className = "lv-ghost";
    var size = board.getBoundingClientRect().width / 8 * .95;
    ghost.style.width = ghost.style.height = size + "px";
    document.body.appendChild(ghost);
    paintPiece(ghost);
    drag = { from: sq, ghost: ghost, size: size, moves: moves }; dragging = true;
    var el = sqEl(sq); el.classList.add("from"); var im = el.querySelector(".live-piece"); if (im) im.style.opacity = ".3";
    moves.forEach(function (m) { var d = sqEl(m.to); if (d) d.classList.add("dest"); });
    ghost.style.left = e.clientX - size / 2 + "px"; ghost.style.top = e.clientY - size / 2 + "px";
    try { board.setPointerCapture(e.pointerId); } catch (_) {}
  });
  board.addEventListener("pointermove", function (e) {
    if (!drag) return;
    drag.ghost.style.left = e.clientX - drag.size / 2 + "px"; drag.ghost.style.top = e.clientY - drag.size / 2 + "px";
  });
  board.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var to = sqAt(e), mv = null;
    if (to) drag.moves.forEach(function (m) { if (m.to === to && (!mv || m.promotion === "q")) mv = m; });
    if (mv && games[curId]) {
      if (vari && vari.active) { vari.moves = vari.moves.slice(0, vari.pos); vari.moves.push(mv.san); vari.pos = vari.moves.length; }
      else vari = { gid: curId, base: ply, moves: [mv.san], pos: 1, active: true, collapsed: false };
      follow = false;
    }
    endDrag();
    if (mv) render();
  });
  board.addEventListener("pointercancel", endDrag);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && drag) endDrag(); });
  document.addEventListener("keydown", function (e) {
    if (viewer.hidden || /select|input/i.test(e.target.tagName || "")) return;
    if (e.key === "ArrowLeft") $("lv-prev").click(); else if (e.key === "ArrowRight") $("lv-next").click();
  });
  function bgInterval(fn, ms) { // setInterval que el navegador no ralentiza en pestañas ocultas (corre en un Worker)
    try {
      var url = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)}," + ms + ")"], { type: "text/javascript" })), w = new Worker(url);
      w.onmessage = fn;
      return { stop: function () { w.terminate(); URL.revokeObjectURL(url); } };
    } catch (_) {
      var i = setInterval(fn, ms); return { stop: function () { clearInterval(i); } };
    }
  }
  function stop() { if (poll) poll.stop(); clearInterval(tick); poll = tick = null; }
  // Ficha comparativa de los dos jugadores (datos FIDE a través de Lichess)
  var FED = { ESP: "España", ARG: "Argentina", MEX: "México", CHI: "Chile", COL: "Colombia", PER: "Perú", URU: "Uruguay", VEN: "Venezuela", CUB: "Cuba", BRA: "Brasil", USA: "EE. UU.", CAN: "Canadá", ENG: "Inglaterra", SCO: "Escocia", WLS: "Gales", IRL: "Irlanda", FRA: "Francia", GER: "Alemania", ITA: "Italia", POR: "Portugal", NED: "Países Bajos", BEL: "Bélgica", SUI: "Suiza", AUT: "Austria", POL: "Polonia", CZE: "Chequia", SVK: "Eslovaquia", HUN: "Hungría", ROU: "Rumanía", BUL: "Bulgaria", GRE: "Grecia", TUR: "Turquía", SRB: "Serbia", CRO: "Croacia", SLO: "Eslovenia", BIH: "Bosnia", UKR: "Ucrania", RUS: "Rusia", BLR: "Bielorrusia", ARM: "Armenia", AZE: "Azerbaiyán", GEO: "Georgia", KAZ: "Kazajistán", UZB: "Uzbekistán", IND: "India", CHN: "China", JPN: "Japón", VIE: "Vietnam", PHI: "Filipinas", INA: "Indonesia", MAS: "Malasia", SGP: "Singapur", THA: "Tailandia", MGL: "Mongolia", IRI: "Irán", ISR: "Israel", EGY: "Egipto", NOR: "Noruega", SWE: "Suecia", DEN: "Dinamarca", FIN: "Finlandia", ISL: "Islandia", AUS: "Australia", NZL: "Nueva Zelanda", RSA: "Sudáfrica", KEN: "Kenia", BAN: "Bangladés", SRI: "Sri Lanka", NEP: "Nepal", PAK: "Pakistán" };
  var ISO = { ESP: "es", ARG: "ar", MEX: "mx", CHI: "cl", COL: "co", PER: "pe", URU: "uy", VEN: "ve", CUB: "cu", BRA: "br", USA: "us", CAN: "ca", ENG: "gb-eng", SCO: "gb-sct", WLS: "gb-wls", IRL: "ie", FRA: "fr", GER: "de", ITA: "it", POR: "pt", NED: "nl", BEL: "be", SUI: "ch", AUT: "at", POL: "pl", CZE: "cz", SVK: "sk", HUN: "hu", ROU: "ro", BUL: "bg", GRE: "gr", TUR: "tr", SRB: "rs", CRO: "hr", SLO: "si", BIH: "ba", UKR: "ua", RUS: "ru", BLR: "by", ARM: "am", AZE: "az", GEO: "ge", KAZ: "kz", UZB: "uz", IND: "in", CHN: "cn", JPN: "jp", VIE: "vn", PHI: "ph", INA: "id", MAS: "my", SGP: "sg", THA: "th", MGL: "mn", IRI: "ir", ISR: "il", EGY: "eg", NOR: "no", SWE: "se", DEN: "dk", FIN: "fi", ISL: "is", AUS: "au", NZL: "nz", RSA: "za", KEN: "ke", BAN: "bd", SRI: "lk", NEP: "np", PAK: "pk", GCI: "gg", JCI: "je", IMN: "im", GIB: "gi",  ECU: "ec", BOL: "bo", PAR: "py", CRC: "cr", PAN: "pa", DOM: "do", PUR: "pr", LTU: "lt", LAT: "lv", EST: "ee", MDA: "md", MKD: "mk", ALB: "al", MNE: "me", KOS: "xk", CYP: "cy", MLT: "mt", LUX: "lu", AND: "ad", MON: "mc", FAI: "fo", NGR: "ng", ALG: "dz", MAR: "ma", TUN: "tn", ZAM: "zm", UGA: "ug", ETH: "et", UAE: "ae", QAT: "qa", KSA: "sa", JOR: "jo", LBN: "lb", IRQ: "iq", SYR: "sy", HKG: "hk", TPE: "tw", KOR: "kr", MAC: "mo", MYA: "mm", CAM: "kh", LAO: "la", BRU: "bn", TJK: "tj", TKM: "tm", KGZ: "kg", AFG: "af", KUW: "kw", OMA: "om", BRN: "bh", YEM: "ye", LBA: "ly", SUD: "sd", MRI: "mu", SEY: "sc", MAD: "mg" };
  var fideCache = {}, fbd = $("lv-fbd"), fbox = $("lv-fide");
  function ic(d) { return '<svg class="lv-i" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; }
  var ICONS = {
    t: ic('<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5 7 21l5-3 5 3-1.5-7.5"/>'),
    f: ic('<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>'),
    n: ic('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    c: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    r: ic('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>'),
    b: ic('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.2 1 2 2 2.2C11 8.5 11.5 5.5 12 3z"/>'),
    i: ic('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.6 1.7-2 3-2s2.4.4 3 2M14.5 10h4M14.5 14h3"/>')
  };
  // Bandera delante del nombre, como en Lichess: la federación sale de la lista de jugadores del torneo (por FIDE id o por nombre)
  var fedBy = { id: {}, name: {} }, fedFor = null;
  var playersCache = {}, playersPending = {};
  function tournamentPlayers(id) {
    var cached = playersCache[id];
    if (cached && Date.now() - cached.at < 60000) return Promise.resolve(cached.data);
    if (playersPending[id]) return playersPending[id];
    playersPending[id] = fetch("https://apejupo-eventos.chessrival-worker.workers.dev/?players=" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) throw new Error("No se pudo consultar la lista de jugadores");
      return r.json();
    }).then(function (data) {
      if (!Array.isArray(data)) throw new Error("Lista de jugadores no válida");
      playersCache[id] = { at: Date.now(), data: data };
      delete playersPending[id];
      return data;
    }).catch(function (error) { delete playersPending[id]; throw error; });
    return playersPending[id];
  }
  function loadFeds() {
    if (!tourId || fedFor === tourId) return;
    var tid = fedFor = tourId;
    tournamentPlayers(tid).then(function (ps) {
      if (tid !== tourId) return;
      ps.forEach(function (p) { if (p.fed) { if (p.fideId) fedBy.id[p.fideId] = p.fed; fedBy.name[p.name] = p.fed; } });
      if (order.length) refresh();
    }).catch(function () { fedFor = null; });
  }
  // Si falta la bandera en assets/flags se prueba flagcdn.com; si tampoco está, se quita
  var FLAG_ERR = "if(!this.dataset.r){this.dataset.r=1;this.src=&quot;https://flagcdn.com/w40/&quot;+this.dataset.c+&quot;.png&quot;}else this.remove()";
  function nameFlag(g, col) {
    var w = col === "w", c = fedBy.id[g.tags[w ? "WhiteFideId" : "BlackFideId"]] || fedBy.name[g.tags[w ? "White" : "Black"]], f = c && ISO[c];
    return f ? '<img class="lv-flag nf" src="assets/flags/' + f + '.png" data-c="' + f + '" alt="" title="' + esc(FED[c] || c) + '" onerror="' + FLAG_ERR + '">' : "";
  }
  function flag(code) { var c = ISO[code]; return c ? '<img class="lv-flag" src="assets/flags/' + c + '.png" alt="" onerror="this.remove()"> ' : ""; }
  function fideGet(id) {
    if (!id) return Promise.resolve(null);
    return fideCache[id] || (fideCache[id] = fetch("https://lichess.org/api/fide/player/" + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }));
  }
  function closeFide() { fbd.hidden = true; fbox.hidden = true; }
  function openFide(gid) {
    var g = games[gid]; if (!g) return;
    var t = g.tags, rd = t.Round ? "Ronda " + t.Round : "Partida";
    fbd.hidden = false; fbox.hidden = false; fbox.classList.remove("wide");
    fbox.innerHTML = '<div class="lv-fhead"><span>' + esc(rd) + '</span><button type="button" class="btn-ghost" id="lv-fclose">Cerrar</button></div><p class="muted" style="padding:16px">Cargando fichas…</p>';
    $("lv-fclose").addEventListener("click", closeFide);
    Promise.all([fideGet(t.WhiteFideId), fideGet(t.BlackFideId)]).then(function (r) {
      if (fbox.hidden) return;
      var P = [{ api: r[0], name: t.White, side: "Blancas", title: t.WhiteTitle, elo: t.WhiteElo, id: t.WhiteFideId },
               { api: r[1], name: t.Black, side: "Negras", title: t.BlackTitle, elo: t.BlackElo, id: t.BlackFideId }];
      var yr = new Date().getFullYear();
      P.forEach(function (x) {
        var a = x.api || {};
        x.t = a.title || x.title || "—"; x.fed = a.federation ? '<span title="' + esc(FED[a.federation] || a.federation) + '">' + flag(a.federation) + "<b>" + esc(a.federation) + "</b></span>" : "—";
        x.y = a.year ? a.year + " · " + (yr - a.year) + " años" : "—";
        x.r = [a.standard != null ? a.standard : (x.elo ? +x.elo : null), a.rapid != null ? a.rapid : null, a.blitz != null ? a.blitz : null];
      });
      function head(x, i) {
        var ph = x.api && x.api.photo && x.api.photo.medium;
        var ini = (x.name || "?").replace(/,/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
        return '<td class="c"><div class="lv-ph c' + i + '">' + (ph ? '<img src="' + esc(safeUrl(ph)) + '" alt="">' : esc(ini)) + '</div><b>' + esc(x.name) + '</b><small>' + x.side + '</small></td>';
      }
      function row(lbl, a, b, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + lbl + '</th><td class="a0">' + a + '</td><td class="a1">' + b + '</td></tr>'; }
      function cell(v, o) {
        if (v == null) return "—";
        return o != null && v > o ? '<b class="win">' + v + "</b>" : "<span>" + v + "</span>";
      }
      function rt(k) { var a = P[0].r[k], b = P[1].r[k]; return [cell(a, b, 0), cell(b, a, 1)]; }
      var c0 = rt(0), c1 = rt(1), c2 = rt(2);
      function verdict() {
        var a = P[0].r[0], b = P[1].r[0]; if (a == null || b == null) return "";
        var d = a - b, txt = d === 0 ? "Mismo rating clásico" : "Favorito por rating clásico: <b>" + esc((d > 0 ? P[0] : P[1]).name) + "</b> (+" + Math.abs(d) + ")";
        return '<div class="lv-fver">' + txt + "</div>";
      }
      function link(x) { return x.id ? '<a target="_blank" rel="noopener" href="https://ratings.fide.com/profile/' + esc(x.id) + '">' + esc(x.id) + '</a>' : "—"; }
      fbox.innerHTML = '<div class="lv-fhead"><span>' + esc(rd) + ' · Ficha FIDE</span><button type="button" class="btn-ghost" id="lv-fclose">Cerrar</button></div>' +
        '<table class="lv-ftab"><colgroup><col style="width:28%"><col style="width:36%"><col style="width:36%"></colgroup><tr><td></td>' + head(P[0], 0) + head(P[1], 1) + '</tr>' +
        row(ICONS.t + "Título", esc(P[0].t), esc(P[1].t)) + row(ICONS.f + "Federación", P[0].fed, P[1].fed) + row(ICONS.n + "Nacimiento", esc(P[0].y), esc(P[1].y)) +
        row(ICONS.c + "Clásico", c0[0], c0[1], "rt big") + row(ICONS.r + "Rápidas", c1[0], c1[1], "rt") + row(ICONS.b + "Blitz", c2[0], c2[1], "rt") + row(ICONS.i + "ID FIDE", link(P[0]), link(P[1])) + '</table>' +
        verdict() + '<p class="lv-ffoot">Datos de la FIDE. En verde, quien lidera cada categoría.</p>';
      $("lv-fclose").addEventListener("click", closeFide);
    });
  }
  $("viewer-eye").innerHTML = EYE; $("viewer-eye").addEventListener("click", function () { if (curId) openFide(curId); });
  fbd.addEventListener("click", closeFide);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !fbox.hidden) closeFide(); });

  // Señalar cambios de al menos medio peón en la valoración.
  var RV_LIMIT = 50, rv = null, rvBusy = null, rvScore = null;
  function rvInit() {
    if (rv !== null) return;
    rv = false;
    try {
      rv = new Worker("assets/stockfish/stockfish-19-lite-single.js");
      rv.onerror = function () { rv = false; };
      rv.onmessage = function (e) {
        var l = String(e.data);
        if (!rvBusy) return;
        if (l.indexOf("info") === 0 && !/bound/.test(l)) {
          var m = /score (cp|mate) (-?\d+)/.exec(l);
          if (m) {
            var v = +m[2];
            if (m[1] === "mate") v = v === 0 ? 0 : (v > 0 ? 1 : -1) * (2000 - Math.min(Math.abs(v), 100));
            rvScore = rvBusy.turn === "b" ? -v : v;
          }
        } else if (l.indexOf("bestmove") === 0) {
          var job = rvBusy; rvBusy = null;
          var arr = rvEval[job.id] || (rvEval[job.id] = []);
          arr[job.k] = rvScore == null ? null : rvScore;
          rvScore = null;
          var flagged = rvDelta(job.id, job.k) !== null || rvDelta(job.id, job.k + 1) !== null;
          if (flagged) { rvVer++; if (!viewer.hidden && job.id === curId) { listKey = ""; render(); } }
          rvKick();
        }
      };
      rv.postMessage("uci");
    } catch (_) { rv = false; }
  }
  var rvEval = {}, rvVer = 0;
  // Variación de la valoración (en centipeones, desde las blancas) provocada por la jugada k; null si no supera el límite
  function rvDelta(id, k) {
    var a = rvEval[id]; if (!a || k < 1 || a[k] == null || a[k - 1] == null) return null;
    var d = a[k] - a[k - 1];
    return Math.abs(d) >= RV_LIMIT ? d : null;
  }
  function rvText(v) {
    if (Math.abs(v) >= 1900) return (v > 0 ? "+" : "-") + "#" + (2000 - Math.abs(v));
    return (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.abs(v) / 100).toFixed(2);
  }
  function reviewEntry(id, k) {
    return reviewState && reviewState.id === id && !reviewState.running ? reviewState.entries[k - 1] : null;
  }
  function rvBadge(id, k) {
    if (reviewState && reviewState.id === id && reviewState.running) return "";
    if (reviewState && reviewState.id === id && k <= reviewState.san.length) {
      var entry = reviewEntry(id, k); if (!entry || !entry.score) return "";
      var symbol = entry.score.mate && entry.score.v === 0 ? (k % 2 ? "+-" : "-+") : evalSym(entry.score);
      return (entry.mark ? '<b class="lv-mark">' + esc(entry.mark) + '</b>' : '') + '<i class="ev review-score ' + entry.kind + '" title="Stockfish: ' + esc(symbol + " (" + evalText(entry.score) + "), desde las blancas") + '">' + esc(evalText(entry.score)) + '</i>';
    }
    var d = rvDelta(id, k); if (d === null) return "";
    var bad = (k % 2 === 1) ? d < 0 : d > 0; // la jugada empeoró la posición de quien la hizo
    return '<i class="ev ' + (bad ? "bad" : "good") + '" title="Stockfish: ' + rvText(rvEval[id][k]) + ', desde las blancas">' + evalSym({ mate: false, v: rvEval[id][k] }) + "</i>";
  }
  function rvKick() {
    if (rvBusy || viewer.hidden || (reviewState && reviewState.running)) return;
    var g = games[curId]; if (!g) return;
    if (reviewState && reviewState.id === curId && reviewState.done >= g.san.length) return;
    rvInit(); if (!rv) return;
    var fens = fenCache(g).fens, n = g.san.length, arr = rvEval[curId] || (rvEval[curId] = []);
    // si la partida cambió por detrás (poco probable), se descartan valoraciones sobrantes
    if (arr.length > n + 1) arr.length = n + 1;
    for (var k = 0; k <= n; k++) {
      if (arr[k] === undefined && fens[k]) {
        rvBusy = { id: curId, k: k, turn: fens[k].split(" ")[1] }; rvScore = null;
        rv.postMessage("position fen " + fens[k]); rv.postMessage("go movetime 220");
        return;
      }
    }
  }
  function rvStop() { if (rv) rv.terminate(); rv = null; rvBusy = null; rvScore = null; }

  // Revisión completa bajo demanda: se conserva la instantánea aunque el directo añada jugadas.
  function reviewStop(message) {
    if (reviewController) reviewController.stop();
    reviewController = null;
    if (reviewState && reviewState.running) {
      reviewState.running = false;
      reviewState.status = message || "Revisión detenida. Se conservan los comentarios ya calculados.";
      rvVer++;
    }
    anFen = "";
  }
  function reviewSync(g) {
    var button = $("lv-review-go"), panel = $("lv-review"); if (!button || !panel) return;
    if (reviewState && (reviewState.id !== g.id || g.san.slice(0, reviewState.san.length).join(" ") !== reviewState.san.join(" "))) {
      reviewStop(); reviewState = null; rvVer++; listKey = "";
    }
    var state = reviewState;
    var upToDate = state && !state.running && state.done >= g.san.length;
    button.disabled = !g.san.length || !!upToDate;
    button.textContent = state && state.running ? "Detener" : upToDate ? "Analizado" : state && state.done > 0 ? "Continuar" : "Analizar";
    button.title = state && state.done > 0 ? "Analizar únicamente las jugadas pendientes" : "Analizar toda la partida desde el principio con comentarios";
    button.setAttribute("aria-pressed", String(!!(state && state.running)));
    panel.hidden = !state; if (!state) return;
    $("lv-review-loading").hidden = !state.running;
    $("lv-review-status").textContent = state.status + (!state.running && g.san.length > state.san.length ? " Hay nuevas jugadas: pulsa Continuar." : "");
    $("lv-review-status").hidden = state.running;
    $("lv-review-note").hidden = state.running;
    var pending = state.san.length - state.startDone, done = state.done - state.startDone;
    $("lv-review-progress").max = Math.max(1, pending); $("lv-review-progress").value = Math.max(0, done);
    $("lv-review-progress").hidden = !state.running;
    $("lv-review-progress").setAttribute("aria-valuetext", done + " de " + pending + (state.startDone ? " nuevas" : "") + " medias jugadas analizadas");
  }
  if ($("lv-review-go")) $("lv-review-go").addEventListener("click", function () {
    var g = games[curId]; if (!g || !g.san.length) return;
    reviewSync(g);
    if (reviewState && reviewState.running) { reviewStop(); render(); return; }
    var previous = reviewState;
    if (previous && previous.done >= g.san.length) return;
    reviewStop(); rvStop(); miniPause(); clearTimeout(anTimer);
    if (sf) { sf.terminate(); sf = null; outstanding = 0; }
    var startDone = previous ? previous.done : 0;
    reviewState = { id: curId, san: g.san.slice(), done: startDone, startDone: startDone, entries: previous ? previous.entries.slice() : [], checkpoint: previous ? previous.checkpoint : null, running: true, status: startDone ? "Analizando las jugadas pendientes…" : "Preparando análisis desde la posición inicial…" };
    rvVer++; follow = false; if (ply < 0) ply = g.san.length; render();
    if (!window.ApejupoGameReview) { reviewStop("No se pudo cargar el módulo de revisión. Recarga la página."); render(); return; }
    var state = reviewState;
    reviewController = window.ApejupoGameReview.start({
      fens: fenCache(g).fens.slice(), san: state.san, previous: state.checkpoint,
      onProgress: function (progress) {
        if (reviewState !== state) return;
        state.done = progress.done; state.entries = progress.entries; state.running = !progress.complete;
        state.checkpoint = progress.checkpoint;
        state.status = progress.complete ? "Revisión completada" : "Analizando: " + progress.done + "/" + progress.total + " medias jugadas.";
        if (progress.complete) {
          reviewController = null; anFen = ""; rvVer++; render(); renderGrid();
        } else reviewSync(g);
      },
      onError: function (message) { if (reviewState === state) { reviewStop(message); render(); } }
    });
  });

  // ---------- Rondas, clasificación, emparejamientos y avisos ----------
  var tourId = null, tourRounds = [];
  // Número de una ronda: el que lleve su nombre («Round 3», «Ronda 3») o, si no lleva, su posición en el torneo
  function numRonda(r) { var m = /(\d+)/.exec(r.name || ""); return m ? +m[1] : tourRounds.indexOf(r) + 1; }
  function standTitle() {
    // Si se juega la ronda 4 → «después de la ronda 3»; con todas terminadas → «final»
    var rs = tourRounds, hechas = rs.filter(function (r) { return r.finished; });
    if (rs.length && hechas.length === rs.length) return "Clasificación final";
    if (!hechas.length) return "Clasificación provisional";
    return "Clasificación provisional después de la ronda " + numRonda(hechas[hechas.length - 1]);
  }
  // Lichess da la clasificación al momento: si hay una ronda en juego, ya cuenta las partidas de esa ronda que han terminado
  function standNota() {
    var enJuego = tourRounds.filter(function (r) { return r.ongoing && !r.finished; })[0];
    return enJuego ? '<p class="lv-ffoot">Incluye las partidas de la ronda ' + numRonda(enJuego) + " que ya han terminado.</p>" : "";
  }
  function es2(n) { return U.ronda(n); }
  // PGN de cada ronda: las ya terminadas no cambian, así que se guardan y se precargan en segundo plano
  var rcache = {};
  function roundTxt(r, n) {
    if (rcache[r.id] != null) return Promise.resolve(rcache[r.id]);
    return fetch("https://lichess.org/api/broadcast/round/" + encodeURIComponent(r.id) + ".pgn").then(function (x) {
      if (x.status === 429 && n < 4) return new Promise(function (ok) { setTimeout(ok, 1500 * (n + 1)); }).then(function () { return roundTxt(r, n + 1); });
      return x.ok ? x.text().then(function (t) { if (r.finished) rcache[r.id] = t; return t; }) : "";
    }).catch(function () { return ""; });
  }
  function prefetchRounds() {
    var c = Promise.resolve();
    // Una a una y con pausa entre ellas, para no agotar el límite de peticiones de Lichess (la ronda que se está viendo va primero)
    var pausa = function () { return new Promise(function (ok) { setTimeout(ok, 1500); }); };
    tourRounds.filter(function (r) { return r.finished && r.id !== roundId; }).forEach(function (r) { c = c.then(function () { return rcache[r.id] != null ? null : roundTxt(r, 0).then(pausa); }); });
  }
  function onTour(j) {
    tourId = j.tour && j.tour.id;
    if (!tourId) return;
    loadFeds();
    fetch("https://lichess.org/api/broadcast/" + encodeURIComponent(tourId)).then(function (r) { return r.json(); }).then(function (t) {
      var rs = U.rondas(t.rounds), s = $("viewer-round"); tourRounds = rs; setTimeout(prefetchRounds, 4000);
      if (!rs.length) { s.hidden = true; return; }
      var cur = rs.filter(function (r) { return r.id === roundId; })[0];
      if (cur && cur.finished && !roundDone) { // ronda sin cerrar en Lichess pero ya superada: sus partidas no están en juego
        roundDone = true;
        Object.keys(games).forEach(function (k) { games[k].over = true; });
        if (order.length) refresh();
      }
      s.innerHTML = rs.map(function (r) {
        var st = r.finished ? "terminada" : r.ongoing ? "en juego" : "pendiente";
        return '<option value="' + esc(r.id) + '">' + esc(es2(r.name)) + " · " + st + "</option>";
      }).join("");
      s.value = roundId;
    }).catch(function () { $("viewer-round").hidden = true; });
  }
  $("viewer-round").addEventListener("change", function () {
    var v = this.value; if (!v || v === roundId) return;
    var t = $("viewer-title").textContent;
    try { history.pushState(null, "", "?r=" + encodeURIComponent(v) + "&t=" + encodeURIComponent(t)); } catch (_) { location.search = "?r=" + encodeURIComponent(v) + "&t=" + encodeURIComponent(t); return; }
    window.apejupoOpenRound(v, t, true); // sin recargar la página: se reutilizan la lista de rondas y los resultados ya descargados
  });
  window.addEventListener("popstate", function () { location.reload(); });
  function openPanel(title, html, wide) {
    fbd.hidden = false; fbox.hidden = false; fbox.classList.toggle("wide", !!wide);
    fbox.innerHTML = '<div class="lv-fhead"><span>' + esc(title) + '</span><button type="button" class="btn-ghost" id="lv-fclose">Cerrar</button></div>' + html;
    $("lv-fclose").addEventListener("click", closeFide);
    fbox.scrollTop = 0;
  }
  function fmtPts(x) { var f = Math.floor(x), h = x - f > 0; return h ? (f ? f : "") + "½" : String(f); }
  $("viewer-stand").addEventListener("click", function () {
    if (!tourId) return;
    openPanel(standTitle(), '<p class="muted" style="padding:16px">Cargando clasificación…</p>', true);
    tournamentPlayers(tourId).then(function (ps) {
      if (ps.some(function (p) { return p.score != null; })) return ps;
      // Lichess no da los puntos de este torneo: se suman a partir de los resultados de las partidas terminadas
      var done = tourRounds.filter(function (r) { return r.finished || r.ongoing; });
      var k = 0;
      var chain = Promise.resolve([]);
      done.forEach(function (r) {
        chain = chain.then(function (acc) {
          return roundTxt(r, 0).then(function (t) {
            acc.push(t); k++;
            var el = fbox.querySelector("p.muted"); if (el) el.textContent = "Cargando clasificación… (" + k + "/" + done.length + ")";
            return acc;
          });
        });
      });
      return chain.then(function (txts) {
        var pts = {};
        txts.join("\n\n").split(/\n\s*\n(?=\[Event )/).forEach(function (g) {
          var w = /\[White "([^"]*)"\]/.exec(g), b = /\[Black "([^"]*)"\]/.exec(g), res = /\[Result "([^"]*)"\]/.exec(g);
          if (!w || !b || !res) return;
          var a = ({ "1-0": [1, 0], "0-1": [0, 1], "1/2-1/2": [0.5, 0.5] })[res[1]]; if (!a) return;
          pts[w[1]] = (pts[w[1]] || 0) + a[0]; pts[b[1]] = (pts[b[1]] || 0) + a[1];
        });
        ps.forEach(function (p) { p.score = pts[p.name] || 0; });
        ps.sort(function (a, b) { return b.score - a.score || (b.rating || 0) - (a.rating || 0); });
        ps.forEach(function (p, i) { p.rank = i + 1; });
        ps.calc = true;
        return ps;
      });
    }).then(function (ps) {
      if (fbox.hidden) return;
      ps.sort(function (a, b) { return (a.rank || 999) - (b.rank || 999); });
      var h = '<table class="lv-ptab stand"><colgroup><col class="c-n"><col class="c-p"><col class="c-f"><col class="c-e"><col class="c-s"><col class="c-g"><col class="c-r"></colgroup><tr><th>#</th><th class="l">Jugador</th><th>País</th><th>ELO</th><th>Pts</th><th>Part.</th><th>Perf.</th></tr>';
      ps.forEach(function (p, i) {
        h += "<tr><td>" + (p.rank || i + 1) + '</td><td class="l">' + (p.title ? '<em class="ttl">' + esc(p.title) + "</em> " : "") + esc(p.name) + '</td><td class="fd">' + (p.fed ? flag(p.fed) + esc(p.fed) : "—") +
          "</td><td>" + (p.rating || "—") + "</td><td><b>" + fmtPts(p.score || 0) + "</b></td><td>" + (p.played || 0) + "</td><td>" +
          ((p.performances && p.performances.standard) || "—") + "</td></tr>";
      });
      openPanel(standTitle(), h + "</table>" + standNota() + (ps.calc ? '<p class="lv-ffoot">Puntos calculados con las partidas retransmitidas en Lichess; si el torneo tiene más tableros, pueden faltar puntos.</p>' : ""), true);
    }).catch(function () { openPanel(standTitle(), '<p class="muted" style="padding:16px">Lichess no ha podido proporcionar la clasificación. Vuelve a intentarlo en unos instantes o <a target="_blank" rel="noopener" href="https://lichess.org/broadcast/' + encodeURIComponent(tourId) + '/players">consulta los jugadores en Lichess</a>.</p>'); });
  });
  $("viewer-pair").addEventListener("click", function () {
    var h = '<table class="lv-ptab pairs"><tr><th>Tab.</th><th class="l">Blancas</th><th></th><th class="l">Negras</th></tr>';
    order.forEach(function (id) {
      var g = games[id]; if (!g) return;
      var t = g.tags, bd = /\.(\d+)$/.exec(t.Round || ""), res = g.over ? ({ "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½" }[t.Result] || "–") : '<span class="liveDot" title="En juego"></span>';
      function pl(ti, nm, el) { return (ti ? '<em class="ttl">' + esc(ti) + "</em> " : "") + esc(nm) + (el ? ' <small>' + esc(el) + "</small>" : ""); }
      h += '<tr data-g="' + esc(id) + '"><td>' + (bd ? bd[1] : "") + '</td><td class="l">' + nameFlag(g, "w") + pl(t.WhiteTitle, t.White, t.WhiteElo) + '</td><td class="rs">' + res + '</td><td class="l">' + nameFlag(g, "b") + pl(t.BlackTitle, t.Black, t.BlackElo) + "</td></tr>";
    });
    openPanel("Emparejamientos · " + $("viewer-title").textContent, h + '</table><p class="lv-ffoot">Pulsa una partida para abrirla.</p>', true);
  });
  fbox.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-g]"); if (!tr || !fbox.classList.contains("wide")) return;
    var id = tr.getAttribute("data-g"); closeFide(); openBig(id);
  });

  // Aviso cuando termina una partida
  var soundOn = true;
  try { soundOn = localStorage.getItem("apejupoSound") !== "0"; } catch (_) {}
  var BELL_ON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>';
  var BELL_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 9-5.2M18 8c0 4 1 6.5 2 8M3 17s3-2 3-9M10 21a2 2 0 0 0 4 0M3 3l18 18"/></svg>';
  function applyBell() { var b = $("viewer-bell"); b.innerHTML = soundOn ? BELL_ON : BELL_OFF; b.title = soundOn ? "Sonido de aviso al terminar una partida: activado" : "Sonido de aviso al terminar una partida: desactivado"; }
  $("viewer-bell").addEventListener("click", function () {
    soundOn = !soundOn; try { localStorage.setItem("apejupoSound", soundOn ? "1" : "0"); } catch (_) {}
    applyBell(); if (soundOn) beep();
  });
  applyBell();
  var actx = null;
  function beep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * .18;
        o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.18, t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + .28);
        o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + .3);
      });
    } catch (_) {}
  }
  var toastT = null;
  function toast(msg) {
    var t = $("lv-toast"); t.innerHTML = msg; t.hidden = false; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); t.hidden = true; }, 7000);
  }
  function notifyEnd(ids) {
    var shown = sortedIds(), hit = ids.filter(function (id) { return shown.indexOf(id) >= 0; });
    if (!hit.length) return;
    hit.forEach(function (id) {
      var el = $("lv-grid").querySelector('[data-g="' + id + '"]');
      if (el) { el.classList.add("fin"); setTimeout(function () { el.classList.remove("fin"); }, 8000); }
    });
    var msgs = hit.map(function (id) {
      var g = games[id], r = { "1-0": "1-0", "0-1": "0-1", "1/2-1/2": "½-½" }[g.tags.Result] || g.tags.Result;
      return "<b>" + esc(g.tags.White) + "</b> " + esc(r) + " <b>" + esc(g.tags.Black) + "</b>";
    });
    toast("Partida terminada: " + msgs.join(" · "));
    if (soundOn) beep();
  }

  // Aviso por voz cuando una partida de las miniaturas da un giro: ventaja clara (>= 1), decisiva (>= 3) o mate forzado
  var voiceOn = true, vlvl = {}, hasTTS = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  try { voiceOn = localStorage.getItem("apejupoVoice") !== "0"; } catch (_) {}
  var SPK_ON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  var SPK_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/></svg>';
  function applyVoice() {
    var b = $("viewer-voice"); if (!hasTTS) { b.hidden = true; return; }
    b.innerHTML = voiceOn ? SPK_ON : SPK_OFF;
    b.title = (voiceOn ? "Avisos por voz: activados" : "Avisos por voz: desactivados") + " (pulsa para ajustar)";
  }
  var voiceFront = false, voiceVol = 100;
  try { voiceFront = localStorage.getItem("apejupoVoiceFront") === "1"; var vv = localStorage.getItem("apejupoVoiceVol"); if (vv !== null && !isNaN(+vv)) voiceVol = Math.max(0, Math.min(100, +vv)); } catch (_) {}
  function saveVoice() { try { localStorage.setItem("apejupoVoice", voiceOn ? "1" : "0"); localStorage.setItem("apejupoVoiceFront", voiceFront ? "1" : "0"); localStorage.setItem("apejupoVoiceVol", String(voiceVol)); } catch (_) {} }
  var vpop = $("lv-vpop");
  $("vp-on").checked = voiceOn; $("vp-front").checked = voiceFront; $("vp-vol").value = voiceVol; $("vp-volv").textContent = voiceVol + " %";
  $("viewer-voice").addEventListener("click", function (e) { e.stopPropagation(); vpop.hidden = !vpop.hidden; });
  vpop.addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", function () { vpop.hidden = true; });
  $("vp-on").addEventListener("change", function () { voiceOn = this.checked; saveVoice(); applyVoice(); if (!voiceOn && hasTTS) speechSynthesis.cancel(); });
  $("vp-front").addEventListener("change", function () { voiceFront = this.checked; saveVoice(); });
  $("vp-vol").addEventListener("input", function () { voiceVol = +this.value; $("vp-volv").textContent = voiceVol + " %"; saveVoice(); });
  $("vp-test").addEventListener("click", function () { var o = voiceOn; voiceOn = true; say("Prueba de volumen. Las blancas tienen ventaja clara."); voiceOn = o; });
  applyVoice();
  function say(txt) {
    if (!hasTTS) return;
    try {
      if (speechSynthesis.pending) speechSynthesis.cancel(); // si hay cola acumulada, solo importa lo último
      var u = new SpeechSynthesisUtterance(txt); u.lang = "es-ES"; u.volume = voiceVol / 100; u.rate = 1;
      var vs = speechSynthesis.getVoices().filter(function (v) { return /^es/i.test(v.lang); });
      if (vs.length) u.voice = vs.filter(function (v) { return /^es-ES/i.test(v.lang); })[0] || vs[0];
      speechSynthesis.speak(u);
    } catch (_) {}
  }
  function spokenName(n) { var m = /^([^,]+),\s*(.+)$/.exec(n || ""); return m ? m[2] + " " + m[1] : (n || ""); }
  var LV_TXT = ["", "ventaja clara", "ventaja decisiva", "mate forzado"];
  function voiceCheck(id, sc) {
    var g = games[id]; if (!g || g.over || !sc) return;
    var a = sc.mate ? 3 : Math.abs(sc.v) >= 300 ? 2 : Math.abs(sc.v) >= 100 ? 1 : 0, side = sc.v > 0 ? 1 : -1, prev = vlvl[id];
    var cur = prev ? prev.l : 0, cs = prev ? prev.s : side;
    // histéresis: se sale de un nivel solo cuando la valoración baja claramente, para no repetir avisos por oscilaciones
    if (!sc.mate && cur > 0 && a < cur && cs === side) {
      var lowOK = cs === side ? (Math.abs(sc.v) < (cur === 2 ? 220 : 60)) : true;
      if (cur === 3) lowOK = true;
      if (!lowOK) a = cur;
    }
    var newLvl = a === 0 ? 0 : a, newSide = a === 0 ? cs : side;
    var announce = prev && newLvl > 0 && ((newSide !== cs && newLvl > 0) || newLvl > cur);
    vlvl[id] = { l: newLvl, s: newSide };
    if (!announce || !voiceOn) return;
    if (voiceFront) openBig(id);
    var who = newSide > 0 ? "Las blancas" : "Las negras";
    say("Partida " + spokenName(g.tags.White) + " contra " + spokenName(g.tags.Black) + ". " + who + (newLvl === 3 ? " tienen " : " tienen ") + LV_TXT[newLvl] + ".");
  }

  // Combo con las partidas en juego que no tienen miniatura
  var more = $("viewer-more");
  function fillMore() {
    var shown = sortedIds(), key = [];
    var rest = order.filter(function (id) { return shown.indexOf(id) < 0 && games[id]; });
    rest.forEach(function (id) { key.push(id + optLabel(games[id])); });
    key = key.join("|");
    if (more.getAttribute("data-k") === key) return;
    more.setAttribute("data-k", key);
    var keep = more.value;
    more.innerHTML = rest.length
      ? rest.map(function (id) { return '<option value="' + esc(id) + '">' + esc(optLabel(games[id])) + "</option>"; }).join("")
      : "<option value=\"\">No hay más partidas</option>";
    if (keep && rest.indexOf(keep) >= 0) more.value = keep;
    $("viewer-add").disabled = !rest.length;
    more.disabled = !rest.length;
  }
  $("viewer-add").addEventListener("click", function () {
    if (!more.value) return;
    var add = more.value; removed = removed.filter(function (x) { return x !== add; }); try { localStorage.setItem("apejupoDel" + roundId, JSON.stringify(removed)); } catch (_) {}
    extras.push(add); try { localStorage.setItem("apejupoExtra" + roundId, JSON.stringify(extras)); } catch (_) {}
    more.removeAttribute("data-k"); renderGrid(); fillMore();
  });
  // Abre una ronda (la página torneo.html la recibe por la dirección: ?r=id&t=título)
  var qs = new URLSearchParams(location.search), rid = qs.get("r");
  function openRound(rid, title, inPlace) {
    reviewStop(); reviewState = null; rvVer++; listKey = "";
    if (inPlace) { stop(); if (!viewer.hidden) closeBig(); curId = ""; ply = -1; order = []; $("lv-grid").innerHTML = ""; }
    roundId = rid; roundDone = false; games = {}; evalCache = {}; order = []; userOrder = loadUserOrder(); try { extras = JSON.parse(localStorage.getItem("apejupoExtra" + rid)) || []; } catch (_) { extras = []; } try { removed = JSON.parse(localStorage.getItem("apejupoDel" + rid)) || []; } catch (_) { removed = []; } miniStop(); setMode("open");
    $("viewer-title").textContent = title || "Torneo";
    document.title = ($("viewer-title").textContent) + " · Apejupo Chess Club";
    fetch("https://lichess.org/api/broadcast/-/-/" + rid).then(function (r) { return r.json(); }).then(function (j) {
      if (!inPlace) onTour(j); else if ($("viewer-round").value !== roundId) $("viewer-round").value = roundId;
      var i = (j.tour && j.tour.info) || {}, r = j.round || {};
      if (rid === roundId && r.finished && !roundDone) { // la primera carga pudo llegar antes que este dato
        roundDone = true;
        Object.keys(games).forEach(function (k) { games[k].over = true; });
        if (order.length) refresh();
      }
      function es(x) {
        return (x || "")
          .replace(/(\d+)[- ]players?\b/gi, "$1 jugadores")
          .replace(/(\d+)[- ]rounds?\s+(Swiss|Round[- ]Robin|Knockout)/i, function (_, n, k) { return ({ swiss: "Swiss", "round-robin": "Round-Robin", "round robin": "Round-Robin", knockout: "Knockout" })[k.toLowerCase()] + " a " + n + " rondas"; })
          .replace(/\b(Swiss|Round[- ]Robin|Knockout)\s+(\d+)\s*rounds?\b/i, "$1 a $2 rondas")
          .replace(/\bDouble Round[- ]Robin\b/i, "Double Round-Robin").replace(/\bRound[- ]Robin\b/i, "Round-Robin").replace(/\bSwiss\b/i, "Swiss").replace(/\bKnockout\b/i, "Knockout")
          .replace(/\bmin(utes?)?\b/gi, "min").replace(/\bsec(onds?)?\b/gi, "s").replace(/\/\s*move\b/i, "por jugada").replace(/\bper move\b/i, "por jugada")
          .replace(/\bmoves\b/gi, "jugadas").replace(/\bhours?\b/gi, "h").replace(/\bplus\b/gi, "+");
      }
      var dt = (j.tour && j.tour.dates) || [], dtxt = "";
      if (dt[0]) {
        var z = i.timeZone || undefined, d1 = new Date(dt[0]), d2 = dt[1] ? new Date(dt[1]) : null;
        function dd(d, o) { try { return d.toLocaleDateString("es-ES", Object.assign({ timeZone: z }, o)); } catch (_) { return d.toLocaleDateString("es-ES", o); } }
        var same = d2 && dd(d1, { day: "numeric", month: "numeric", year: "numeric" }) === dd(d2, { day: "numeric", month: "numeric", year: "numeric" });
        dtxt = !d2 || same ? dd(d1, { day: "numeric", month: "short", year: "numeric" })
          : "del " + dd(d1, { day: "numeric", month: "short" }) + " al " + dd(d2, { day: "numeric", month: "short", year: "numeric" });
      }
      var np = (/(\d+)[- ]players?\b/i.exec(i.format || "") || [])[1];
      var bits = [U.ronda(r.name), i.location, dtxt, es((i.format || "").replace(/\s*\d+[- ]players?\b\s*/i, " ").trim()), U.ritmo(i.tc)].filter(Boolean);
      $("viewer-info").textContent = bits.join(" · ");
      var npEl = $("viewer-np"); npEl.textContent = np ? np + " jugadores" : "";
      var tid = j.tour && j.tour.id; // jugadores, Elo medio y países salen de la lista de participantes
      if (tid) tournamentPlayers(tid).then(function (ps) {
        if (!ps.length || rid !== roundId) return;
        var rs = ps.map(function (p) { return p.rating; }).filter(function (v) { return v > 0; }), fs = {};
        ps.forEach(function (p) { if (p.fed) fs[p.fed] = 1; });
        var nf = Object.keys(fs).length, parts = [ps.length + " jugadores"];
        if (rs.length) parts.push("ELO medio " + Math.round(rs.reduce(function (a, v) { return a + v; }, 0) / rs.length));
        if (nf) parts.push(nf + (nf === 1 ? " país" : " países"));
        npEl.textContent = parts.join(" - ");
      }).catch(function () {});
    }).catch(function () {});
    sel.innerHTML = "<option>Cargando partidas…</option>";
    loadRound(true).then(function () {
      if (rid !== roundId) return;
      poll = bgInterval(function () {
        if (roundDone && poll) { poll.stop(); poll = null; return; } // ronda terminada: nada que actualizar
        loadRound(false).catch(function () {});
      }, 5000);
      tick = setInterval(function () { if (!viewer.hidden) clocks(); thumbClocks(); }, 500);
    }).catch(function () { sel.innerHTML = "<option>No se pudieron cargar las partidas</option>"; });
  }
  if (rid && /^[A-Za-z0-9]{8}$/.test(rid)) openRound(rid, qs.get("t"), false);
  else $("viewer-title").textContent = "Torneo no encontrado";
  window.apejupoOpenRound = openRound;

  } catch (err) { if (err && window.console) console.error("Visor en vivo:", err); }

  // ---------- Buscador de torneos (índice de retransmisiones de Lichess) ----------
  if ($("tsearch")) (function () {
    var inp = $("tsearch"), box = $("tsearch-res"), msg = $("tsearch-msg"), more = $("tsearch-more"), timer = null, seq = 0, q = "", page = 1;
    function statusOf(it) {
      var r = it.round || {};
      return r.ongoing ? bcCard(it, "EN DIRECTO", "live") : r.finished ? bcCard(it, "TERMINADO", "done") : bcCard(it, "PRÓXIMAMENTE", "soon");
    }
    function say(t) { msg.innerHTML = t; msg.hidden = !t; }
    function show(items, append) {
      var h = items.map(statusOf).join("");
      box.innerHTML = append ? box.innerHTML + h : h;
    }
    // Enlace de Lichess pegado: se abre exactamente ese torneo o esa ronda
    function fromLink(txt) {
      var m = /lichess\.org\/broadcast\/(.+)$/i.exec(txt.trim()); if (!m) return null;
      var seg = m[1].split(/[?#]/)[0].split("/").filter(Boolean);
      if (seg.length >= 3 && /^[A-Za-z0-9]{8}$/.test(seg[2])) return { round: seg[2] };
      if (seg.length === 2 && /^[A-Za-z0-9]{8}$/.test(seg[1])) return { tour: seg[1] };
      return null;
    }
    function viaLink(L, my) {
      say("Abriendo el enlace…");
      var url = L.round ? "https://lichess.org/api/broadcast/-/-/" + L.round : "https://lichess.org/api/broadcast/" + L.tour;
      fetch(url).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
        if (my !== seq) return;
        var it;
        if (L.round) it = { tour: j.tour, round: j.round };
        else {
          var rs = j.rounds || [], r = rs.filter(function (x) { return x.id === j.defaultRoundId; })[0] || rs[rs.length - 1];
          it = { tour: j.tour, round: r };
        }
        if (!it.round) { say("Ese torneo todavía no tiene rondas publicadas."); box.innerHTML = ""; return; }
        say(""); show([it]); more.hidden = true;
      }).catch(function () { if (my === seq) { box.innerHTML = ""; say("No se pudo abrir ese enlace. Comprueba que es de una retransmisión de Lichess."); } });
    }
    function run(next) {
      var my = ++seq, txt = inp.value.trim();
      if (!next) { page = 1; q = txt; }
      if (txt.length < 2) { box.innerHTML = ""; say(""); more.hidden = true; return; }
      var L = fromLink(txt);
      if (L) { more.hidden = true; viaLink(L, my); return; }
      say("Buscando…");
      fetch("https://lichess.org/api/broadcast/search?q=" + encodeURIComponent(q) + "&page=" + page).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
        if (my !== seq) return;
        var items = j.currentPageResults || [];
        if (!items.length && page === 1) {
          box.innerHTML = "";
          say('No he encontrado ningún torneo con «' + esc(q) + '» en Lichess. Prueba con menos palabras o con el nombre en inglés, o pega aquí el enlace del torneo. ' +
              '<a target="_blank" rel="noopener" href="https://lichess.org/broadcast?q=' + encodeURIComponent(q) + '">Buscar directamente en Lichess →</a>');
          more.hidden = true; return;
        }
        say(page === 1 ? items.length + (j.nextPage ? "+" : "") + " resultado" + (items.length === 1 && !j.nextPage ? "" : "s") : "");
        show(items, page > 1); more.hidden = !j.nextPage;
      }).catch(function () { if (my === seq) say("No se pudo buscar ahora mismo. Inténtalo de nuevo en unos segundos."); });
    }
    inp.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { run(false); }, 450); });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { clearTimeout(timer); run(false); } });
    $("tsearch-go").addEventListener("click", function () { clearTimeout(timer); run(false); });
    more.addEventListener("click", function () { page++; run(true); });
  })();

  // ---------- Lista de torneos en directo: se reúnen varias fuentes de Lichess y se quitan los repetidos ----------
  if ($("live")) (function () {
    var busy = false;
    function loading(active) {
      var indicator = $("live-loading"), btn = $("live-refresh");
      if (indicator) indicator.hidden = !active;
      $("live").setAttribute("aria-busy", String(active));
      if (btn) {
        btn.classList.toggle("spin", active); btn.disabled = active;
        btn.setAttribute("aria-busy", String(active));
      }
    }
    function getJson(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
    function getNdjson(u, onItem) {
      function line(t) {
        t = t.trim(); if (!t) return;
        var item; try { item = JSON.parse(t); } catch (_) { return; }
        onItem(item);
      }
      return fetch(u).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        if (!r.body || !r.body.getReader) return r.text().then(function (t) { t.split("\n").forEach(line); });
        var reader = r.body.getReader(), decoder = new TextDecoder(), buffer = "";
        function read() {
          return reader.read().then(function (part) {
            buffer += decoder.decode(part.value, { stream: !part.done });
            var lines = buffer.split("\n"); buffer = lines.pop(); lines.forEach(line);
            if (part.done) { line(buffer); return; }
            return read();
          });
        }
        return read();
      });
    }
    // De cada torneo (formato {tour, rounds, defaultRoundId}) se toma su ronda en juego más reciente
    function fromTour(e) {
      var rs = U.rondas(e.rounds), on = rs.filter(function (r) { return r.ongoing; });
      if (!on.length) return null;
      return { tour: e.tour, round: on[on.length - 1] };
    }
    // La lista se guarda unos minutos: si el usuario vuelve a la página (o pulsa «Ver todos» / «Torneos Live») no se busca otra vez en Lichess.
    // El botón de refrescar sí fuerza una búsqueda nueva.
    var CK = "apejupoLiveList3", TTL = 5 * 60 * 1000;
    function readCache() { try { var c = JSON.parse(localStorage.getItem(CK)); if (c && Array.isArray(c.live) && Date.now() - c.t < TTL) return c; } catch (_) {} return null; }
    // Orden por cercanía de emisión: primero lo que ya se emite (la ronda empezada más recientemente arriba) y después lo que está por empezar, de lo más próximo a lo más lejano.
    function byNearest(a, b) {
      var ao = a.round.ongoing ? 1 : 0, bo = b.round.ongoing ? 1 : 0;
      if (ao !== bo) return bo - ao;
      var as = a.round.startsAt || 0, bs = b.round.startsAt || 0;
      return ao ? bs - as : as - bs;
    }
    // Orden manual: el usuario puede arrastrar las tarjetas (U.sortable); ese orden se respeta al pintar (U.applyOrder)
    var OK = "apejupoLiveOrder";
    function cardHtml(x) {
      return x.round.ongoing ? bcCard(x, "EN DIRECTO", "live") : bcCard(x, (x.round.startsAt || 0) - Date.now() < 864e5 ? "HOY" : "PRÓXIMAMENTE", "soon", true);
    }
    function count(n) { window.apejupoLiveN = n; window.apejupoCount && window.apejupoCount(); }
    function paint(live, up) {
      live.sort(byNearest); // también reordena la lista guardada en caché
      // Los que se están jugando van siempre delante de los que no han empezado; el orden manual (arrastrar)
      // solo cambia el sitio dentro de cada grupo, nunca pasa uno que no ha empezado por delante de uno en directo.
      var idDe = function (x) { return x.tour.id; };
      var enJuego = U.applyOrder(live.filter(function (x) { return x.round.ongoing; }), OK, idDe);
      var resto = U.applyOrder(live.filter(function (x) { return !x.round.ongoing; }), OK, idDe);
      live.length = 0; Array.prototype.push.apply(live, enJuego.concat(resto));
      $("live").innerHTML = live.length
        ? live.map(cardHtml).join("")
        : '<p class="muted">Ahora mismo no hay torneos en directo.</p>';
      $("live").setAttribute("aria-busy", "false");
      count(live.length);
      if (up) {
        $("upcoming").innerHTML = up.length
          ? up.map(function (x) { return bcCard(x, "PRÓXIMAMENTE", "soon"); }).join("")
          : '<p class="muted">No hay retransmisiones programadas.</p>';
      }
    }
    function load(force) {
      if (busy) return;
      var cached = force ? null : readCache();
      if (cached) { loading(false); paint(cached.live, cached.up); return; }
      busy = true;
      loading(true);
      $("live").innerHTML = "";
      count(0);
      if ($("live-count")) $("live-count").textContent = "En directo";
      var seenT = {}, seenR = {}, live = [], top = null, ok = 0, pending = [], renderTimer = null;
      // Añadir por lotes pequeños conserva las tarjetas y sus imágenes mientras sigue llegando la respuesta.
      function renderPending() {
        renderTimer = null;
        // mientras cargan, también: uno en directo entra delante del primero que aún no ha empezado
        var box = $("live");
        pending.forEach(function (x) {
          var noEmpezado = x.round.ongoing ? Array.prototype.find.call(box.children, function (c) { return c.querySelector(".badge.soon"); }) : null;
          if (noEmpezado) noEmpezado.insertAdjacentHTML("beforebegin", cardHtml(x)); else box.insertAdjacentHTML("beforeend", cardHtml(x));
        });
        pending = []; count(live.length);
      }
      function add(it) {
        if (!it || !it.tour || !it.round || !it.round.id) return;
        // En «Torneos Live» solo lo que se juega ya o empieza en las próximas 24 h (el resto va a «Próximos Torneos»)
        if (it.round.ongoing && !U.enJuego(it.round)) return; // ronda olvidada sin cerrar en Lichess: no está en directo
        if (!it.round.ongoing && (it.round.finished || !it.round.startsAt || it.round.startsAt - Date.now() >= 864e5)) return;
        if (seenT[it.tour.id] || seenR[it.round.id]) return; // ni un torneo ni una ronda se repiten
        seenT[it.tour.id] = seenR[it.round.id] = true; live.push(it); pending.push(it);
        if (renderTimer === null) renderTimer = setTimeout(renderPending, 60);
      }
      function addTour(e) { add(fromTour(e)); }
      Promise.all([
        getNdjson("https://lichess.org/api/broadcast?live=true&nb=500", addTour).then(function () { ok++; }).catch(function () {}),
        getJson("https://lichess.org/api/broadcast/top").then(function (j) { ok++; top = j; (j.active || []).forEach(function (x) { add(x); }); /* todos los activos de Lichess */ }).catch(function () {}),
        getNdjson("https://lichess.org/api/broadcast?nb=100", addTour).then(function () { ok++; }).catch(function () {})
      ]).then(function () {
        clearTimeout(renderTimer); pending = [];
        if (!ok && !live.length) throw new Error("sin datos");
        live.sort(byNearest);
        var up = null;
        if (top) {
          up = (top.upcoming || []).filter(function (x) { return !seenT[x.tour && x.tour.id]; }).slice(0, 6);
        }
        paint(live, up);
        try { localStorage.setItem(CK, JSON.stringify({ t: Date.now(), live: live, up: up })); } catch (_) {}
      }).catch(function () {
        $("live").innerHTML = '<p class="muted">No se pudieron cargar las retransmisiones. <a target="_blank" rel="noopener" href="https://lichess.org/broadcast">Verlas en Lichess</a>.</p>';
      }).then(function () {
        busy = false;
        loading(false);
      });
    }
    if ($("live-refresh")) $("live-refresh").addEventListener("click", function () { load(true); });
    U.sortable($("live"), function () { return OK; }, function () { var c = readCache(); if (c) paint(c.live, null); else load(true); });
    load();
  })();

  // ---------- Otras fuentes (Chess.com...) a través del Worker de Cloudflare: solo tarjetas con enlace externo ----------
  if ($("live")) (function () {
    window.apejupoCount = function () {
      var c = $("live-count"), a = window.apejupoLiveN || 0, o = window.apejupoOtrasN || 0;
      if (c) c.textContent = a + o ? (a + o) + " Torneos en directo" : "En directo";
    };
    var EVENTS_URL = "https://apejupo-eventos.chessrival-worker.workers.dev"; // Worker de Cloudflare (Chess.com)
    try { var q = /[?&]eventos=([^&]+)/.exec(location.search); if (q && /^(https:\/\/|\/|worker\/)/.test(decodeURIComponent(q[1]))) EVENTS_URL = decodeURIComponent(q[1]); } catch (_) {}
    if (!EVENTS_URL) return;
    var box = document.createElement("div"); box.id = "otras"; box.className = "cards"; box.setAttribute("aria-live", "polite");
    $("live").parentNode.insertBefore(box, $("live").nextSibling);
    function card(e) {
      var when = fmt(e.start, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return '<article class="card"><div class="body"><span class="badge ' + (e.status === "live" ? "live" : "soon") + '">' + (e.status === "live" ? "EN DIRECTO" : "PRÓXIMAMENTE") + '</span>' +
        '<h4>' + esc(e.title) + '</h4><p class="meta">' + esc(e.source) + " · " + esc(when) + '</p>' +
        '<a class="more btn-view" target="_blank" rel="noopener" href="https://www.chess.com/es/events/current">Ver en Chess.com →</a>' +
        '<a class="more" target="_blank" rel="noopener" href="' + esc(safeUrl(e.url)) + '">Ver la retransmisión en ' + esc(e.via === "twitch" ? "Twitch" : e.via === "youtube" ? "YouTube" : e.source) + ' →</a></div></article>';
    }
    var OK = "apejupoOtras", OTTL = 5 * 60 * 1000;
    function paintO(list) { box.innerHTML = list.map(card).join(""); window.apejupoOtrasN = list.length; window.apejupoCount(); }
    function load(force) {
      if (!force) { try { var c = JSON.parse(localStorage.getItem(OK)); if (c && Array.isArray(c.live) && Date.now() - c.t < OTTL) { paintO(c.live); return; } } catch (_) {} }
      fetch(EVENTS_URL).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
        var l = j.live || [];
        paintO(l);
        try { localStorage.setItem(OK, JSON.stringify({ t: Date.now(), live: l })); } catch (_) {}
      }).catch(function () { box.innerHTML = ""; });
    }
    load();
    if ($("live-refresh")) $("live-refresh").addEventListener("click", function () { setTimeout(function () { load(true); }, 1500); });
  })();

  // ---------- Streams (Twitch y YouTube) ----------
  // Primero lo que de verdad se emite: el calendario de Chess.com (a través del Worker) dice qué hay en directo y qué viene.
  // Si hay una emisión en directo en Twitch o YouTube se abre sola; si no, se avisa de las próximas en lugar de un reproductor apagado.
  // Los canales fijos (js/data.js) quedan como pestañas para quien quiera abrirlos igualmente.
  var tabs = $("stream-tabs"), sframe = $("stream-frame");
  if (!tabs) return;
  var EV_URL = "https://apejupo-eventos.chessrival-worker.workers.dev";
  try { var qe = /[?&]eventos=([^&]+)/.exec(location.search); if (qe && /^(https:\/\/|\/|worker\/)/.test(decodeURIComponent(qe[1]))) EV_URL = decodeURIComponent(qe[1]); } catch (_) {} // para pruebas, como más arriba
  var fijos = (D.streams || []).slice(), eventos = [], proximos = [], sel = -1, elegida = null; // elegida: próxima emisión abierta con «Ver aquí»
  // Retransmisión de un evento: canal de Twitch o vídeo de YouTube sacado de su enlace
  function deEvento(e) {
    var m = /twitch\.tv\/([A-Za-z0-9_]+)/.exec(e.url || "");
    if (m) return { type: "twitch", channel: m[1], ev: e };
    m = /youtube\.com\/watch\?v=([\w-]{6,})/.exec(e.url || "");
    if (m) return { type: "youtube", videoId: m[1], ev: e };
    return null; // otras plataformas (Kick…) no se pueden incrustar
  }
  function cuando(ms) {
    var d = new Date(ms), hoy = new Date(), man = new Date(); man.setDate(hoy.getDate() + 1);
    var h = fmt(ms, { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === hoy.toDateString()) return "hoy a las " + h;
    if (d.toDateString() === man.toDateString()) return "mañana a las " + h;
    return fmt(ms, { weekday: "long", day: "numeric", month: "short" }) + " a las " + h;
  }
  function plataforma(e) {
    var m = /twitch\.tv\/([A-Za-z0-9_]+)/.exec(e.url || "");
    return m ? "Twitch (" + m[1] + ")" : e.via === "youtube" ? "YouTube" : e.via === "kick" ? "Kick" : e.source;
  }
  function todos() { return eventos.concat(elegida ? [elegida] : [], fijos); }
  function pintaTabs() {
    // «Próximas emisiones» (si las hay) siempre como primera pestaña, para poder volver a la lista
    tabs.innerHTML = (proximos.length ? '<button type="button" role="tab" data-i="-1" aria-selected="' + (sel === -1) + '">Próximas emisiones</button>' : "") +
      todos().map(function (s, i) {
        var et = !s.ev ? esc(s.label)
          : s.prox ? esc(fmt(s.ev.start, { hour: "2-digit", minute: "2-digit" })) + " · " + esc(s.ev.title)
          : '<span class="dot" aria-hidden="true"></span>EN DIRECTO · ' + esc(s.ev.title);
        return '<button type="button" role="tab" data-i="' + i + '" aria-selected="' + (i === sel) + '"' + (s.ev && !s.prox ? ' class="tab-live"' : "") + ">" + et + "</button>";
      }).join("");
  }
  function verPanel(on) { $("stream-off").hidden = !on; $("stream-box").hidden = on; $("stream-note").hidden = on; }
  // Sin nada en directo: aviso con las próximas emisiones
  function sinDirecto() {
    sel = -1; pintaTabs(); sframe.removeAttribute("src"); verPanel(true);
    var av = $("stream-box").querySelector(".terceros"); if (av) av.remove();
    $("stream-info").hidden = true;
    $("stream-off").innerHTML = (eventos.length ? "" : '<p class="so-h">Ahora mismo no hay ninguna retransmisión con comentaristas en directo.</p>') +
      (proximos.length ? '<p class="so-sub">Próximas emisiones</p><div class="cards so-cards">' + proximos.map(tarjetaProxima).join("") + "</div>" : "") +
      '<p class="so-pie">También puedes abrir uno de los canales de arriba, aunque es posible que no esté emitiendo.</p>';
  }
  // «Hoy, martes 10 nov» / «Mañana, miércoles 11 nov» / «jueves 12 nov»
  function fecha(ms) {
    var d = new Date(ms), hoy = new Date(), man = new Date(); man.setDate(hoy.getDate() + 1);
    var f = fmt(ms, { weekday: "long", day: "numeric", month: "short" }).replace(/^(\S+),/, "$1"); // «martes 10 nov», sin coma
    if (d.toDateString() === hoy.toDateString()) return "Hoy, " + f;
    if (d.toDateString() === man.toDateString()) return "Mañana, " + f;
    return f.charAt(0).toUpperCase() + f.slice(1);
  }
  // Tarjeta de una próxima emisión: franja con el color y el canal de la plataforma, etiqueta, nombre, hora y botón
  function tarjetaProxima(e) {
    var m = /twitch\.tv\/([A-Za-z0-9_]+)/.exec(e.url || ""), via = m ? "twitch" : e.via === "youtube" ? "youtube" : e.via === "kick" ? "kick" : "otra";
    var nombre = { twitch: "Twitch", youtube: "YouTube", kick: "Kick", otra: e.source }[via];
    var hoy = new Date(e.start).toDateString() === new Date().toDateString(), k = proximos.indexOf(e);
    return '<article class="card so-card"><div class="so-band ' + via + '"><span class="so-pl">' + esc(nombre) + "</span>" +
      (m ? '<span class="so-ch">' + esc(m[1]) + "</span>" : "") + "</div>" +
      '<div class="body"><span class="badge soon">' + (hoy ? "HOY" : "PRÓXIMAMENTE") + "</span>" +
      "<h4>" + esc(e.title) + "</h4>" +
      // cuándo (día y hora) y dónde (plataforma y canal), cada cosa en su línea
      '<p class="so-dato"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>' +
      esc(fecha(e.start)) + " · <b>" + esc(fmt(e.start, { hour: "2-digit", minute: "2-digit" })) + "</b></p>" +
      '<p class="so-dato"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>' +
      esc(nombre) + (m ? " · " + esc(m[1]) : "") + " <span>(" + esc(e.source) + ")</span></p>" +
      // Twitch y YouTube se ven aquí mismo; Kick no se puede incrustar y su enlace lleva a la página de eventos de Chess.com
      (deEvento(e)
        ? '<div class="so-btns"><button type="button" class="more btn-view" data-ver="' + k + '">Ver aquí</button>' +
          '<a class="so-ext" target="_blank" rel="noopener" href="' + esc(safeUrl(e.url)) + '">Abrir en ' + esc(nombre) + "</a></div>"
        : '<a class="more btn-view" target="_blank" rel="noopener" href="' + esc(safeUrl(e.url)) + '">' + (via === "kick" ? "Ver en Chess.com" : "Abrir en " + esc(nombre)) + "</a>") +
      "</div></article>";
  }
  function pickStream(i) {
    var s = todos()[i]; if (!s) return;
    sel = i; pintaTabs(); verPanel(false);
    var url, quien;
    if (s.type === "youtube") {
      quien = "YouTube";
      url = s.videoId
        ? "https://www.youtube.com/embed/" + encodeURIComponent(s.videoId)
        : "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(s.channelId);
      $("stream-link").href = s.videoId
        ? "https://www.youtube.com/watch?v=" + encodeURIComponent(s.videoId)
        : "https://www.youtube.com/channel/" + encodeURIComponent(s.channelId) + "/live";
      $("stream-link").textContent = "Abrir en YouTube";
    } else {
      quien = "Twitch";
      url = "https://player.twitch.tv/?channel=" + encodeURIComponent(s.channel) +
        "&muted=true&autoplay=false&parent=" + encodeURIComponent(location.hostname || "localhost");
      $("stream-link").href = "https://www.twitch.tv/" + encodeURIComponent(s.channel);
      $("stream-link").textContent = "Abrir en Twitch";
    }
    // El reproductor de Twitch o YouTube puede instalar cookies: se carga cuando el visitante lo pide (o si ya lo permitió)
    sframe.removeAttribute("src");
    U.aviso($("stream-box"), { titulo: "Directo en " + quien, quien: quien, boton: "Ver el directo", icono: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/>' }, function () { if (sel === i) sframe.src = url; });
    var info = $("stream-info");
    info.hidden = !s.ev;
    if (s.ev) info.innerHTML = s.prox
      ? "<b>" + esc(s.ev.title) + "</b> · empieza " + esc(cuando(s.ev.start)) + " en " + esc(plataforma(s.ev)) +
        (s.type === "twitch" ? " · hasta entonces el canal puede aparecer desconectado" : "")
      : '<span class="dot" aria-hidden="true"></span><b>' + esc(s.ev.title) + "</b> · " + esc(s.ev.source) + " en " + esc(plataforma(s.ev));
    $("stream-note").hidden = !!s.ev; // el aviso de «sin conexión» solo tiene sentido en los canales fijos
  }
  tabs.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]"); if (!b) return;
    var i = +b.getAttribute("data-i");
    if (i < 0) sinDirecto(); else pickStream(i);
  });
  // «Ver aquí» en una próxima emisión: se abre en el reproductor de la página, con su propia pestaña
  $("stream-off").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-ver]"); if (!b) return;
    var ev = proximos[+b.getAttribute("data-ver")], s = ev && deEvento(ev); if (!s) return;
    s.prox = true; elegida = s;
    pickStream(eventos.length); // va justo detrás de las que están en directo
    $("streams").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  if (!fijos.length) $("streams").hidden = true;
  pintaTabs();
  fetch(EV_URL).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
    var visto = {};
    eventos = (j.live || []).map(deEvento).filter(function (s) {
      if (!s) return false;
      var k = s.channel || s.videoId; if (visto[k]) return false; visto[k] = 1; return true;
    });
    var vistoP = {};
    proximos = (j.upcoming || []).filter(function (e) {
      var k = e.title + "|" + e.start; if (vistoP[k]) return false; vistoP[k] = 1; return true;
    }).slice(0, 3);
    $("streams").hidden = false;
    if (eventos.length) pickStream(0); else sinDirecto();
  }).catch(function () {
    if (fijos.length) pickStream(0); // sin calendario: como antes, el primer canal fijo
  });
})();
