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

// ───────── Galería de fotos del club (/fotos) ─────────
// Las fotos se guardan en el bucket R2 «FOTOS»: f/<id> es la foto y t/<id> la miniatura (con ancho, alto y álbum).
// Ver la galería es público; subir exige la clave del club (FOTOS_CLAVE) y borrar, la de administración (FOTOS_ADMIN).
// Las dos claves son secretos del Worker: no están en el repositorio.
const FOTO_CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "X-Clave, Content-Type", "Access-Control-Max-Age": "86400" };
const FOTO_MAX = 4 * 1024 * 1024, MINI_MAX = 400 * 1024, INTENTOS_MAX = 8;
const FOTO_ID = /^[0-9a-z]{9}-[0-9a-f]{8}$/;
const fjson = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...FOTO_CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function igual(a, b) { // comparación en tiempo constante
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) d |= (x[i % x.length] || 0) ^ y[i];
  return d === 0;
}

// Freno a quien pruebe claves al azar: tras varios fallos desde la misma IP se bloquea 15 minutos.
async function fallos(request, sumar) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (!cache) return 0;
  const key = new Request("https://apejupo.invalid/fotos-intentos/" + encodeURIComponent(request.headers.get("CF-Connecting-IP") || "local"));
  const hit = await cache.match(key);
  let n = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (sumar) { n++; await cache.put(key, new Response(String(n), { headers: { "Cache-Control": "max-age=900" } })); }
  return n;
}

async function rol(request, env) {
  if ((await fallos(request)) >= INTENTOS_MAX) return "bloqueado";
  const c = request.headers.get("X-Clave") || "";
  if (igual(c, env.FOTOS_ADMIN)) return "admin";
  if (igual(c, env.FOTOS_CLAVE)) return "socio";
  await fallos(request, true);
  return null;
}

async function tipoImagen(file) { // se comprueba el contenido real, no lo que diga el navegador
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const BLOQUEO = "Demasiados intentos. Prueba dentro de 15 minutos.";
const PIE_MAX = 200, PIE_PLAZO = 24 * 3600 * 1000; // un socio puede escribir o corregir el pie de su foto durante 24 h; la administración, siempre
const limpio = (v, max) => String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
function texto(v) { try { return decodeURIComponent(v || ""); } catch (e) { return ""; } }

async function fotos(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { headers: FOTO_CORS });
  if (!env.FOTOS) return fjson({ error: "La galería todavía no está activada" }, 503);
  const ruta = url.pathname.replace(/\/+$/, "");

  if (request.method === "GET" && ruta === "/fotos") { // lista completa, de la más reciente a la más antigua
    const out = [];
    let cursor;
    do {
      const l = await env.FOTOS.list({ prefix: "t/", cursor, include: ["customMetadata"] });
      for (const o of l.objects) {
        const m = o.customMetadata || {};
        out.push({ id: o.key.slice(2), w: +m.w || 4, h: +m.h || 3, album: texto(m.album), pie: texto(m.pie), ts: +m.ts || o.uploaded.getTime() });
      }
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    // Orden elegido por la administración (orden.json). Las fotos que no están en él (las nuevas) van primero, de la más reciente a la más antigua.
    let orden = [];
    try { const o = await env.FOTOS.get("orden.json"); if (o) orden = await o.json(); } catch (e) {}
    const pos = new Map(Array.isArray(orden) ? orden.map((id, i) => [id, i]) : []);
    out.sort((a, b) => {
      const pa = pos.has(a.id), pb = pos.has(b.id);
      if (pa !== pb) return pa ? 1 : -1;
      return pa ? pos.get(a.id) - pos.get(b.id) : b.ts - a.ts;
    });
    return fjson({ fotos: out });
  }

  if (request.method === "POST" && ruta === "/fotos/orden") { // la administración guarda el orden de la galería
    const r = await rol(request, env);
    if (r === "bloqueado") return fjson({ error: BLOQUEO }, 429);
    if (r !== "admin") return fjson({ error: "Solo la administración puede ordenar las fotos" }, r ? 403 : 401);
    let body;
    try { body = await request.json(); } catch (e) { return fjson({ error: "Envío no válido" }, 400); }
    const ids = body && Array.isArray(body.ids) ? body.ids : null;
    if (!ids || ids.length > 20000 || !ids.every((id) => typeof id === "string" && FOTO_ID.test(id))) return fjson({ error: "Orden no válido" }, 400);
    await env.FOTOS.put("orden.json", JSON.stringify([...new Set(ids)]), { httpMetadata: { contentType: "application/json" } });
    return fjson({ ok: true });
  }

  const img = /^\/fotos\/([ft])\/([^/]+)$/.exec(ruta);
  if (request.method === "GET" && img && FOTO_ID.test(img[2])) {
    const o = await env.FOTOS.get(img[1] + "/" + img[2]);
    if (!o) return new Response("", { status: 404, headers: FOTO_CORS });
    return new Response(o.body, { headers: { ...FOTO_CORS, "Content-Type": (o.httpMetadata && o.httpMetadata.contentType) || "image/webp", "Cache-Control": "public, max-age=31536000, immutable", ETag: o.httpEtag } });
  }

  if (request.method === "POST" && ruta === "/fotos/acceso") { // comprueba la clave antes de empezar a subir
    const r = await rol(request, env);
    if (r === "bloqueado") return fjson({ error: BLOQUEO }, 429);
    return r ? fjson({ ok: true, admin: r === "admin" }) : fjson({ error: "Clave incorrecta" }, 401);
  }

  if (request.method === "POST" && ruta === "/fotos") {
    const r = await rol(request, env);
    if (r === "bloqueado") return fjson({ error: BLOQUEO }, 429);
    if (!r) return fjson({ error: "Clave incorrecta" }, 401);
    if (+request.headers.get("Content-Length") > FOTO_MAX + MINI_MAX + 4096) return fjson({ error: "La foto pesa demasiado" }, 413);
    let form;
    try { form = await request.formData(); } catch (e) { return fjson({ error: "Envío no válido" }, 400); }
    const foto = form.get("foto"), mini = form.get("mini");
    if (!foto || !mini || typeof foto === "string" || typeof mini === "string") return fjson({ error: "Falta la foto" }, 400);
    if (foto.size > FOTO_MAX || mini.size > MINI_MAX) return fjson({ error: "La foto pesa demasiado" }, 413);
    const tf = await tipoImagen(foto), tm = await tipoImagen(mini);
    if (!tf || !tm) return fjson({ error: "El archivo no es una imagen válida" }, 415);
    const w = parseInt(form.get("w"), 10), h = parseInt(form.get("h"), 10);
    if (!(w > 0 && w <= 8000 && h > 0 && h <= 8000)) return fjson({ error: "Medidas no válidas" }, 400);
    const album = limpio(form.get("album"), 60), pie = limpio(form.get("pie"), PIE_MAX);
    const ts = Date.now();
    const id = ts.toString(36).padStart(9, "0") + "-" + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.FOTOS.put("f/" + id, await foto.arrayBuffer(), { httpMetadata: { contentType: tf } });
    // la miniatura se guarda al final: una foto solo aparece en la galería cuando está completa
    await env.FOTOS.put("t/" + id, await mini.arrayBuffer(), { httpMetadata: { contentType: tm }, customMetadata: { w: String(w), h: String(h), album: encodeURIComponent(album), pie: encodeURIComponent(pie), ts: String(ts) } });
    return fjson({ id, w, h, album, pie, ts }, 201);
  }

  const pieRuta = /^\/fotos\/([^/]+)\/pie$/.exec(ruta);
  if (request.method === "POST" && pieRuta && FOTO_ID.test(pieRuta[1])) { // escribir o cambiar el pie de foto
    const r = await rol(request, env);
    if (r === "bloqueado") return fjson({ error: BLOQUEO }, 429);
    if (!r) return fjson({ error: "Clave incorrecta" }, 401);
    let body;
    try { body = await request.json(); } catch (e) { return fjson({ error: "Envío no válido" }, 400); }
    const o = await env.FOTOS.get("t/" + pieRuta[1]);
    if (!o) return fjson({ error: "La foto ya no existe" }, 404);
    const m = o.customMetadata || {};
    if (r !== "admin" && Date.now() - (+m.ts || 0) > PIE_PLAZO) return fjson({ error: "Pasadas 24 horas, solo la administración puede cambiar el pie" }, 403);
    const pie = limpio(body && body.pie, PIE_MAX);
    // R2 no permite cambiar solo los metadatos: se vuelve a guardar la miniatura (pocos KB) con el pie nuevo
    await env.FOTOS.put("t/" + pieRuta[1], await o.arrayBuffer(), { httpMetadata: o.httpMetadata, customMetadata: { ...m, pie: encodeURIComponent(pie) } });
    return fjson({ ok: true, pie });
  }

  const del = /^\/fotos\/([^/]+)$/.exec(ruta);
  if (request.method === "DELETE" && del && FOTO_ID.test(del[1])) {
    const r = await rol(request, env);
    if (r === "bloqueado") return fjson({ error: BLOQUEO }, 429);
    if (r !== "admin") return fjson({ error: "Solo la administración puede borrar fotos" }, r ? 403 : 401);
    await env.FOTOS.delete(["t/" + del[1], "f/" + del[1]]);
    return fjson({ ok: true });
  }

  return fjson({ error: "No encontrado" }, 404);
}

// Últimos vídeos del canal de YouTube del club (@clubtrabajosos), leídos de su RSS público. Se guarda una hora en caché.
const YT_CANAL = "UC8plnnMoRVrig9Q-iP9Q8kw";
async function videos(request, ctx) {
  const headers = { ...FOTO_CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=900" };
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL(request.url).origin + "/videos-cache/" + YT_CANAL);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  try {
    const r = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + YT_CANAL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ApejupoChessClub/1.0; +https://apejupo.com)" } });
    if (!r.ok) throw new Error("YouTube " + r.status);
    const xml = await r.text();
    const txt = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
    const lista = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const e = m[1], g = (re) => (e.match(re) || [, ""])[1];
      return { id: g(/<yt:videoId>([\w-]{11})<\/yt:videoId>/), titulo: txt(g(/<title>([\s\S]*?)<\/title>/)), fecha: g(/<published>([^<]+)<\/published>/) };
    }).filter((v) => v.id);
    const res = new Response(JSON.stringify({ canal: "https://www.youtube.com/@clubtrabajosos", videos: lista }), { headers });
    if (cache) ctx.waitUntil(cache.put(key, new Response(res.clone().body, { headers: { ...headers, "Cache-Control": "public, max-age=3600" } })));
    return res;
  } catch (e) {
    return new Response(JSON.stringify({ error: "No se pudieron leer los vídeos", videos: [] }), { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
  }
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/fotos" || pathname.startsWith("/fotos/")) return fotos(request, env, new URL(request.url));
    if (pathname === "/videos") return request.method === "OPTIONS" ? new Response(null, { headers: FOTO_CORS }) : videos(request, ctx);
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
