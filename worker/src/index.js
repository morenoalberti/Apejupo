// Colector de torneos en directo de fuentes que el navegador no puede leer (sin CORS).
// Chess.com, FIDE y jugadores/clasificaciones de Lichess. Cada fuente tiene su propia caché.

const SOURCES = [chesscom];

async function chesscom() {
  const r = await fetch("https://www.chess.com/callback/events/upcoming-streams", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ApejupoChessClub/1.0)", Accept: "application/json" },
  });
  if (!r.ok) throw new Error("chess.com " + r.status);
  const j = await r.json();
  const byTitle = new Map();
  for (const s of j.streams || []) {
    const start = Date.parse(s.startAt), end = Date.parse(s.endAt);
    if (!s.title || isNaN(start) || isNaN(end)) continue;
    const key = s.title + "|" + s.startAt;
    if (byTitle.has(key)) continue; // el mismo directo viene repetido por cada sección del torneo
    const url = s.type === "twitch" ? "https://www.twitch.tv/" + s.channel
              : s.type === "youtube" ? "https://www.youtube.com/watch?v=" + s.channel
              : "https://www.chess.com/events";
    byTitle.set(key, { source: "Chess.com", id: "cc-" + (s.eventId || key), title: s.title, short: s.shortTitle || s.title, start, end, url, via: s.type });
  }
  return [...byTitle.values()];
}

async function collect() {
  const out = [], errors = [];
  for (const src of SOURCES) {
    try { out.push(...(await src())); } catch (e) { errors.push(String(e.message || e)); }
  }
  const now = Date.now();
  const live = out.filter((e) => e.start <= now && now <= e.end).map((e) => ({ ...e, status: "live" }));
  const upcoming = out.filter((e) => e.start > now).sort((a, b) => a.start - b.start).slice(0, 20).map((e) => ({ ...e, status: "soon" }));
  return { updated: now, live, upcoming, errors };
}

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" };

// Estadísticas de partidas de un jugador (blancas/negras, victorias, tablas y derrotas por ritmo) de la FIDE.
// El navegador no puede pedirlas directamente (la FIDE no permite CORS), así que el Worker las trae: /?fide=1503014
async function fideStats(id) {
  const r = await fetch(`https://ratings.fide.com/a_data_stats.php?id1=${id}&id2=0`, {
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: `https://ratings.fide.com/profile/${id}/statistics`, "User-Agent": "Mozilla/5.0 ApejupoBot/1.0" },
  });
  if (!r.ok) throw new Error("FIDE " + r.status);
  const txt = (await r.text()).trim().replace(/^﻿/, "").trim();
  if (!txt) return {}; // la FIDE no tiene partidas registradas de este jugador
  const j = JSON.parse(txt);
  return j[0] || {};
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    // La lista pública de jugadores de Lichess no permite CORS desde otra web.
    // Solo se admite un ID de torneo; no se aceptan direcciones arbitrarias.
    const players = new URL(request.url).searchParams.get("players");
    if (players !== null) {
      const headers = { ...CORS, "Cache-Control": "public, max-age=60" };
      if (!/^[a-zA-Z0-9]{8}$/.test(players)) return new Response("[]", { status: 400, headers });
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const key = new Request(new URL(request.url).origin + "/players/" + players);
      if (cache) { const hit = await cache.match(key); if (hit) return hit; }
      try {
        const upstream = await fetch(`https://lichess.org/broadcast/${players}/players`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; ApejupoChessClub/1.0; +https://apejupo.com)" } });
        if (!upstream.ok) return new Response(JSON.stringify({ error: "Lichess no está disponible", upstreamStatus: upstream.status }), { status: upstream.status === 429 ? 429 : 502, headers: { ...headers, "Cache-Control": "no-store" } });
        const data = await upstream.json();
        if (!Array.isArray(data)) throw new Error("Formato de jugadores no válido");
        const res = new Response(JSON.stringify(data), { headers });
        if (cache) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      } catch (e) {
        return new Response(JSON.stringify({ error: "No se pudieron obtener los jugadores" }), { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
      }
    }
    const foto = new URL(request.url).searchParams.get("foto");
    if (foto !== null) { // foto del perfil público de la FIDE: /?foto=2256657 (imagen). Solo se usa cuando otros servidores no la tienen.
      if (!/^\d{1,10}$/.test(foto)) return new Response("", { status: 400, headers: CORS });
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const key = new Request(new URL(request.url).origin + "/foto/" + foto);
      if (cache) { const hit = await cache.match(key); if (hit) return hit; }
      try {
        const html = await (await fetch(`https://ratings.fide.com/profile/${foto}`, { headers: { "User-Agent": "Mozilla/5.0 ApejupoBot/1.0" } })).text();
        const m = /profile-top__photo"\s+src="data:image\/(jpeg|png|webp);base64,([^"]+)"/.exec(html);
        if (!m) return new Response("", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
        const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        const res = new Response(bin, { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "image/" + m[1], "Cache-Control": "public, max-age=86400" } });
        if (cache) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      } catch (e) {
        return new Response("", { status: 502, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }
    const fide = new URL(request.url).searchParams.get("fide");
    if (fide !== null) {
      if (!/^\d{1,10}$/.test(fide)) return new Response("{}", { status: 400, headers: CORS });
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const key = new Request(new URL(request.url).origin + "/fide/" + fide);
      if (cache) { const hit = await cache.match(key); if (hit) return hit; }
      try {
        const res = new Response(JSON.stringify({ id: fide, stats: await fideStats(fide) }), { headers: { ...CORS, "Cache-Control": "public, max-age=21600" } });
        if (cache) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: CORS });
      }
    }
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const key = new Request(new URL(request.url).origin + "/events");
    if (cache) { const hit = await cache.match(key); if (hit) return hit; }
    const res = new Response(JSON.stringify(await collect()), { headers: CORS });
    if (cache) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};

export { collect };
