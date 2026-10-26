(function () {
  var D = window.APEJUPO, $ = U.$, esc = U.esc;
  // ---------- Pestañas FIDE / FADA ----------
  var tabs = $("elo-tabs");
  tabs.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]");
    if (!b) return;
    Array.prototype.forEach.call(tabs.children, function (t) {
      var on = t === b;
      t.setAttribute("aria-selected", on ? "true" : "false");
      $("panel-" + t.getAttribute("data-p")).hidden = !on;
    });
  });

  // ---------- Buscador propio (listas FIDE y FADA de data/elo) ----------
  var info = $("elo-info"), wrap = $("elo-results-wrap"), res = $("elo-results"), q = $("elo-q");
  var shards = {}, meta = null, timer = 0, seq = 0;

  function norm(s) {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }
  function shard(letter) {
    if (shards[letter]) return shards[letter];
    shards[letter] = fetch("data/elo/" + letter + ".json?v=" + (meta ? meta.construido : ""))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (list) { list.forEach(function (p) { p.k = norm(p[0]); }); return list; })
      .catch(function () { delete shards[letter]; return []; });
    return shards[letter];
  }
  function show(n) { return n ? esc(n) : "–"; }

  function render(list, tokens) {
    if (!list.length) { wrap.hidden = true; info.textContent = "Sin resultados. Prueba con el apellido tal como aparece en las listas oficiales."; return; }
    list.sort(function (a, b) {
      var sa = a.k.indexOf(tokens[0]) === 0 ? 0 : 1, sb = b.k.indexOf(tokens[0]) === 0 ? 0 : 1;
      return sa - sb || Math.max(b[3], b[6]) - Math.max(a[3], a[6]);
    });
    var more = list.length > 50;
    info.textContent = more ? "Mostrando 50 de " + list.length + ". Añade el nombre para afinar la búsqueda." : list.length + (list.length === 1 ? " resultado" : " resultados");
    res.innerHTML = list.slice(0, 50).map(function (p) {
      return "<tr><td><strong>" + esc(p[0]) + "</strong></td><td>" + esc(p[2]) + '</td>' +
        '<td class="num">' + show(p[3]) + '</td><td class="num">' + show(p[4]) + '</td><td class="num">' + show(p[5]) + "</td>" +
        '<td class="num elo">' + show(p[6]) + "</td><td>" + esc(p[7]) + "</td>" +
        "<td>" + (p[1] ? '<a class="small" target="_blank" rel="noopener" href="https://ratings.fide.com/profile/' + esc(p[1]) + '">Ficha FIDE</a>' : "") + "</td></tr>";
    }).join("");
    wrap.hidden = false;
  }

  function search() {
    var text = q.value, mine = ++seq;
    var tokens = norm(text).split(" ").filter(Boolean);
    if (norm(text).length < 2) { wrap.hidden = true; info.textContent = periodInfo(); return; }
    var letters = [tokens[0].charAt(0)];
    if (tokens.length > 1) letters.push(tokens[tokens.length - 1].charAt(0));
    Promise.all(letters.filter(function (l, i) { return letters.indexOf(l) === i; }).map(function (l) { return shard(/[a-z]/.test(l) ? l : "_"); }))
      .then(function (parts) {
        if (mine !== seq) return;
        var all = [].concat.apply([], parts).filter(function (p) {
          return tokens.every(function (t) { return p.k.indexOf(t) >= 0; });
        });
        render(all, tokens);
      });
  }
  function periodInfo() {
    return meta ? "Listas de " + meta.fada_periodo + " · " + meta.jugadores.toLocaleString("es-ES") + " jugadores. Escribe al menos dos letras del apellido." : "";
  }

  var COLUMNAS = {
    "RondaSwissFIDE.db": "nombre, federacion, titulo, anio_nacimiento, elo_standard, elo_blitz, elo_rapid, fide_id, sexo",
    "RondaSwissFADA.db": "nombre, club, federado, titulo, anio_nacimiento, elo_fada, fide_id, sexo, provincia"
  };
  var TITULOS = { "RondaSwissFIDE.db": "Base de datos FIDE (todos los países)", "RondaSwissFADA.db": "Base de datos FADA (Andalucía)" };

  function showBases(m) {
    var dbs = m.bases_de_datos || {};
    var html = Object.keys(dbs).map(function (file) {
      var d = dbs[file];
      return '<div class="card"><div class="body"><h4>' + esc(TITULOS[file] || file) + "</h4>" +
        '<p class="meta">' + esc(file) + " · " + Math.round(d.bytes / 1048576).toLocaleString("es-ES") + " MB · " + d.filas.toLocaleString("es-ES") + " jugadores</p>" +
        "<p>Tabla <code>" + esc(d.tabla) + "</code>: " + esc(COLUMNAS[file] || "") + ".</p>" +
        '<p class="meta">Lista de ' + esc(m.fada_periodo) + " · construida el " + esc(m.construido) + "</p>" +
        '<a class="more" download href="data/elo/' + esc(file) + "?v=" + esc(m.construido) + '">Descargar ' + esc(file) + " →</a></div></div>";
    }).join("");
    $("bases-list").innerHTML = html || '<p class="muted">Las bases de datos no están disponibles ahora mismo.</p>';
  }

  fetch("data/elo/meta.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (m) { meta = m; info.textContent = periodInfo(); showBases(m); })
    .catch(function () {
      info.textContent = "El buscador no está disponible ahora mismo. Usa la pestaña «FIDE oficial».";
      q.disabled = true;
    });
  $("elo-search").addEventListener("submit", function (e) { e.preventDefault(); search(); });
  q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(search, 250); });

  // ---------- Ficha FIDE por número ----------
  // La búsqueda por nombre la hace el propio buscador de FIDE incrustado.
  $("fide-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("fide-q").value.trim();
    if (!/^\d{3,}$/.test(q)) {
      $("fide-hint").textContent = "Escribe solo el número FIDE (cifras). Para buscar por nombre, usa el buscador de FIDE de aquí abajo.";
      return;
    }
    var url = "https://ratings.fide.com/profile/" + q;
    $("fide-frame").src = url;
    $("fide-open").href = url;
  });

  // ---------- Clasificación del equipo ----------
  var players = D.players.slice().sort(function (a, b) { return b.elo - a.elo; });
  var body = $("elo-body");

  function cell(id, v) { return '<td class="num" data-c="' + id + '">' + (v == null ? "–" : esc(v)) + "</td>"; }

  body.innerHTML = players.map(function (p, i) {
    return '<tr data-i="' + i + '"><td class="pos">' + (i + 1) + '</td>' +
      '<td><strong>' + esc(p.name) + '</strong><div class="muted small">' + esc(p.title) + '</div></td>' +
      '<td class="num elo">' + esc(p.elo) + '</td>' +
      cell("lb", p.lichess ? "…" : null) + cell("lr", p.lichess ? "…" : null) +
      cell("cb", p.chesscom ? "…" : null) + cell("cr", p.chesscom ? "…" : null) + "</tr>";
  }).join("");

  function set(i, id, v) {
    var td = body.querySelector('tr[data-i="' + i + '"] td[data-c="' + id + '"]');
    if (td) td.textContent = v == null ? "–" : v;
  }

  players.forEach(function (p, i) {
    if (p.lichess) {
      fetch("https://lichess.org/api/user/" + encodeURIComponent(p.lichess))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var pf = j.perfs || {};
          set(i, "lb", pf.blitz && pf.blitz.rating);
          set(i, "lr", pf.rapid && pf.rapid.rating);
        })
        .catch(function () { set(i, "lb", null); set(i, "lr", null); });
    }
    if (p.chesscom) {
      fetch("https://api.chess.com/pub/player/" + encodeURIComponent(p.chesscom.toLowerCase()) + "/stats")
        .then(function (r) { return r.json(); })
        .then(function (j) {
          set(i, "cb", j.chess_blitz && j.chess_blitz.last && j.chess_blitz.last.rating);
          set(i, "cr", j.chess_rapid && j.chess_rapid.last && j.chess_rapid.last.rating);
        })
        .catch(function () { set(i, "cb", null); set(i, "cr", null); });
    }
  });
})();
