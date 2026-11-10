(function () {
  var $ = U.$, esc = U.esc, safeUrl = U.safeUrl, fmt = U.fmt, now = Date.now();

  // Tarjetas como las de Torneos Live: imagen (si hay), etiqueta, título, fecha y enlace
  function card(id, img, badge, title, meta, href, linkText, tip, actions) {
    return '<article class="card" data-id="' + esc(id || "") + '"' + (tip ? U.tipAttr(tip) : "") + '>' + (img ? '<img loading="lazy" src="' + esc(safeUrl(img)) + '" alt="">' : "") + '<div class="body">' +
      '<span class="badge ' + badge[0] + '">' + badge[1] + '</span>' +
      '<h4>' + esc(title) + '</h4>' +
      '<p class="meta">' + esc(meta) + '</p>' +
      (actions || (href ? '<a class="more" target="_blank" rel="noopener" href="' + esc(safeUrl(href)) + '">' + linkText + '</a>' : "")) +
      '</div></article>';
  }

  // ---------- Torneos en Andalucía (Info64 y Chess-Results; los genera scripts/update_local.py) ----------
  var local = [], provSel = "Málaga"; // por defecto se abre la provincia del club
  function localId(t) { return t.url || t.name; }
  function localKey() { return "apejupoOrderLocal:" + provSel; } // cada pestaña de provincia guarda su propio orden
  var playersIcon = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5.65"/></svg>';
  var rulesIcon = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/></svg>';
  function localActions(t) {
    var html = '<button type="button" class="btn-ghost local-players-button" data-players="' + esc(localId(t)) + '">' + playersIcon + 'Inscritos</button>';
    if (t.rules_url || t.rules_text || t.rules_document || t.rules_blocks) html += '<button type="button" class="btn-ghost local-rules-button" data-rules="' + esc(localId(t)) + '">' + rulesIcon + 'Bases</button>';
    return '<div class="local-actions">' + html + '</div>';
  }
  var roster = [], rosterSort = { key: "elo", direction: -1 }, rulesViewer = null, rulesGeneration = 0;
  function formatRules(text, blocks) {
    var sections = [{ title: "", number: "", lines: [] }];
    var topics = /^(?:participantes|fecha|lugar|sistema|ritmo|inscripci[oó]n|inscripciones|premios|desempates|reglas|condiciones|horario|calendario|cuotas|admisi[oó]n|reclamaciones|contacto|puntuaci[oó]n|descansos|orden|normas|torneos|programaci[oó]n|informaci[oó]n|emparejamientos|incomparecencias|v[aá]lido|aceptaci[oó]n|organizaci[oó]n)\b/i;
    if (Array.isArray(blocks) && blocks.length) blocks.forEach(function (block) {
      if (block.type === "heading") sections.push({ title: block.text, number: block.number || "", lines: [] });
      else if (block.type === "paragraph") sections[sections.length - 1].lines.push(block.text);
      else if (block.type === "table") sections[sections.length - 1].lines.push(block);
    });
    else String(text || "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(); if (!line) return;
      var number = line.match(/^(\d{1,2})[.)]+\s*[-–]?\s*(.+)$/), heading = "", rest = "";
      if (number) {
        var label = number[2], letters = label.replace(/[^a-záéíóúüñ]/gi, "");
        var capitals = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
        if (label.length < 110 && letters.length && capitals / letters.length > .65) heading = label;
        else if (label.length < 75 && /:$/.test(label) && topics.test(label)) heading = label;
        else if (label.length < 90 && /\.$/.test(label) && topics.test(label)) heading = label.slice(0, -1);
        else {
          var inline = label.match(/^([^.!?]{2,65})\.\s+(.+)$/);
          if (inline && topics.test(inline[1])) { heading = inline[1]; rest = inline[2]; }
        }
      }
      if (heading) {
        sections.push({ title: heading, number: number[1], lines: rest ? [rest] : [] });
      } else if (line.length < 120 && /^[A-ZÁÉÍÓÚÜÑ\s\d“”"'.,()€:–—-]+$/.test(line) && /[A-ZÁÉÍÓÚÜÑ]{3}/.test(line) && !/^IBAN\b/.test(line)) {
        sections.push({ title: line, number: "", lines: [] });
      } else sections[sections.length - 1].lines.push(line);
    });
    function body(lines) {
      var html = "", i = 0;
      while (i < lines.length) {
        if (typeof lines[i] !== "string") {
          var table = lines[i++];
          html += '<div class="rules-data-wrap"><table class="rules-data-table">';
          table.rows.forEach(function (row, index) {
            var header = table.header && index === 0, tag = header ? "th" : "td";
            if (index === 0) html += header ? '<thead>' : '<tbody>';
            else if (table.header && index === 1) html += '</thead><tbody>';
            html += '<tr>' + row.map(function (cell) { var span = Math.max(1, Math.min(20, Number(cell.span) || 1)); return '<' + tag + (header ? ' scope="' + (span > 1 ? 'colgroup' : 'col') + '"' : '') + (span > 1 ? ' colspan="' + span + '"' : '') + '>' + esc(cell.text) + '</' + tag + '>'; }).join('') + '</tr>';
          });
          html += (table.header && table.rows.length === 1 ? '</thead>' : '</tbody>') + '</table></div>';
          continue;
        }
        var schedule = lines[i].match(/^(Ronda\s+\d+|\d+[ªº]\s+Ronda|Recepci[oó]n|Entrega de premios):?\s+(.+)$/i);
        if (schedule) {
          html += '<dl class="rules-schedule">';
          while (i < lines.length && typeof lines[i] === "string" && (schedule = lines[i].match(/^(Ronda\s+\d+|\d+[ªº]\s+Ronda|Recepci[oó]n|Entrega de premios):?\s+(.+)$/i))) {
            html += '<div><dt>' + esc(schedule[1]) + '</dt><dd>' + esc(schedule[2]) + '</dd></div>'; i++;
          }
          html += '</dl>'; continue;
        }
        if (/^[•·▪●–-]\s+/.test(lines[i])) {
          html += '<ul class="rules-list">';
          while (i < lines.length && typeof lines[i] === "string" && /^[•·▪●–-]\s+/.test(lines[i])) { html += '<li>' + esc(lines[i].replace(/^[•·▪●–-]\s+/, "")) + '</li>'; i++; }
          html += '</ul>'; continue;
        }
        var item = lines[i++], detail = item.match(/^([^:]{2,45}):\s+(.+)$/);
        html += '<p>' + (detail ? '<strong>' + esc(detail[1]) + ':</strong> ' + esc(detail[2]) : esc(item)) + '</p>';
      }
      return html;
    }
    return sections.map(function (s) {
      if (!s.title) return s.lines.length ? '<div class="rules-intro">' + body(s.lines) + '</div>' : '';
      return '<section class="rules-section' + (s.number ? '' : ' rules-section-lead') + '"><h4>' + (s.number ? '<span class="rules-section-number">' + esc(s.number) + '</span>' : '') + '<span>' + esc(s.title) + '</span></h4>' + body(s.lines) + '</section>';
    }).join("");
  }
  function searchName(name) { return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function pintaInscritos() {
    var query = searchName($("local-players-search").value.trim());
    var filtered = roster.filter(function (p) { return searchName(p.name).indexOf(query) >= 0; });
    var columns = [{ key: "rank", label: "#" }, { key: "name", label: "Jugador" }, { key: "country", label: "País" }, { key: "elo", label: "Elo" }, { key: "club", label: "Club / Equipo" }];
    filtered.sort(function (a, b) {
      var key = rosterSort.key, x = a[key] || "", y = b[key] || "";
      var difference = key === "rank" || key === "elo" ? Number(x) - Number(y) : String(x).localeCompare(String(y), "es", { sensitivity: "base" });
      return difference * rosterSort.direction || a.rank - b.rank;
    });
    var sortColumn = columns.filter(function (c) { return c.key === rosterSort.key; })[0];
    $("local-players-matches").textContent = query ? filtered.length + " de " + roster.length + " inscritos" : "Ordenados por " + sortColumn.label + (rosterSort.direction === 1 ? " · ascendente" : " · descendente");
    $("local-players-head").innerHTML = '<tr>' + columns.map(function (c) {
      var active = rosterSort.key === c.key, order = active && rosterSort.direction === 1 ? "ascending" : "descending";
      return '<th scope="col"' + (active ? ' aria-sort="' + order + '"' : '') + '><button type="button" data-sort="' + c.key + '" title="Ordenar por ' + c.label + '">' + c.label + '<span aria-hidden="true">' + (active ? (rosterSort.direction === 1 ? '↑' : '↓') : '↕') + '</span></button></th>';
    }).join("") + '</tr>';
    $("local-players-body").innerHTML = filtered.map(function (p) {
      return '<tr><td>' + p.rank + '</td><td>' + (p.title ? '<span class="local-player-title">' + esc(p.title) + '</span> ' : '') + esc(p.name) + '</td><td><span class="local-player-country" title="' + esc(U.pais(p.country)) + '">' + U.flag(p.country) + esc(p.country || "—") + '</span></td><td class="local-player-elo">' + (p.elo || "—") + '</td><td class="local-player-team">' + esc(p.club || "—") + '</td></tr>';
    }).join("") || '<tr><td colspan="5" class="local-players-empty">' + (roster.length ? 'No hay jugadores que coincidan con la búsqueda.' : 'La fuente todavía no ofrece un listado de jugadores disponible. Puedes consultar el original abajo.') + '</td></tr>';
    $("local-players-list").scrollTop = 0;
  }
  function fechas(t) {
    function f(d) { return fmt(d + "T12:00:00", { day: "numeric", month: "short" }); }
    return t.start === t.end ? f(t.start) : "del " + f(t.start) + " al " + f(t.end);
  }
  function pintaLocal() {
    var box = $("local-events"), tabs = $("local-tabs");
    var provs = [];
    local.forEach(function (t) { if (provs.indexOf(t.province) < 0) provs.push(t.province); });
    provs.sort();
    if (provSel && provs.indexOf(provSel) < 0) provSel = ""; // sin torneos en esa provincia: se enseñan todas
    tabs.hidden = !local.length;
    tabs.innerHTML = ['<button type="button" role="tab" aria-selected="' + (!provSel) + '" data-p="">Todas (' + local.length + ")</button>"].concat(provs.map(function (p) {
      var n = local.filter(function (t) { return t.province === p; }).length;
      return '<button type="button" role="tab" aria-selected="' + (provSel === p) + '" data-p="' + esc(p) + '">' + esc(p) + " (" + n + ")</button>";
    })).join("");
    var hoy = new Date().toISOString().slice(0, 10);
    // primero los que aún no han empezado (por fecha); después los que ya están en curso
    var lista = local.filter(function (t) { return !provSel || t.province === provSel; }).sort(function (a, b) {
      var ea = a.start <= hoy ? 1 : 0, eb = b.start <= hoy ? 1 : 0;
      return ea - eb || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    });
    U.applyOrder(lista, localKey(), localId);
    box.innerHTML = lista.length ? lista.map(function (t) {
      var extra = [t.tc, t.rounds ? t.rounds + " rondas" : "", t.organizer].filter(Boolean).join(" · ");
      var sitio = t.city.toLowerCase().indexOf(t.province.toLowerCase()) >= 0 ? t.city : t.city + " (" + t.province + ")";
      return card(localId(t), "", t.start <= hoy ? ["live", "EN CURSO"] : ["soon", "PRÓXIMO"], t.name,
        sitio + " · " + fechas(t) + (extra ? " · " + extra : ""), null, null, null, localActions(t));
    }).join("") : '<p class="muted">No hay torneos programados en esta provincia.</p>';
  }
  U.sortable($("local-events"), localKey, pintaLocal);
  $("local-events").addEventListener("click", function (event) {
    var playersButton = event.target.closest("button[data-players]");
    if (playersButton) {
      var tournament = local.filter(function (t) { return localId(t) === playersButton.getAttribute("data-players"); })[0];
      if (!tournament) return;
      roster = (tournament.players || []).slice().sort(function (a, b) { return b.elo - a.elo || a.name.localeCompare(b.name, "es"); }).map(function (p, i) { return Object.assign({}, p, { rank: i + 1, club: [p.club, p.team].filter(Boolean).join(" / ") }); });
      rosterSort = { key: "elo", direction: -1 };
      $("local-players-title").textContent = tournament.name;
      $("local-players-total").textContent = Array.isArray(tournament.players) ? roster.length + (roster.length === 1 ? " inscrito" : " inscritos") : "Listado pendiente de la fuente";
      $("local-players-search").value = "";
      $("local-players-source").href = safeUrl(tournament.players_url || tournament.participants_url || tournament.url);
      $("local-players-source").textContent = "Consultar original en " + tournament.source;
      pintaInscritos();
      $("local-players").showModal();
      $("local-players-search").focus();
      return;
    }
    var button = event.target.closest("button[data-rules]"); if (!button) return;
    var t = local.filter(function (t) { return localId(t) === button.getAttribute("data-rules"); })[0];
    if (!t) return;
    var extractedRules = Array.isArray(t.rules_blocks) && t.rules_blocks.length ? t.rules_blocks : null;
    var rulesDocument = !extractedRules && /^data\/bases\/[a-f0-9]{16}\.pdf$/.test(t.rules_document || "") ? t.rules_document : "";
    var generation = ++rulesGeneration;
    $("local-rules-title").textContent = "Bases · " + t.name;
    $("local-rules-text").hidden = !!rulesDocument;
    $("local-rules-text").innerHTML = formatRules(t.rules_text || "No se pudieron cargar las bases en este momento.", extractedRules);
    $("local-rules-document").hidden = !rulesDocument;
    $("local-rules-source").href = safeUrl(t.rules_url || t.rules_source || t.url);
    $("local-rules-source").textContent = "Consultar original en " + t.source;
    $("local-rules").showModal();
    $("local-rules").scrollTop = 0;
    if (rulesDocument) {
      $("local-rules-document").textContent = "Cargando bases…";
      import("./rules-viewer.js?v=20261110").then(function (viewer) {
        rulesViewer = viewer;
        if (generation === rulesGeneration && $("local-rules").open) viewer.render($("local-rules-document"), rulesDocument);
      }).catch(function () { if (generation === rulesGeneration) $("local-rules-document").textContent = "No se pudieron cargar las bases en este momento."; });
    }
  });
  $("local-rules-close").addEventListener("click", function () { $("local-rules").close(); });
  $("local-rules").addEventListener("close", function () { rulesGeneration++; if (rulesViewer) rulesViewer.clear($("local-rules-document")); });
  $("local-players-close").addEventListener("click", function () { $("local-players").close(); });
  $("local-players-search").addEventListener("input", pintaInscritos);
  $("local-players-head").addEventListener("click", function (event) {
    var button = event.target.closest("button[data-sort]"); if (!button) return;
    var key = button.getAttribute("data-sort");
    rosterSort = { key: key, direction: rosterSort.key === key ? -rosterSort.direction : (key === "elo" ? -1 : 1) };
    pintaInscritos();
    $("local-players-head").querySelector('button[data-sort="' + key + '"]').focus();
  });
  $("local-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]");
    if (b) { provSel = b.getAttribute("data-p"); pintaLocal(); }
  });
  fetch("data/torneos-locales.json?t=" + Math.floor(Date.now() / 600000))
    .then(function (r) { return r.json(); })
    .then(function (j) { local = (j.tournaments || []).filter(function (t) { return t.end >= new Date(now - 864e5).toISOString().slice(0, 10); }); pintaLocal(); })
    .catch(function () { $("local-events").innerHTML = '<p class="muted">No se pudo cargar el calendario de Andalucía ahora mismo.</p>'; });

  // ---------- Torneos internacionales (Lichess Broadcasts) ----------
  var intl = null;
  function pintaIntl() {
    var list = U.applyOrder(intl.slice(0, 30), "apejupoOrderIntl", function (e) { return e.tour.id; });
    $("intl-events").innerHTML = list.length
      ? list.map(function (e) { return card(e.tour.id, e.image, ["soon", "PRÓXIMAMENTE"], e.title, e.sub, null, null, e.tour); }).join("")
      : '<p class="muted">No hay torneos programados por ahora.</p>';
  }
  U.sortable($("intl-events"), function () { return "apejupoOrderIntl"; }, function () { if (intl) pintaIntl(); });
  fetch("https://lichess.org/api/broadcast/top")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var seen = {}, list = [];
      (j.active || []).concat(j.upcoming || []).forEach(function (x) {
        var t = x.tour || {}, r = x.round || {};
        if (!r.startsAt || r.ongoing || r.finished || r.startsAt < now + 864e5 || seen[t.id]) return;
        seen[t.id] = true;
        list.push({ tour: t, ts: r.startsAt, title: t.name, image: t.image, sub: U.ronda(r.name) + " · " + fmt(r.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), url: r.url || t.url });
      });
      list.sort(function (a, b) { return a.ts - b.ts; });
      intl = list; pintaIntl();
    })
    .catch(function () {
      $("intl-events").innerHTML = '<p class="muted">No se pudo cargar el calendario. <a target="_blank" rel="noopener" href="https://lichess.org/broadcast">Verlo en Lichess</a>.</p>';
    });
})();
