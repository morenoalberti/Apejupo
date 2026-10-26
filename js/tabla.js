// Página ELO: pestañas FIDE, FADA y Apejupo, cada una con su buscador por nombre.
// FIDE y FADA se consultan en las bases SQLite de data/elo/*.db directamente desde el navegador (sql.js-httpvfs),
// que solo descarga las páginas de la base que necesita cada consulta.
(function () {
  var $ = U.$, esc = U.esc;
  var PAGE = 50;
  var LIB_VERSION = "2"; // súbela si cambias los ficheros de assets/sqljs, para que los navegadores no usen la copia antigua
  var meta = null, workers = {}, tops = {}, seq = 0, timer = 0;

  // La biblioteca para leer las bases pesa ~1,3 MB: se empieza a descargar ya, en paralelo, para que la primera búsqueda no la espere.
  ["assets/sqljs/sqlite.worker.js?v=" + LIB_VERSION, "assets/sqljs/sql-wasm.wasm?v=" + LIB_VERSION].forEach(function (u) { fetch(u).catch(function () {}); });
  var state = { modo: "fide", page: 0 };

  var BASES = {
    fide: {
      file: "RondaSwissFIDE.db", titulo: "FIDE",
      cols: ["N.º", "FIDE ID", "Jugador", "Fed.", "Título", "Estándar", "Rápidas", "Blitz"], num: [0, 1, 5, 6, 7]
    },
    fada: {
      file: "RondaSwissFADA.db", titulo: "FADA",
      cols: ["N.º", "Jugador", "Club", "Licencia", "Título", "Elo FADA", "FIDE ID", "Provincia"], num: [0, 5, 6]
    }
  };

  function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function cleanName(s) { return s.trim().replace(/[^\p{L}\p{N} ,.'\-]/gu, ""); }

  // nombre que empieza por…: rango sobre el índice (nombre COLLATE NOCASE)
  function prefix(text) {
    var lo = text.toLowerCase();
    var hi = lo.slice(0, -1) + String.fromCharCode(lo.charCodeAt(lo.length - 1) + 1);
    return "nombre COLLATE NOCASE >= " + lit(lo) + " AND nombre COLLATE NOCASE < " + lit(hi);
  }

  // En las listas el apellido va primero («Moreno Alberti, Manuel»). Si se escribe «Manuel Moreno Alberti» se prueban
  // también los cortes posibles: lo último como apellido y lo primero como nombre.
  function variantes(text) {
    var v = [{ pref: text, dado: "" }];
    var p = text.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    if (text.indexOf(",") < 0 && p.length >= 2) {
      for (var k = 1; k < p.length; k++) v.push({ pref: p.slice(k).join(" "), dado: p.slice(0, k).join(" ") });
    }
    return v;
  }

  function buildSql(v) {
    var text = cleanName($("f-nombre").value);
    var esId = /^\d{3,}$/.test(text);
    var w = [], order, sql;
    if (esId) w.push("fide_id = " + parseInt(text, 10));
    else if (v.pref) {
      w.push(prefix(v.pref));
      if (v.dado) w.push("nombre LIKE " + lit("%, " + v.dado + "%"));
    }
    if (state.modo === "fide") {
      order = text && !esId ? "nombre COLLATE NOCASE" : "elo_standard DESC, id ASC";
      sql = "SELECT fide_id, nombre, federacion, titulo, elo_standard, elo_rapid, elo_blitz FROM jugadores_fide";
    } else {
      order = text && !esId ? "nombre COLLATE NOCASE" : "elo_fada DESC, id ASC";
      sql = "SELECT nombre, club, federado, titulo, elo_fada, fide_id, provincia FROM jugadores_fada";
    }
    return sql + (w.length ? " WHERE " + w.join(" AND ") : "") + " ORDER BY " + order +
      " LIMIT " + (PAGE + 1) + " OFFSET " + (state.page * PAGE);
  }

  function getDb(modo) {
    if (workers[modo]) return workers[modo];
    var file = BASES[modo].file;
    var url = new URL("data/elo/" + file, location.href).href + "?v=" + (meta ? meta.construido : "");
    var info = meta && meta.bases_de_datos && meta.bases_de_datos[file];
    // GitHub Pages responde comprimido (gzip) a la consulta del tamaño, así que se lo damos nosotros (meta.json).
    var config = { serverMode: "full", url: url, requestChunkSize: 16384 }; // múltiplo del tamaño de página (4096): menos peticiones
    if (info && info.bytes) config.databaseLengthBytes = info.bytes;
    workers[modo] = createDbWorker(
      [{ from: "inline", config: config }],
      new URL("assets/sqljs/sqlite.worker.js?v=" + LIB_VERSION, location.href).href,
      new URL("assets/sqljs/sql-wasm.wasm?v=" + LIB_VERSION, location.href).href
    ).then(function (w) { return w.db; }).catch(function (e) { delete workers[modo]; throw e; });
    return workers[modo];
  }

  function n(v) { return v == null || v === "" ? "–" : Number(v).toLocaleString("es-ES", { useGrouping: false }); }
  function fideLink(id) {
    return id ? '<a target="_blank" rel="noopener" href="https://ratings.fide.com/profile/' + esc(id) + '">' + esc(id) + "</a>" : "–";
  }

  function renderRows(rows, esTop) {
    var more = rows.length > PAGE, list = rows.slice(0, PAGE), base = state.page * PAGE;
    var fide = state.modo === "fide";
    $("tbl-body").innerHTML = list.map(function (r, i) {
      var jugador = '<td><span class="jug">' + U.avatar(r.nombre, r.fide_id) + "<strong>" + esc(r.nombre) + "</strong></span></td>";
      if (fide) {
        return '<tr><td class="pos">' + (base + i + 1) + '</td><td class="num">' + fideLink(r.fide_id) + "</td>" + jugador +
          "<td>" + U.flag(r.federacion) + esc(r.federacion) + "</td><td>" + esc(r.titulo || "") + "</td>" +
          '<td class="num elo">' + n(r.elo_standard) + '</td><td class="num">' + n(r.elo_rapid) + '</td><td class="num">' + n(r.elo_blitz) + "</td></tr>";
      }
      return '<tr><td class="pos">' + (base + i + 1) + "</td>" + jugador + "<td>" + esc(r.club || "") + "</td><td>" + esc(r.federado || "") + "</td>" +
        "<td>" + esc(r.titulo || "") + '</td><td class="num elo">' + n(r.elo_fada) + '</td><td class="num">' + fideLink(r.fide_id) + "</td><td>" + esc(r.provincia || "") + "</td></tr>";
    }).join("");
    U.fotos($("tbl-body"));
    $("tbl-prev").disabled = state.page === 0;
    $("tbl-next").disabled = !more;
    $("tbl-page").textContent = list.length ? "Filas " + (base + 1) + " a " + (base + list.length) : "";
    var d = meta && meta.bases_de_datos && meta.bases_de_datos[BASES[state.modo].file];
    var lista = d ? " · lista de " + BASES[state.modo].titulo + (state.modo === "fada" && meta.fada_periodo ? " (" + meta.fada_periodo + ")" : "") +
      ": " + d.filas.toLocaleString("es-ES") + " jugadores." : ".";
    $("tbl-info").textContent = !list.length
      ? "Sin resultados. Prueba con el apellido o con «apellido, nombre», tal como aparece en las listas oficiales."
      : esTop ? "Los " + (meta && meta.top ? meta.top.toLocaleString("es-ES") + " " : "") + "jugadores con más Elo. Escribe un nombre para buscar entre todos" + lista
        : "Resultados por nombre" + lista;
  }

  // Lista inicial (los jugadores con más Elo): fichero pequeño ya calculado, se muestra al instante sin tocar la base.
  function cargarTop(modo) {
    if (tops[modo]) return tops[modo];
    tops[modo] = fetch("data/elo/top_" + modo + ".json?v=" + (meta ? meta.construido : ""))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (a) {
        return a.map(function (r) {
          return modo === "fide"
            ? { fide_id: r[0], nombre: r[1], federacion: r[2], titulo: r[3], elo_standard: r[4], elo_rapid: r[5], elo_blitz: r[6] }
            : { nombre: r[0], club: r[1], federado: r[2], titulo: r[3], elo_fada: r[4], fide_id: r[5], provincia: r[6] };
        });
      })
      .catch(function (e) { delete tops[modo]; throw e; });
    return tops[modo];
  }

  function run() {
    var mine = ++seq;
    var text = cleanName($("f-nombre").value);
    if (!text) {  // sin búsqueda: lista inicial precalculada
      cargarTop(state.modo)
        .then(function (todo) { if (mine === seq) renderRows(todo.slice(state.page * PAGE, state.page * PAGE + PAGE + 1), true); })
        .catch(function () { if (mine === seq) { $("f-nombre").value = ""; consultar(mine, text); } });
      getDb(state.modo).catch(function () {}); // mientras se ve la lista, ya se prepara la base de datos para buscar
      return;
    }
    consultar(mine, text);
  }

  function consultar(mine, text) {
    $("tbl-info").textContent = "Buscando… (la primera búsqueda tarda unos segundos)";
    var vars = /^\d{3,}$/.test(text) || !text ? [{ pref: "", dado: "" }] : variantes(text);
    getDb(state.modo)
      .then(function (db) {
        var i = 0;
        function probar() {
          return db.query(buildSql(vars[i])).then(function (rows) {
            if (!rows.length && i < vars.length - 1 && state.page === 0 && mine === seq) { i++; return probar(); }
            return rows;
          });
        }
        return probar();
      })
      .then(function (rows) { if (mine === seq) renderRows(rows); })
      .catch(function (e) {
        if (mine !== seq) return;
        $("tbl-body").innerHTML = "";
        $("tbl-info").textContent = "No se pudo consultar la lista en este navegador. Prueba de nuevo en unos minutos.";
        if (window.console) console.error(e);
      });
  }

  function equipo() {
    var q = $("f-nombre").value.trim(), n = window.eloEquipo.filtrar(q);
    $("tbl-info").textContent = n ? (q ? n + (n === 1 ? " jugador" : " jugadores") + " del equipo" : "Jugadores del equipo Apejupo") : "Ningún jugador del equipo coincide con esa búsqueda.";
  }

  function setModo(modo) {
    state.modo = modo;
    state.page = 0;
    Array.prototype.forEach.call($("elo-tabs").children, function (b) { b.setAttribute("aria-selected", b.getAttribute("data-t") === modo ? "true" : "false"); });
    var bd = modo !== "apejupo";
    $("panel-bd").hidden = !bd;
    $("panel-apejupo").hidden = bd;
    $("nota-fide").hidden = !bd;
    $("chk-fotos").hidden = false;
    $("f-nombre").placeholder = modo === "apejupo" ? "Busca un jugador del equipo por su nombre" : "Busca por nombre (por ejemplo, Moreno Alberti)";
    if (bd) {
      var cols = BASES[modo].cols, num = BASES[modo].num;
      $("tbl-head").innerHTML = "<tr>" + cols.map(function (c, i) { return "<th" + (num.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + esc(c) + "</th>"; }).join("") + "</tr>";
      $("tbl-body").innerHTML = "";
      $("tbl-page").textContent = "";
      $("tbl-prev").disabled = $("tbl-next").disabled = true;
      run();
    } else {
      equipo();
    }
  }

  function buscar() {
    state.page = 0;
    if (state.modo === "apejupo") equipo(); else run();
  }

  $("elo-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-t]");
    if (b && b.getAttribute("data-t") !== state.modo) setModo(b.getAttribute("data-t"));
  });
  $("elo-form").addEventListener("submit", function (e) { e.preventDefault(); clearTimeout(timer); buscar(); });
  $("f-nombre").addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(buscar, state.modo === "apejupo" ? 100 : 350);
  });
  $("tbl-prev").addEventListener("click", function () { if (state.page > 0) { state.page--; run(); } });
  $("tbl-next").addEventListener("click", function () { state.page++; run(); });

  $("f-fotos").checked = U.fotosActivas();
  $("f-fotos").addEventListener("change", function () {
    U.setFotos(this.checked);
    if (this.checked) { U.fotos($("tbl-body")); U.fotos($("elo-body")); }
    else location.reload(); // quita las fotos ya cargadas
  });

  fetch("data/elo/meta.json", { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(function (m) { meta = m; })
    .catch(function () {})
    .then(function () { setModo("fide"); });
})();
