// Aviso a pantalla completa del Campeonato del Mundo 2026 (Gukesh D. – Javokhir Sindarov, partida 1).
// Lo carga js/menu.js solo mientras dura el aviso (hoy hasta las 20:00 h de España). Sale una vez por sesión del navegador,
// al entrar en la web, y se cierra con cualquier tecla, con un clic en cualquier sitio o tocando la pantalla.
// «Ver en directo» abre la retransmisión de Lichess en nuestro visor (la misma tarjeta de Torneos Live).
// Los textos se traducen al inglés con js/idioma.js (data/i18n/en.json); los nombres van con translate="no".
(function () {
  "use strict";
  var START = Date.parse("2026-11-24T15:00:00+01:00"); // partida 1: 15:00 h de España (14:00 UTC)
  var END = Date.parse("2026-11-24T20:00:00+01:00");   // a partir de aquí ya no se enseña
  var KEY = "apejupoAvisoMundial2026";
  var LIVE = "torneo.html?r=xLgOJ6cb&t=" + encodeURIComponent("FIDE World Chess Championship 2026");
  var FOTO = "https://chessrival-api.chessrival-worker.workers.dev/api/fide/foto?id=";
  if (Date.now() >= END) return;
  // No en mitad de una partida o de la administración: ahí estorbaría.
  if (/admin-/.test(location.pathname) || (/jugar-torneo/.test(location.pathname) && /[?&]id=/.test(location.search))) return;
  try { if (sessionStorage.getItem(KEY)) return; sessionStorage.setItem(KEY, "1"); } catch (_) {}

  var css = ""
    + ".am-back{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:16px;background:rgba(3,7,14,.82);backdrop-filter:blur(3px);animation:am-in .35s ease-out;overflow-y:auto}"
    + "@keyframes am-in{from{opacity:0}}@keyframes am-pop{from{opacity:0;transform:scale(.94) translateY(12px)}}"
    + "@keyframes am-blink{50%{opacity:.35}}"
    + ".am{--gold:#f5c761;--blue:#4f8cff;position:relative;width:min(1100px,100%);min-height:380px;display:grid;grid-template-columns:1fr 1.25fr 1fr;border-radius:26px;overflow:hidden;color:#eef3fb;"
    + "font-family:Inter,system-ui,'Segoe UI',Roboto,sans-serif;background:#070d18;border:2px solid var(--gold);box-shadow:0 40px 120px -30px #000,0 0 90px -25px #f5c761aa;animation:am-pop .45s cubic-bezier(.2,.8,.2,1)}"
    + ".am *{box-sizing:border-box}"
    + ".am-side{position:relative;background:#101a2e center 18%/cover no-repeat}"
    + ".am-side::after{content:'';position:absolute;inset:0}"
    + ".am-l::after{background:linear-gradient(90deg,#0000 45%,#070d18 100%),linear-gradient(0deg,#070d18 0,#0000 40%)}"
    + ".am-r::after{background:linear-gradient(270deg,#0000 45%,#070d18 100%),linear-gradient(0deg,#070d18 0,#0000 40%)}"
    + ".am-ini{position:absolute;inset:0;display:grid;place-items:center;font:700 72px/1 'Oswald','Bahnschrift','Arial Narrow',Impact,sans-serif;color:#ffffff30}"
    + ".am-who{position:absolute;z-index:1;bottom:18px;left:20px;right:20px}.am-r .am-who{text-align:right}"
    + ".am-who small{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.14em;background:var(--gold);color:#2b1a00}"
    + ".am-r .am-who small{background:var(--blue);color:#fff}"
    + ".am-who b{display:block;margin-top:6px;font:700 clamp(22px,2.6vw,34px)/1 'Oswald','Bahnschrift','Arial Narrow',Impact,sans-serif;text-transform:uppercase;text-shadow:0 3px 14px #000}"
    + ".am-who span{display:block;margin-top:4px;color:#d7e0ee;font-size:13px;text-shadow:0 2px 10px #000}"
    + ".am-mid{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:22px 10px}"
    + ".am-crown{font-size:34px;line-height:1;color:var(--gold);filter:drop-shadow(0 0 14px #f5c761aa)}"
    + ".am-kicker{margin-top:6px;font-weight:800;font-size:12px;letter-spacing:.3em;color:var(--gold)}"
    + ".am h2{max-width:8.5em;margin:6px 0 4px;font:700 clamp(28px,3.4vw,46px)/1 'Oswald','Bahnschrift','Arial Narrow',Impact,sans-serif;text-transform:uppercase;"
    + "background:linear-gradient(180deg,#fff,#f5c761);-webkit-background-clip:text;background-clip:text;color:transparent}"
    + ".am-vs{display:flex;align-items:center;gap:12px;margin:6px 0 10px;color:#9fb0c8;font-size:14px}"
    + ".am-vs i{font-style:normal;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;font:700 20px 'Oswald','Bahnschrift',Impact,sans-serif;color:#2b1a00;"
    + "background:radial-gradient(circle at 35% 30%,#ffe39a,#d99a2b);box-shadow:0 0 24px #f5c761aa}"
    + ".am-when{font-size:15px;margin-bottom:12px}.am-when b{color:var(--gold)}"
    + ".am-cd{display:flex;gap:10px;justify-content:center}"
    + ".am-cd div{min-width:62px;padding:8px 10px;border-radius:12px;background:#0b1424cc;border:1px solid #f5c76155}"
    + ".am-cd b{display:block;font:700 28px/1.1 'Oswald','Bahnschrift',Impact,sans-serif;color:var(--gold)}"
    + ".am-cd span{font-size:11px;color:#9fb0c8;text-transform:uppercase;letter-spacing:.1em}"
    + ".am-live{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:99px;background:#ef444422;border:1px solid #ef444488;color:#ff8080;font-weight:800;letter-spacing:.12em;font-size:14px}"
    + ".am-live i{width:9px;height:9px;border-radius:50%;background:#ff4d4d;animation:am-blink 1.2s infinite}"
    + ".am-btn{display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:12px 22px;border-radius:12px;font-weight:800;font-size:15px;text-decoration:none;"
    + "background:linear-gradient(180deg,#ffd87a,#e3a53a);color:#2b1a00;box-shadow:0 10px 30px -8px #f5c761aa}"
    + ".am-btn:hover{filter:brightness(1.07)}.am-btn:focus-visible{outline:3px solid #fff;outline-offset:3px}"
    + ".am-hint{margin-top:16px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9fb0c8;animation:am-blink 2.4s infinite}"
    + "@media (max-width:760px){.am{grid-template-columns:1fr 1fr;min-height:0}.am-side{aspect-ratio:1}.am-mid{grid-column:1/-1;grid-row:2}"
    + ".am-who{left:12px;right:12px;bottom:10px}.am-who b{font-size:20px}.am-who span{font-size:11px}.am-cd div{min-width:56px}.am-cd b{font-size:24px}}"
    + "@media (prefers-reduced-motion:reduce){.am-back,.am,.am-hint,.am-live i{animation:none}}";

  function player(side, id, role, name, info) {
    return '<div class="am-side am-' + side + '" style="background-image:url(' + FOTO + id + ')"><span class="am-ini" aria-hidden="true" translate="no">' + name.charAt(0) + '</span>'
      + '<div class="am-who"><small>' + role + '</small><b translate="no">' + name + '</b><span>' + info + '</span></div></div>';
  }

  function show() {
    var style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
    var back = document.createElement("div");
    back.className = "am-back"; back.setAttribute("role", "dialog"); back.setAttribute("aria-modal", "true"); back.setAttribute("aria-labelledby", "am-title"); back.tabIndex = -1;
    back.innerHTML = '<div class="am">'
      + player("l", "46616543", "CAMPEÓN", "Gukesh D.", "India · 2710 · Negras")
      + '<div class="am-mid"><div class="am-crown" aria-hidden="true">♛</div><div class="am-kicker">GINEBRA 2026</div>'
      + '<h2 id="am-title">Campeonato del Mundo</h2>'
      + '<div class="am-vs"><span>Campeón</span><i>VS</i><span>Aspirante</span></div>'
      + '<div class="am-when">Partida 1 · <b>Hoy, 15:00 h</b></div>'
      + '<div class="am-clock"></div>'
      + '<a class="am-btn" href="' + LIVE + '" target="_blank" rel="noopener">▶ Ver en directo</a>'
      + '<div class="am-hint">Pulsa cualquier tecla o haz clic para continuar</div></div>'
      + player("r", "14205483", "ASPIRANTE", "Javokhir Sindarov", "Uzbekistán · 2782 · Blancas")
      + '</div>';
    // Si la foto no carga, queda la inicial grande sobre el fondo.
    Array.prototype.forEach.call(back.querySelectorAll(".am-side"), function (s) {
      var img = new Image(); img.onload = function () { s.querySelector(".am-ini").remove(); }; img.src = s.style.backgroundImage.slice(5, -2).replace(/"/g, "");
    });
    var clock = back.querySelector(".am-clock"), pad = function (n) { return (n < 10 ? "0" : "") + n; }, timer = null, mode = "";
    function tick() {
      var s = Math.floor((START - Date.now()) / 1000);
      if (s <= 0) {
        if (mode !== "live") { mode = "live"; clock.innerHTML = '<span class="am-live"><i></i>EN DIRECTO</span>'; }
        return;
      }
      if (mode !== "cd") { mode = "cd"; clock.innerHTML = '<div class="am-cd"><div><b data-h></b><span>horas</span></div><div><b data-m></b><span>min</span></div><div><b data-s></b><span>seg</span></div></div>'; }
      clock.querySelector("[data-h]").textContent = pad(Math.floor(s / 3600));
      clock.querySelector("[data-m]").textContent = pad(Math.floor(s % 3600 / 60));
      clock.querySelector("[data-s]").textContent = pad(s % 60);
    }
    tick(); timer = setInterval(tick, 1000);

    var overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    function close() {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      back.remove(); style.remove();
      document.documentElement.style.overflow = overflow;
    }
    // Cualquier tecla lo cierra (Intro sobre «Ver en directo» abre antes la retransmisión).
    function onKey(e) {
      if (e.key === "Enter" && document.activeElement && document.activeElement.classList.contains("am-btn")) { setTimeout(close, 0); return; }
      e.preventDefault(); e.stopPropagation(); close();
    }
    document.addEventListener("keydown", onKey, true);
    // Un clic o toque en cualquier sitio lo cierra; en «Ver en directo» abre además la retransmisión.
    back.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".am-btn")) { setTimeout(close, 0); return; }
      e.preventDefault(); close();
    });
    document.body.appendChild(back);
    back.focus({ preventScroll: true });
  }
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
})();
