// Canal de YouTube «Cálculo letal»: lista de vídeos para la página canal-youtube.html.
// Solo este canal (no es un proxy abierto). Se intenta la lista completa de subidas (página pública de la lista);
// si YouTube cambia su formato, se usa el resumen oficial del canal (RSS, los 15 últimos). Las fechas salen del resumen
// y, para los vídeos más antiguos, de la página de cada vídeo. Se guarda una hora.
export const YT_CHANNEL = 'UC9AHJ5HBjQpcUbgKA-PMZKg';
const UPLOADS = 'UU' + YT_CHANNEL.slice(2);
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };

// «hace 1 m» → «hace 1 mes», «hace 3 sem» → «hace 3 semanas»… (YouTube abrevia las unidades).
export function expandAgo(text) {
  const m = /^hace\s+(\d+)\s*([a-záéíóú.]+)/i.exec(String(text).trim()); if (!m) return String(text).trim();
  const n = +m[1], u = m[2].toLowerCase().replace('.', '');
  const name = /^(a|año|años)$/.test(u) ? ['año', 'años'] : /^(m|mes|meses)$/.test(u) ? ['mes', 'meses'] : /^(sem|semana|semanas)$/.test(u) ? ['semana', 'semanas']
    : /^(d|día|días|dia|dias)$/.test(u) ? ['día', 'días'] : /^(h|hora|horas)$/.test(u) ? ['hora', 'horas'] : /^(min|minuto|minutos)$/.test(u) ? ['minuto', 'minutos'] : null;
  return name ? `hace ${n} ${name[n === 1 ? 0 : 1]}` : String(text).trim();
}
// Vídeos de la página de la lista de subidas (formato «lockupViewModel» de YouTube).
export function parsePlaylist(html) {
  const at = html.indexOf('ytInitialData = '); if (at < 0) return [];
  const start = html.indexOf('{', at), end = html.indexOf(';</script>', start);
  let data; try { data = JSON.parse(html.slice(start, end)); } catch { return []; }
  const out = [], seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    const v = o.lockupViewModel;
    if (v && v.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && /^[\w-]{11}$/.test(v.contentId || '')) {
      if (!seen.has(v.contentId)) {
        seen.add(v.contentId);
        const length = (JSON.stringify(v.contentImage || {}).match(/"text":"(\d{1,2}(?::\d{2}){1,2})"/) || [])[1] || '';
        // Antigüedad que muestra YouTube («hace 1 m»): sirve cuando no se puede leer la fecha exacta.
        const parts = (v.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap(r => (r.metadataParts || []).map(p => p.text?.content || ''));
        const ago = expandAgo(parts.find(t => /^hace\s/i.test(t)) || '');
        out.push({ id: v.contentId, title: v.metadata?.lockupMetadataViewModel?.title?.content || '', length, ...(ago ? { ago } : {}) });
      }
      return;
    }
    for (const k in o) walk(o[k]);
  })(data);
  return out;
}
// Resumen oficial (RSS): los 15 últimos, con su fecha exacta de publicación.
export function parseFeed(xml) {
  const out = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = (entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!id) continue;
    const title = ((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    out.push({ id, title, published: (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || null });
  }
  return out;
}
export async function youtubeVideos() {
  const cache = caches.default, key = new Request('https://cache.apejupo/youtube/v3/' + YT_CHANNEL);
  const hit = await cache.match(key); if (hit) return hit;
  const [list, feed] = await Promise.all([
    fetch(`https://www.youtube.com/playlist?list=${UPLOADS}`, { headers: HEADERS }).then(r => r.ok ? r.text() : '').then(parsePlaylist).catch(() => []),
    fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`, { headers: HEADERS }).then(r => r.ok ? r.text() : '').then(parseFeed).catch(() => [])
  ]);
  const dates = new Map(feed.map(v => [v.id, v.published]));
  const videos = (list.length ? list : feed).map(v => ({ id: v.id, title: v.title, length: v.length || '', published: dates.get(v.id) || v.published || null, ...(v.ago ? { ago: v.ago } : {}) }));
  // El resumen solo trae la fecha de los 15 últimos: la de los demás se lee en la página de cada vídeo.
  await Promise.all(videos.filter(v => !v.published).slice(0, 40).map(async v => {
    try {
      const html = await (await fetch(`https://www.youtube.com/watch?v=${v.id}`, { headers: HEADERS })).text();
      v.published = (html.match(/"(?:publishDate|uploadDate)":"([^"]+)"/) || [])[1] || null;
    } catch {}
  }));
  const res = new Response(JSON.stringify({ videos, complete: list.length > 0 }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${videos.length ? 3600 : 120}` } });
  if (videos.length) await cache.put(key, res.clone());
  return res;
}
