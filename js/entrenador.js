(function () {
  var cont = document.getElementById("entrenador");
  if (!cont) return;

  var BASE = "data/tactica/";
  var NIVELES = [["Todos", 0, 9999], ["Iniciación (hasta 1200)", 0, 1200], ["Intermedio (1200-1800)", 1200, 1800], ["Avanzado (1800-2200)", 1800, 2200], ["Experto (más de 2200)", 2200, 9999]];
  var cat = null, indice = null, lista = [], cache = {};
  var temporizador = null, avance = null, inicio = 0, chess = null, p = null, paso = 0, orient = "w", sel = null, bloqueado = false, fallos = 0, pistaVista = false;
  var hechos = {}, res = {}, pistaNivel = 0, bat = null;
  try { hechos = JSON.parse(localStorage.getItem("apejupo_tactica") || "{}"); } catch (e) {}
  // Resultado del primer intento de cada problema: 1 = acertado a la primera, 0 = con fallo o pista
  try { res = JSON.parse(localStorage.getItem("apejupo_tactica_res") || "{}"); } catch (e) {}
  function anota(ok) {
    if (!p || res[p.i] !== undefined) return;
    res[p.i] = ok ? 1 : 0;
    try { localStorage.setItem("apejupo_tactica_res", JSON.stringify(res)); } catch (e) {}
  }

  var el = {
    titulo: U.$("ent-titulo"), nivel: U.$("ent-nivel"), tablero: U.$("ent-tablero"), msg: U.$("ent-msg"),
    reloj: U.$("ent-reloj"), pista: U.$("ent-pista"), sig: U.$("ent-sig"), pct: U.$("ent-pct"), sol: U.$("ent-sol"), bat: U.$("ent-bateria"), result: U.$("ent-result")
  };
  el.nivel.innerHTML = NIVELES.map(function (n, i) { return '<option value="' + i + '">' + U.esc(n[0]) + "</option>"; }).join("");

  try {
    var nv = localStorage.getItem("apejupo_nivel");
    if (nv !== null && NIVELES[+nv]) el.nivel.value = nv;
  } catch (e) {}
  function guardar() { try { localStorage.setItem("apejupo_tactica", JSON.stringify(hechos)); } catch (e) {} }
  function sq(i) { return "abcdefgh"[i % 8] + (8 - Math.floor(i / 8)); }
  function mensaje(t, clase) { el.msg.textContent = t; el.msg.className = "ent-msg " + (clase || ""); }
  // Jugada en notación con figuritas: la inicial de la pieza (K, Q, R, B, N) se cambia por su dibujo
  function figurita(san, color) {
    var img = function (l) { return '<img class="fig" src="assets/pieces/' + color + l + '.png" alt="' + l + '">'; };
    return san.replace(/^([KQRBN])/, function (m, l) { return img(l); }).replace(/=([QRBN])/, function (m, l) { return "=" + img(l); });
  }

  // Estadística minimalista del tema: aciertos a la primera / ejercicios intentados - porcentaje
  function progreso() {
    if (!cat) return;
    if (bat) { el.pct.textContent = "Batería " + Math.min(bat.res.length + 1, bat.cola.length) + "/" + bat.cola.length + " · " + (bat.res.filter(Boolean).length === 1 ? "1 acierto" : bat.res.filter(Boolean).length + " aciertos"); return; }
    var n = 0, ok = 0;
    lista.forEach(function (x) { if (res[x.i] !== undefined) { n++; ok += res[x.i]; } });
    el.pct.textContent = n ? ok + "/" + n + " · " + Math.round(ok * 100 / n) + " % acierto" : "";
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
      if (chess.in_check() && !chess.in_checkmate() && pz && pz.type === "k" && pz.color === chess.turn()) cl += " chk";
      if (chess.in_checkmate() && pz && pz.type === "k" && pz.color === chess.turn()) cl += " mate";
      html += '<div class="' + cl + '" data-s="' + s + '">' +
        (pz ? '<img src="assets/pieces/' + pz.color + pz.type.toUpperCase() + '.png" alt="" draggable="false">' : "") + "</div>";
    }
    el.tablero.innerHTML = html;
    var nums = "", letras = "";
    for (var i = 0; i < 8; i++) {
      nums += "<span>" + (orient === "w" ? 8 - i : i + 1) + "</span>";
      letras += "<span>" + "abcdefgh"[orient === "w" ? i : 7 - i] + "</span>";
    }
    U.$("ent-ranks").innerHTML = nums; U.$("ent-files").innerHTML = letras;
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
    el.pista.disabled = false; el.sol.disabled = false;
    mensaje("Juegas " + (orient === "w" ? "blancas" : "negras") + ".");
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
      mensaje("Juegas " + (orient === "w" ? "blancas" : "negras") + ".");
    }, 450);
    return true;
  }

  function termina() {
    bloqueado = true; clearInterval(temporizador); el.pista.disabled = true;
    if (!hechos[p.i]) { hechos[p.i] = fallos || pistaVista ? 1 : 2; guardar(); }
    anota(true);
    registra(!(fallos || pistaVista));
    mensaje("¡Correcto!", "bien");
    el.sig.hidden = false;
    progreso();
    avance = setTimeout(avanza, 2500);
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

  el.sol.addEventListener("click", function () {
    if (!p || bloqueado) return;
    anota(false); registra(false); progreso();
    if (!hechos[p.i]) { hechos[p.i] = 1; guardar(); }
    bloqueado = true; clearInterval(temporizador); el.pista.disabled = true; el.sol.disabled = true; sel = null;
    var resto = p.s.slice(paso), san = [], k = 0;
    mensaje("Solución…");
    (function siguientePaso() {
      if (k >= resto.length) {
        mensaje("", "bien");
        el.msg.innerHTML = "Solución: " + san.join("&nbsp; ");
        el.sig.hidden = false;
        return;
      }
      var u = resto[k++], quien = chess.turn(), m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      if (m) san.push(figurita(m.san, quien));
      dibuja([u.slice(0, 2), u.slice(2, 4)]);
      avance = setTimeout(siguientePaso, 800);
    })();
  });

  el.sig.addEventListener("click", function () {
    clearTimeout(avance);
    avanza();
  });
  el.nivel.addEventListener("change", function () {
    try { localStorage.setItem("apejupo_nivel", el.nivel.value); } catch (e) {}
    cierraBateria();
    siguiente();
  });

  // ---------- Batería de problemas: N problemas seguidos del tema y nivel elegidos, con estadísticas al final ----------
  function mm(ms) { var s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function registra(ok) {
    if (!bat) return;
    bat.res.push(ok); bat.tiempos.push(Date.now() - inicio);
  }
  function avanza() { if (bat) avanzaBateria(); else siguiente(); }
  function cierraBateria() {
    bat = null; el.bat.value = ""; el.result.hidden = true; el.result.innerHTML = "";
  }
  function iniciaBateria(n) {
    var nv = NIVELES[+el.nivel.value];
    var cand = lista.filter(function (x) { return x.r >= nv[1] && x.r < nv[2]; });
    if (!cand.length) { mensaje("No hay problemas en este nivel.", "mal"); el.bat.value = ""; return; }
    cand = cand.map(function (x) { return { x: x, k: Math.random() + (hechos[x.i] ? 1 : 0) }; })
      .sort(function (a, b) { return a.k - b.k; }).map(function (o) { return o.x; });
    bat = { n: n, cola: cand.slice(0, n), res: [], tiempos: [], inicio: Date.now() };
    el.result.hidden = true;
    empieza(bat.cola[0]);
  }
  function avanzaBateria() {
    if (bat.res.length >= bat.cola.length) { terminaBateria(); return; }
    empieza(bat.cola[bat.res.length]);
  }
  function terminaBateria() {
    clearInterval(temporizador); clearTimeout(avance);
    var tot = bat.res.length, ok = bat.res.filter(Boolean).length, ms = Date.now() - bat.inicio, n = bat.n;
    var puntos = bat.res.map(function (r) { return '<i class="' + (r ? "ok" : "ko") + '"></i>'; }).join("");
    el.result.innerHTML = "<h4>Batería completada</h4>" +
      '<p class="big">' + ok + "/" + tot + " · " + Math.round(ok * 100 / tot) + " % acierto</p>" +
      '<p class="muted">Tiempo total ' + mm(ms) + " · media " + Math.round(ms / tot / 1000) + " s por problema</p>" +
      '<div class="dots">' + puntos + "</div>" +
      '<div class="ent-btns"><button type="button" class="btn" id="bat-rep">Repetir</button>' +
      '<button type="button" class="btn-ghost" id="bat-cerrar">Cerrar</button></div>';
    el.result.hidden = false;
    el.sig.hidden = true; el.pct.textContent = "";
    mensaje("Batería terminada", "bien");
    U.$("bat-rep").onclick = function () { cierraBateria(); el.bat.value = String(n); iniciaBateria(n); };
    U.$("bat-cerrar").onclick = function () {
      cierraBateria();
      bloqueado = true; el.pista.disabled = true; el.sol.disabled = true; el.sig.hidden = false;
      mensaje("Elige un tema, un nivel o una batería para seguir.");
    };
    bat = null;
  }
  el.bat.addEventListener("change", function () {
    if (el.bat.value) iniciaBateria(+el.bat.value); else cierraBateria();
  });

  function elige(id) {
    cat = indice.categorias.concat(indice.temas || []).filter(function (c) { return c.id === id; })[0];
    if (!cat) return;
    var tarjeta = document.querySelector('a.theme[data-id="' + id + '"] .pc');
    el.titulo.innerHTML = (tarjeta ? tarjeta.outerHTML : "") + '<span class="tn">' + U.esc(cat.titulo) +
      '<small class="cnt">' + cat.n.toLocaleString("es-ES") + " ejercicios</small></span>";
    Array.prototype.forEach.call(document.querySelectorAll("a.theme[data-id]"), function (a) {
      if (a.getAttribute("data-id") === id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    cierraBateria();
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
