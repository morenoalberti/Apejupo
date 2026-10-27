(function () {
  var cont = document.getElementById("entrenador");
  if (!cont) return;

  var BASE = "data/tactica/";
  var NIVELES = [["Todos", 0, 9999], ["Iniciación (hasta 1200)", 0, 1200], ["Intermedio (1200-1800)", 1200, 1800], ["Avanzado (1800-2200)", 1800, 2200], ["Experto (más de 2200)", 2200, 9999]];
  var cat = null, indice = null, lista = [], cache = {};
  var temporizador = null, avance = null, inicio = 0, chess = null, p = null, paso = 0, orient = "w", sel = null, bloqueado = false, fallos = 0, pistaVista = false;
  var hechos = {}, res = {}, pistaNivel = 0;
  try { hechos = JSON.parse(localStorage.getItem("apejupo_tactica") || "{}"); } catch (e) {}
  // Resultado del primer intento de cada problema: 1 = acertado a la primera, 0 = con fallo o pista
  try { res = JSON.parse(localStorage.getItem("apejupo_tactica_res") || "{}"); } catch (e) {}
  function anota(ok) {
    if (!p || res[p.i] !== undefined) return;
    res[p.i] = ok ? 1 : 0;
    try { localStorage.setItem("apejupo_tactica_res", JSON.stringify(res)); } catch (e) {}
  }
  function porcentaje(ids) {
    var n = 0, ok = 0;
    ids.forEach(function (i) { if (res[i] !== undefined) { n++; ok += res[i]; } });
    return n ? Math.round(ok * 100 / n) + " % de acierto (" + n + (n === 1 ? " ejercicio" : " ejercicios") + ")" : "";
  }

  var el = {
    titulo: U.$("ent-titulo"), nivel: U.$("ent-nivel"), tablero: U.$("ent-tablero"), msg: U.$("ent-msg"),
    info: U.$("ent-info"), reloj: U.$("ent-reloj"), pista: U.$("ent-pista"), sig: U.$("ent-sig"), prog: U.$("ent-prog"), pct: U.$("ent-pct")
  };
  el.nivel.innerHTML = NIVELES.map(function (n, i) { return '<option value="' + i + '">' + U.esc(n[0]) + "</option>"; }).join("");

  try {
    var nv = localStorage.getItem("apejupo_nivel");
    if (nv !== null && NIVELES[+nv]) el.nivel.value = nv;
  } catch (e) {}
  function guardar() { try { localStorage.setItem("apejupo_tactica", JSON.stringify(hechos)); } catch (e) {} }
  function sq(i) { return "abcdefgh"[i % 8] + (8 - Math.floor(i / 8)); }
  function mensaje(t, clase) { el.msg.textContent = t; el.msg.className = "ent-msg " + (clase || ""); }

  function progreso() {
    if (!cat) return;
    var n = 0;
    lista.forEach(function (x) { if (hechos[x.i]) n++; });
    el.prog.textContent = n + " de " + lista.length + " resueltos en " + cat.titulo;
    var t = porcentaje(lista.map(function (x) { return x.i; })), g = porcentaje(Object.keys(res));
    el.pct.innerHTML = (t ? "<b>" + U.esc(cat.titulo) + ":</b> " + t : "Aún no tienes aciertos en este ejercicio.") + (g ? "<br><b>Total:</b> " + g : "");
  }

  function dibuja(ultima, resalta) {
    var tab = chess.board(), html = "";
    for (var f = 0; f < 8; f++) for (var c = 0; c < 8; c++) {
      var r = orient === "w" ? f : 7 - f, k = orient === "w" ? c : 7 - c;
      var s = sq(r * 8 + k), pz = tab[r][k];
      var cl = "sq " + ((r + k) % 2 ? "dk" : "lt");
      if (ultima && (ultima[0] === s || ultima[1] === s)) cl += " last";
      if (sel === s) cl += " sel";
      if (resalta && resalta.indexOf(s) >= 0) cl += " dest";
      if (chess.in_check() && pz && pz.type === "k" && pz.color === chess.turn()) cl += " chk";
      if (chess.in_checkmate() && pz && pz.type === "k" && pz.color === chess.turn()) cl += " mate";
      html += '<div class="' + cl + '" data-s="' + s + '">' +
        (c === 0 ? '<i class="co r">' + (8 - r) + "</i>" : "") + (f === 7 ? '<i class="co f">' + "abcdefgh"[k] + "</i>" : "") +
        (pz ? '<img src="assets/pieces/' + pz.color + pz.type.toUpperCase() + '.png" alt="" draggable="false">' : "") + "</div>";
    }
    el.tablero.innerHTML = html;
  }

  function cargaCategoria(id, cb) {
    if (cache[id]) { cb(cache[id]); return; }
    mensaje("Cargando problemas…");
    fetch(BASE + id + ".json").then(function (r) { return r.json(); }).then(function (d) { cache[id] = d; cb(d); })
      .catch(function () { mensaje("No se han podido cargar los problemas.", "mal"); });
  }

  function siguiente() {
    var n = NIVELES[+el.nivel.value];
    var cand = lista.filter(function (x) { return x.r >= n[1] && x.r < n[2]; });
    var pend = cand.filter(function (x) { return !hechos[x.i]; });
    if (!cand.length) { mensaje("No hay problemas en este nivel.", "mal"); el.tablero.innerHTML = ""; return; }
    if (!pend.length) { mensaje("¡Has resuelto todos los de este nivel! Prueba otro.", "bien"); pend = cand; }
    empieza(pend[0]);
  }

  function empieza(prob) {
    clearTimeout(avance); clearInterval(temporizador);
    p = prob; paso = 0; sel = null; fallos = 0; pistaVista = false; pistaNivel = 0; bloqueado = false;
    inicio = Date.now(); el.reloj.textContent = "0:00";
    temporizador = setInterval(function () {
      var seg = Math.floor((Date.now() - inicio) / 1000);
      el.reloj.textContent = Math.floor(seg / 60) + ":" + ("0" + (seg % 60)).slice(-2);
    }, 1000);
    chess = new Chess(p.f);
    orient = chess.turn();
    el.pista.disabled = false;
    el.info.textContent = "Dificultad " + p.r + " · Juegan " + (orient === "w" ? "blancas" : "negras");
    mensaje("Encuentra la mejor jugada.");
    el.sig.hidden = true;
    dibuja([p.l.slice(0, 2), p.l.slice(2, 4)]);
    progreso();
  }

  function juega(uci) {
    var m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    return m;
  }

  function intento(from, to) {
    var legal = chess.moves({ square: from, verbose: true }).filter(function (m) { return m.to === to; })[0];
    if (!legal) return false;
    var promo = legal.promotion ? "q" : "";
    var uci = from + to + promo, esperado = p.s[paso];
    if (promo && esperado && esperado.slice(0, 4) === from + to) uci = esperado;
    chess.move({ from: from, to: to, promotion: promo || undefined });
    var correcto = uci === esperado || chess.in_checkmate();
    if (!correcto) {
      chess.undo(); fallos++; sel = null; anota(false); progreso();
      dibuja([p.l.slice(0, 2), p.l.slice(2, 4)]);
      mensaje("Esa no es. Inténtalo de nuevo.", "mal");
      return true;
    }
    sel = null; paso++;
    if (chess.in_checkmate() || paso >= p.s.length) { termina(); dibuja([from, to]); return true; }
    var resp = p.s[paso];
    dibuja([from, to]);
    mensaje("¡Bien! Sigue…", "bien");
    bloqueado = true;
    setTimeout(function () {
      juega(resp); paso++; bloqueado = false;
      dibuja([resp.slice(0, 2), resp.slice(2, 4)]);
      mensaje("Tu turno.");
    }, 450);
    return true;
  }

  function termina() {
    bloqueado = true; clearInterval(temporizador); el.pista.disabled = true;
    if (!hechos[p.i]) { hechos[p.i] = fallos || pistaVista ? 1 : 2; guardar(); }
    anota(true);
    mensaje("¡Correcto!", "bien");
    el.sig.hidden = false;
    progreso();
    avance = setTimeout(siguiente, 2500);
  }

  // Mover piezas: arrastrando con el ratón (o el dedo) o pulsando origen y destino
  var arrastre = null;
  function ultima() { return [p.l.slice(0, 2), p.l.slice(2, 4)]; }
  function destinos(s) { return chess.moves({ square: s, verbose: true }).map(function (m) { return m.to; }); }
  function casilla(x, y) {
    var e = document.elementFromPoint(x, y);
    e = e && e.closest(".sq");
    return e && el.tablero.contains(e) ? e.getAttribute("data-s") : null;
  }
  function mueveClon(e) {
    arrastre.clon.style.left = e.clientX + "px";
    arrastre.clon.style.top = e.clientY + "px";
  }

  el.tablero.addEventListener("pointerdown", function (e) {
    if (!chess || bloqueado || e.button > 0) return;
    var d = e.target.closest(".sq"); if (!d) return;
    var s = d.getAttribute("data-s"), pz = chess.get(s);
    if (sel && sel !== s && intento(sel, s)) return;
    if (pz && pz.color === chess.turn()) {
      sel = s;
      dibuja(ultima(), destinos(s));
      var img = el.tablero.querySelector('.sq[data-s="' + s + '"] img');
      if (!img) return;
      var clon = img.cloneNode(true);
      clon.className = "ent-drag";
      clon.style.width = img.getBoundingClientRect().width + "px";
      document.body.appendChild(clon);
      img.style.opacity = ".3";
      arrastre = { from: s, clon: clon };
      mueveClon(e);
      e.preventDefault();
    } else { sel = null; dibuja(ultima()); }
  });
  document.addEventListener("pointermove", function (e) { if (arrastre) mueveClon(e); });
  function suelta(e) {
    if (!arrastre) return;
    var from = arrastre.from, to = casilla(e.clientX, e.clientY);
    arrastre.clon.remove(); arrastre = null;
    if (e.type === "pointercancel" || !to || to === from) { dibuja(ultima(), sel ? destinos(sel) : null); return; }
    if (!intento(from, to)) dibuja(ultima(), sel ? destinos(sel) : null);
  }
  document.addEventListener("pointerup", suelta);
  document.addEventListener("pointercancel", suelta);

  el.pista.addEventListener("click", function () {
    if (!p || bloqueado) return;
    pistaVista = true; pistaNivel++; anota(false); progreso();
    var m = p.s[paso];
    sel = m.slice(0, 2);
    dibuja([p.l.slice(0, 2), p.l.slice(2, 4)], pistaNivel > 1 ? [m.slice(2, 4)] : null);
    mensaje(pistaNivel > 1 ? "Pista: la pieza marcada va a la casilla señalada." : "Pista: mueve la pieza marcada.");
  });

  el.sig.addEventListener("click", function () {
    clearTimeout(avance);
    siguiente();
  });
  el.nivel.addEventListener("change", function () {
    try { localStorage.setItem("apejupo_nivel", el.nivel.value); } catch (e) {}
    siguiente();
  });

  function elige(id) {
    cat = indice.categorias.concat(indice.temas || []).filter(function (c) { return c.id === id; })[0];
    if (!cat) return;
    el.titulo.textContent = cat.titulo;
    Array.prototype.forEach.call(document.querySelectorAll("a.theme[data-id]"), function (a) {
      if (a.getAttribute("data-id") === id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    cargaCategoria(id, function (d) { lista = d; siguiente(); });
  }

  window.Entrenador = {
    abre: function (id) {
      if (!indice) { pendiente = id; return; }
      elige(id);
    }
  };
  var pendiente = null;

  fetch(BASE + "indice.json").then(function (r) { return r.json(); }).then(function (d) {
    indice = d;
    elige(pendiente || "mate1");
  }).catch(function () { mensaje("No se han podido cargar los problemas.", "mal"); });
})();
