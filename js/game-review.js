(function () {
  "use strict";

  function value(score) { return score.mate ? (score.v > 0 ? 10000 : -10000) : score.v; }
  function evaluation(score) {
    if (score.mate) return score.v === 0 ? "Jaque mate." : "Mate en " + Math.abs(score.v) + " para las " + (score.v > 0 ? "blancas" : "negras") + ".";
    if (Math.abs(score.v) < 40) return "Posición equilibrada.";
    var advantage = Math.abs(score.v) < 100 ? "Ligera ventaja" : Math.abs(score.v) < 250 ? "Ventaja" : "Ventaja clara";
    return advantage + " de las " + (score.v > 0 ? "blancas" : "negras") + ".";
  }
  function comment(before, after, move, best, turn, terminal) {
    var delta = value(after) - value(before);
    var sameMate = before.mate && after.mate && Math.sign(before.v) === Math.sign(after.v);
    var relevant = !sameMate && Math.abs(delta) >= 50;
    if (terminal === "mate") return { label: "Jaque mate", kind: "good", text: "Termina la partida.", mark: "", relevant: true, delta: delta };
    if (terminal === "draw") return { label: "Tablas", kind: "neutral", text: "La posición es de tablas.", mark: "", relevant: relevant, delta: delta };
    if (!relevant) return { label: "", kind: "neutral", text: "", mark: "", relevant: false, delta: delta };
    var loss = -delta * (turn === "w" ? 1 : -1);
    var label = "Mejora", kind = "good", mark = "", text = evaluation(after);
    if (loss >= 200) { label = "Error grave"; kind = "bad"; mark = "??"; }
    else if (loss >= 100) { label = "Error"; kind = "bad"; mark = "?"; }
    else if (loss >= 50) { label = "Inexactitud"; kind = "warn"; mark = "?!"; }
    else if (move === best) label = "Mejor jugada";
    if (loss >= 50) text = best && move !== best ? "Mejor era " + best + "." : "La valoración empeora para las " + (turn === "w" ? "blancas" : "negras") + ".";
    return { label: label, kind: kind, text: text, mark: mark, relevant: true, delta: delta };
  }

  // Una revisión usa una instantánea de la partida, independiente de las nuevas jugadas del directo.
  function start(options) {
    var worker = null, stopped = false, timer = null, nextTimer = null, k = 0, score = null, pv = [], scores = [], bestMoves = [], entries = [];
    var fens = options.fens.slice(), san = options.san.slice();
    function stop() {
      stopped = true; clearTimeout(timer); clearTimeout(nextTimer);
      if (worker) { worker.terminate(); worker = null; }
    }
    function fail(message) { if (stopped) return; stop(); options.onError(message); }
    function timeout(ms) { clearTimeout(timer); timer = setTimeout(function () { fail("Stockfish no responde. Puedes volver a pulsar Analizar."); }, ms); }
    function notify(complete) {
      options.onProgress({
        done: Math.max(0, k - 1), total: san.length, entries: entries.slice(), complete: complete,
        checkpoint: { fens: fens.slice(0, k), scores: scores.slice(0, k), bestMoves: bestMoves.slice(0, k), entries: entries.slice() }
      });
    }
    function completePosition(result, terminal) {
      clearTimeout(timer); scores[k] = result;
      if (k > 0) {
        var detail = comment(scores[k - 1], result, san[k - 1], bestMoves[k - 1], fens[k - 1].split(" ")[1], terminal);
        entries.push({ ply: k, san: san[k - 1], label: detail.label, kind: detail.kind, text: detail.text, mark: detail.mark, relevant: detail.relevant, delta: detail.delta, score: result });
      }
      k++;
      if (k === fens.length) { stop(); notify(true); return; }
      notify(false);
      if (!stopped) nextTimer = setTimeout(next, 0);
    }
    function next() {
      if (stopped) return;
      try {
        var board = new Chess(fens[k]);
        if (board.game_over()) {
          completePosition({ mate: board.in_checkmate(), v: 0 }, board.in_checkmate() ? "mate" : "draw");
          return;
        }
        score = null; pv = []; timeout(15000);
        worker.postMessage("position fen " + fens[k]);
        worker.postMessage("go movetime 150");
      } catch (_) { fail("No se pudo analizar esta posición de la partida."); }
    }
    try {
      if (fens.length !== san.length + 1 || !san.length) throw new Error("partida sin jugadas válidas");
      // Reutilizar solo el prefijo ya evaluado y que sigue correspondiendo a esta partida.
      var previous = options.previous;
      if (previous && previous.fens && previous.scores && previous.bestMoves && previous.entries) {
        while (k < fens.length && previous.fens[k] === fens[k] && previous.scores[k]) {
          var old = previous.entries[k - 1], cached = previous.scores[k];
          if (!Number.isFinite(cached.v) || typeof cached.mate !== "boolean") break;
          if (k > 0 && (!old || old.ply !== k || old.san !== san[k - 1])) break;
          scores[k] = cached; bestMoves[k] = previous.bestMoves[k] || "";
          if (k > 0) entries.push(old);
          k++;
        }
      }
      if (k === fens.length) {
        nextTimer = setTimeout(function () { if (!stopped) { stop(); notify(true); } }, 0);
        return { stop: stop };
      }
      worker = new Worker("assets/stockfish/stockfish-19-lite-single.js");
      worker.onerror = function () { fail("No se pudo cargar Stockfish. Vuelve a intentarlo."); };
      worker.onmessage = function (event) {
        if (stopped) return;
        var line = String(event.data);
        if (line === "uciok") {
          worker.postMessage("setoption name Hash value 16");
          worker.postMessage("setoption name MultiPV value 1");
          worker.postMessage("isready");
        } else if (line === "readyok") { clearTimeout(timer); next(); }
        else if (line.indexOf("info ") === 0 && !/bound/.test(line)) {
          var match = /score (cp|mate) (-?\d+)/.exec(line), moves = / pv (.+)$/.exec(line);
          if (match) score = { mate: match[1] === "mate", v: +match[2] * (fens[k].split(" ")[1] === "w" ? 1 : -1) };
          if (moves) pv = moves[1].trim().split(/\s+/);
        } else if (line.indexOf("bestmove ") === 0) {
          if (!score) { fail("El motor no devolvió una valoración. Puedes repetir el análisis."); return; }
          var uci = pv[0] || line.split(/\s+/)[1];
          try {
            var best = new Chess(fens[k]).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
            bestMoves[k] = best ? best.san : "";
          } catch (_) { bestMoves[k] = ""; }
          completePosition(score);
        }
      };
      timeout(30000); worker.postMessage("uci");
    } catch (_) { nextTimer = setTimeout(function () { fail("No se pudo iniciar el análisis de esta partida."); }, 0); }
    return { stop: stop };
  }
  window.ApejupoGameReview = { start: start, comment: comment };
})();
