// Tabla de jugadores como la de RondaSwiss: consulta las bases SQLite (data/elo/*.db) directamente desde el
// navegador con sql.js-httpvfs, que solo descarga las páginas de la base que necesita cada consulta.
(function () {
  var $ = U.$, esc = U.esc;
  var PAGE = 50;
  var LIB_VERSION = "2"; // súbela si cambias los ficheros de assets/sqljs, para que los navegadores no usen la copia antigua
  var meta = null, started = false;
  var workers = {};
  var state = { db: "fide", page: 0 };

  var BASES = {
    fide: {
      file: "RondaSwissFIDE.db",
      cols: ["N.º", "FIDE ID", "Nombre", "Fed.", "Título", "Estándar", "Rápidas", "Blitz"],
      num: [0, 1, 5, 6, 7],
      orden: [["std", "Elo estándar (mayor a menor)"], ["nombre", "Nombre (A–Z)"], ["id", "FIDE ID"]]
    },
    fada: {
      file: "RondaSwissFADA.db",
      cols: ["N.º", "Nombre", "Club", "Licencia", "Título", "Elo FADA", "FIDE ID", "Provincia"],
      num: [0, 5, 6],
      orden: [["elo", "Elo FADA (mayor a menor)"], ["nombre", "Nombre (A–Z)"]]
    }
  };

  function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function int(s) { var n = parseInt(String(s).replace(/\D/g, ""), 10); return isFinite(n) ? n : null; }
  function cleanName(s) { return s.trim().replace(/[^\p{L}\p{N} ,.'\-]/gu, ""); }

  // nombre que empieza por…: rango sobre el índice (nombre COLLATE NOCASE)
  function prefix(col, text) {
    var lo = text.toLowerCase();
    var hi = lo.slice(0, -1) + String.fromCharCode(lo.charCodeAt(lo.length - 1) + 1);
    return col + " COLLATE NOCASE >= " + lit(lo) + " AND " + col + " COLLATE NOCASE < " + lit(hi);
  }

  function buildSql() {
    var f = {
      nombre: cleanName($("f-nombre").value), id: int($("f-id").value), fed: $("f-fed").value.trim().toUpperCase(),
      titulo: $("f-titulo").value, prov: $("f-prov").value, lic: $("f-fed2").value, min: int($("f-min").value), orden: $("f-orden").value
    };
    var w = [], order, sql;
    if (state.db === "fide") {
      if (f.id) w.push("fide_id = " + f.id);
      if (f.nombre) w.push(prefix("nombre", f.nombre));
      if (/^[A-Z]{3}$/.test(f.fed)) w.push("federacion = " + lit(f.fed));
      if (/^[A-Z]{2,3}$/.test(f.titulo)) w.push("titulo = " + lit(f.titulo));
      if (f.min) w.push("elo_standard >= " + f.min);
      order = { std: "elo_standard DESC, id ASC", nombre: "nombre COLLATE NOCASE", id: "fide_id" }[f.orden] || "elo_standard DESC, id ASC";
      sql = "SELECT fide_id, nombre, federacion, titulo, elo_standard, elo_rapid, elo_blitz FROM jugadores_fide";
    } else {
      if (f.nombre) w.push(prefix("nombre", f.nombre));
      if (/^[A-Z]+$/.test(f.prov)) w.push("provincia = " + lit(f.prov));
      if (/^(FED|HAB|NO)$/.test(f.lic)) w.push("federado = " + lit(f.lic));
      if (f.min) w.push("elo_fada >= " + f.min);
      order = { elo: "elo_fada DESC, id ASC", nombre: "nombre COLLATE NOCASE" }[f.orden] || "elo_fada DESC, id ASC";
      sql = "SELECT nombre, club, federado, titulo, elo_fada, fide_id, provincia FROM jugadores_fada";
    }
    return sql + (w.length ? " WHERE " + w.join(" AND ") : "") + " ORDER BY " + order +
      " LIMIT " + (PAGE + 1) + " OFFSET " + (state.page * PAGE);
  }

  function getDb(kind) {
    if (workers[kind]) return workers[kind];
    var url = new URL("data/elo/" + BASES[kind].file, location.href).href + "?v=" + (meta ? meta.construido : "");
    var info = meta && meta.bases_de_datos && meta.bases_de_datos[BASES[kind].file];
    // GitHub Pages responde comprimido (gzip) a la consulta del tamaño, así que se lo damos nosotros (meta.json).
    var config = { serverMode: "full", url: url, requestChunkSize: 4096 };
    if (info && info.bytes) config.databaseLengthBytes = info.bytes;
    workers[kind] = createDbWorker(
      [{ from: "inline", config: config }],
      new URL("assets/sqljs/sqlite.worker.js?v=" + LIB_VERSION, location.href).href,
      new URL("assets/sqljs/sql-wasm.wasm?v=" + LIB_VERSION, location.href).href
    ).then(function (w) { return w.db; }).catch(function (e) { delete workers[kind]; throw e; });
    return workers[kind];
  }

  function n(v) { return v == null || v === "" ? "–" : Number(v).toLocaleString("es-ES", { useGrouping: false }); }

  function renderRows(rows) {
    var more = rows.length > PAGE;
    var list = rows.slice(0, PAGE);
    var base = state.page * PAGE;
    var fide = state.db === "fide";
    $("tbl-body").innerHTML = list.map(function (r, i) {
      if (fide) {
        return "<tr><td class=\"pos\">" + (base + i + 1) + "</td>" +
          '<td class="num"><a target="_blank" rel="noopener" href="https://ratings.fide.com/profile/' + esc(r.fide_id) + '">' + esc(r.fide_id) + "</a></td>" +
          "<td><strong>" + esc(r.nombre) + "</strong></td><td>" + esc(r.federacion) + "</td><td>" + esc(r.titulo || "") + "</td>" +
          '<td class="num elo">' + n(r.elo_standard) + '</td><td class="num">' + n(r.elo_rapid) + '</td><td class="num">' + n(r.elo_blitz) + "</td></tr>";
      }
      return "<tr><td class=\"pos\">" + (base + i + 1) + "</td><td><strong>" + esc(r.nombre) + "</strong></td><td>" + esc(r.club || "") + "</td>" +
        "<td>" + esc(r.federado || "") + "</td><td>" + esc(r.titulo || "") + '</td><td class="num elo">' + n(r.elo_fada) + "</td>" +
        '<td class="num">' + (r.fide_id ? '<a target="_blank" rel="noopener" href="https://ratings.fide.com/profile/' + esc(r.fide_id) + '">' + esc(r.fide_id) + "</a>" : "–") + "</td>" +
        "<td>" + esc(r.provincia || "") + "</td></tr>";
    }).join("");
    $("tbl-prev").disabled = state.page === 0;
    $("tbl-next").disabled = !more;
    $("tbl-page").textContent = list.length ? "Filas " + (base + 1) + " a " + (base + list.length) : "";
    var d = meta && meta.bases_de_datos && meta.bases_de_datos[BASES[state.db].file];
    $("tbl-info").textContent = list.length
      ? (d ? "Lista de " + (state.db === "fide" ? "FIDE" : "la FADA (" + meta.fada_periodo + ")") + ": " + d.filas.toLocaleString("es-ES") + " jugadores en la base de datos." : "")
      : "Sin resultados con esos filtros.";
  }

  var seq = 0;
  function run() {
    var mine = ++seq;
    $("tbl-info").textContent = "Consultando la base de datos… (la primera consulta tarda unos segundos)";
    var sql = buildSql();
    getDb(state.db)
      .then(function (db) { return db.query(sql); })
      .then(function (rows) { if (mine === seq) renderRows(rows); })
      .catch(function (e) {
        if (mine !== seq) return;
        $("tbl-body").innerHTML = "";
        $("tbl-info").textContent = "No se pudo consultar la base de datos en este navegador. Puedes descargarla en la pestaña «Bases de datos».";
        if (window.console) console.error(e);
      });
  }

  function setDb(kind) {
    state.db = kind;
    state.page = 0;
    Array.prototype.forEach.call($("tbl-db").children, function (b) { b.setAttribute("aria-selected", b.getAttribute("data-db") === kind ? "true" : "false"); });
    Array.prototype.forEach.call(document.querySelectorAll("#tbl-filters .only-fide"), function (el) { el.hidden = kind !== "fide"; });
    Array.prototype.forEach.call(document.querySelectorAll("#tbl-filters .only-fada"), function (el) { el.hidden = kind !== "fada"; });
    $("f-orden").innerHTML = BASES[kind].orden.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + "</option>"; }).join("");
    var cols = BASES[kind].cols, num = BASES[kind].num;
    $("tbl-head").innerHTML = "<tr>" + cols.map(function (c, i) { return "<th" + (num.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + esc(c) + "</th>"; }).join("") + "</tr>";
    $("tbl-body").innerHTML = "";
    $("tbl-page").textContent = "";
    $("tbl-prev").disabled = $("tbl-next").disabled = true;
  }

  function start() {
    if (started) return;
    started = true;
    fetch("data/elo/meta.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (m) { meta = m; }).catch(function () {}).then(function () {
      setDb("fide");
      run();
    });
  }

  document.querySelector('#elo-tabs button[data-p="tabla"]').addEventListener("click", start);
  $("tbl-db").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-db]");
    if (!b || b.getAttribute("data-db") === state.db) return;
    setDb(b.getAttribute("data-db"));
    run();
  });
  $("tbl-filters").addEventListener("submit", function (e) { e.preventDefault(); state.page = 0; run(); });
  $("tbl-prev").addEventListener("click", function () { if (state.page > 0) { state.page--; run(); } });
  $("tbl-next").addEventListener("click", function () { state.page++; run(); });
})();
