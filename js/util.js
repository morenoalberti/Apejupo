(function () {
  window.U = {
    $: function (id) { return document.getElementById(id); },
    esc: function (s) {
      var d = document.createElement("div");
      d.textContent = s == null ? "" : String(s);
      return d.innerHTML;
    },
    safeUrl: function (u) { return /^https?:\/\//i.test(u || "") ? u : "#"; },
    fmt: function (d, opts) { return new Date(d).toLocaleString("es-ES", opts); }
  };
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // ---------- Banderas: código de federación FIDE -> país (flagcdn.com), como en ChessRival ----------
  var ESPECIAL = {
    ALG: "dz", ANG: "ao", ANT: "ag", ARU: "aw", BAH: "bs", BAN: "bd", BAR: "bb", BER: "bm", BHU: "bt", BIZ: "bz", BOT: "bw",
    BRN: "bh", BRU: "bn", BUL: "bg", BUR: "bf", CAM: "kh", CAY: "ky", CHA: "td", CHI: "cl", CRC: "cr", CRO: "hr", CUR: "cw",
    DEN: "dk", ENG: "gb-eng", ESA: "sv", ESP: "es", FAI: "fo", FIJ: "fj", GAM: "gm", GCI: "gg", GER: "de", GEQ: "gq", SUI: "ch",
    NED: "nl", GRE: "gr", GRN: "gd", GUA: "gt", GUI: "gn", HAI: "ht", HON: "hn", INA: "id", IOM: "im", IRI: "ir", ISV: "vi",
    IVB: "vg", JCI: "je", KOS: "xk", KSA: "sa", KUW: "kw", LAT: "lv", LBA: "ly", LES: "ls", MAD: "mg", MAS: "my", MAW: "mw",
    MGL: "mn", MNC: "mc", MRI: "mu", MTN: "mr", MYA: "mm", NCA: "ni", NEP: "np", NGR: "ng", NIG: "ne", OMA: "om", PAR: "py",
    PHI: "ph", PLE: "ps", POR: "pt", PUR: "pr", RSA: "za", SCO: "gb-sct", SEY: "sc", SKN: "kn", SLO: "si", SOL: "sb", SRI: "lk",
    SUD: "sd", TAN: "tz", TGA: "to", TOG: "tg", TPE: "tw", UAE: "ae", URU: "uy", VAN: "vu", VIE: "vn", VIN: "vc", WLS: "gb-wls",
    NIR: "gb-nir", ZAM: "zm", ZIM: "zw", FID: "", NON: ""
  };
  var ISO3 = {
    ALB: "al", AND: "ad", ARG: "ar", ARM: "am", AUS: "au", AUT: "at", AZE: "az", BEL: "be", BIH: "ba", BLR: "by", BOL: "bo",
    BRA: "br", CAN: "ca", CHN: "cn", COL: "co", CUB: "cu", CYP: "cy", CZE: "cz", DOM: "do", ECU: "ec", EGY: "eg", EST: "ee",
    FIN: "fi", FRA: "fr", GBR: "gb", GEO: "ge", GHA: "gh", HKG: "hk", HUN: "hu", IND: "in", IRL: "ie", IRQ: "iq", ISL: "is",
    ISR: "il", ITA: "it", JAM: "jm", JOR: "jo", JPN: "jp", KAZ: "kz", KEN: "ke", KGZ: "kg", KOR: "kr", LBN: "lb", LIE: "li",
    LTU: "lt", LUX: "lu", MAR: "ma", MDA: "md", MEX: "mx", MKD: "mk", MLT: "mt", MNE: "me", NOR: "no", NZL: "nz", PAK: "pk",
    PAN: "pa", PER: "pe", POL: "pl", PRK: "kp", QAT: "qa", ROU: "ro", RUS: "ru", SGP: "sg", SMR: "sm", SRB: "rs", SVK: "sk",
    SWE: "se", SYR: "sy", THA: "th", TJK: "tj", TKM: "tm", TUN: "tn", TUR: "tr", UKR: "ua", USA: "us", UZB: "uz", VEN: "ve",
    YEM: "ye"
  };
  U.flag = function (fed) {
    var c = (fed || "").trim().toUpperCase();
    var code = c in ESPECIAL ? ESPECIAL[c] : c in ISO3 ? ISO3[c] : "";
    return code ? '<img class="flag" src="https://flagcdn.com/w40/' + code + '.png" alt="" width="20" height="14" loading="lazy">' : "";
  };

  // ---------- Fotos de jugadores ----------
  // Se piden a la API gratuita de ChessRival, que busca la foto del perfil público de FIDE (y, si no hay, Lichess o
  // Wikimedia Commons). No se guardan copias: cada foto se carga cuando la fila es visible.
  var FOTO_API = "https://chessrival-api.chessrival-worker.workers.dev/api/fide/foto?id=";
  var SIN_FOTO_DIAS = 1, MAX_A_LA_VEZ = 4, activas = 0, cola = [];

  function fotosActivas() {
    try { return localStorage.getItem("fotosOff") !== "1"; } catch (e) { return true; }
  }
  U.fotosActivas = fotosActivas;
  U.setFotos = function (on) { try { localStorage.setItem("fotosOff", on ? "0" : "1"); } catch (e) {} };

  function sinFoto(id) {
    try { var t = +localStorage.getItem("fotoNo:" + id); return !!t && Date.now() - t < SIN_FOTO_DIAS * 864e5; } catch (e) { return false; }
  }
  function marcarSinFoto(id) { try { localStorage.setItem("fotoNo:" + id, String(Date.now())); } catch (e) {} }
  function siguiente() { while (activas < MAX_A_LA_VEZ && cola.length) cargar(cola.shift()); }
  function cargar(el) {
    var id = el.getAttribute("data-fid");
    activas++;
    var img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.onload = function () { el.textContent = ""; el.appendChild(img); el.classList.add("con-foto"); fin(); };
    img.onerror = function () { marcarSinFoto(id); fin(); };
    img.src = FOTO_API + encodeURIComponent(id);
  }
  function fin() { activas--; siguiente(); }

  var vigilante = "IntersectionObserver" in window ? new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (!e.isIntersecting) return;
      vigilante.unobserve(e.target);
      if (sinFoto(e.target.getAttribute("data-fid"))) return;
      cola.push(e.target);
      siguiente();
    });
  }, { rootMargin: "150px" }) : null;

  /** Iniciales («Apellido, Nombre» -> «AN») para el círculo que se ve hasta que llega la foto. */
  U.iniciales = function (nombre) {
    var p = String(nombre || "").split(",");
    var a = (p[0] || "").trim().charAt(0), b = (p[1] || "").trim().charAt(0);
    return (a + (b || (p[0] || "").trim().split(" ")[1] || "").charAt(0)).toUpperCase() || "?";
  };
  /** Círculo con las iniciales; si hay número FIDE, U.fotos() lo sustituye por la foto cuando se ve. */
  U.avatar = function (nombre, fideId) {
    return '<span class="av"' + (fideId ? ' data-fid="' + U.esc(fideId) + '"' : "") + ">" + U.esc(U.iniciales(nombre)) + "</span>";
  };
  /** Activa la carga de fotos de los elementos [data-fid] que haya dentro de `raiz`. */
  U.fotos = function (raiz) {
    if (!vigilante || !fotosActivas()) return;
    Array.prototype.forEach.call((raiz || document).querySelectorAll("[data-fid]:not([data-vista])"), function (el) {
      el.setAttribute("data-vista", "1");
      vigilante.observe(el);
    });
  };
})();
