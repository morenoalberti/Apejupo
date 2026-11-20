/* Cloudflare Web Analytics: identificador público del sitio, sin claves de administración. */
(function () {
  "use strict";
  if (location.protocol !== "https:" || ["apejupo.com", "www.apejupo.com"].indexOf(location.hostname) < 0) return;
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
  if (window.__apejupoAnalytics) return;
  // Cloudflare > Web Analytics > apejupo.com > Gestionar sitio > data-cf-beacon.token.
  var token = "084b7d2e308a45ac90b96aeed1ab07c7";
  if (!/^[a-f0-9]{32}$/i.test(token)) return;
  if (document.querySelector('script[data-cf-beacon], script[src^="https://static.cloudflareinsights.com/beacon.min.js"]')) return;

  window.__apejupoAnalytics = true;
  var script = document.createElement("script");
  script.type = "module";
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute("data-cf-beacon", JSON.stringify({ token: token }));
  document.head.appendChild(script);
})();
