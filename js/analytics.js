/* Analítica propia de Apejupo: solo identificadores públicos, sin claves de administración. */
(function () {
  "use strict";
  if (location.protocol !== "https:" || ["apejupo.com", "www.apejupo.com"].indexOf(location.hostname) < 0) return;
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
  if (window.__apejupoAnalytics) return;
  window.__apejupoAnalytics = true;

  // De la página de procedencia solo interesa el sitio, sin búsquedas ni otros parámetros.
  window.apejupoAnalyticsBeforeSend = function (type, payload) {
    if (payload.referrer) {
      try { payload.referrer = new URL(payload.referrer).origin; }
      catch (e) { payload.referrer = ""; }
    }
    return payload;
  };

  function carga(src, atributos) {
    var script = document.createElement("script"), intentos = 0;
    script.defer = true;
    script.src = src;
    Object.keys(atributos).forEach(function (nombre) { script.setAttribute(nombre, atributos[nombre]); });
    script.onerror = function () {
      if (intentos++ < 4) setTimeout(function () {
        script.remove();
        document.head.appendChild(script);
      }, Math.min(15000, 1000 * Math.pow(2, intentos)));
    };
    document.head.appendChild(script);
  }

  carga("https://metricas.chessrival.net/script.js", {
    "data-website-id": "5c8e0725-d3d3-4cfa-9658-5a316d5ae9f1",
    "data-domains": "apejupo.com,www.apejupo.com",
    "data-do-not-track": "true",
    "data-exclude-search": "true",
    "data-exclude-hash": "true",
    "data-before-send": "apejupoAnalyticsBeforeSend"
  });
  carga("https://pulsemetrics.chessrival.net/script.js?v=0.3.0", {
    "data-site-id": "ce5aacb5-596d-4a61-b29e-0e5a93d73e5c"
  });
})();
