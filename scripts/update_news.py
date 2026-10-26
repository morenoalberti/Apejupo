"""Descarga los feeds RSS/Atom y genera data/news.json. Solo usa la biblioteca estándar.

Uso:  python scripts/update_news.py
Prográmalo cada 30 min (Programador de tareas de Windows, cron o GitHub Actions).
"""
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

# (nombre, url, idioma). Las que no están en español se traducen automáticamente.
FEEDS = [
    ("ChessBase", "https://es.chessbase.com/feed", "es"),
    ("Chess.com", "https://www.chess.com/es/rss/news", "es"),
    ("Lichess", "https://lichess.org/blog.atom", "en"),
    ("Chessdom", "https://www.chessdom.com/feed/", "en"),
    ("FIDE", "https://www.fide.com/feed/", "en"),
]
MAX_PER_FEED = {"es": 12, "en": 5}
TOTAL = 30
ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "data" / "news.json"
CACHE = ROOT / ".cache" / "translations.json"
ATOM = "{http://www.w3.org/2005/Atom}"


def text(el):
    return (el.text or "").strip() if el is not None else ""


def clean(html):
    # unescape dos veces: algunos feeds llegan con las entidades escapadas (&amp;eacute;)
    text = unescape(unescape(re.sub(r"<[^>]+>", " ", html or "")))
    return re.sub(r"\s+", " ", text).strip()


def parse_date(s):
    try:
        d = parsedate_to_datetime(s)
    except Exception:
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def image_from(el, html):
    for child in el.iter():
        tag = child.tag.split("}")[-1]
        if tag in ("thumbnail", "content", "enclosure") and child.get("url", "").startswith("http"):
            return child.get("url")
    m = re.search(r'<img[^>]+src="(https?://[^"]+)"', html or "")
    return m.group(1) if m else ""


def read(name, url, lang):
    req = urllib.request.Request(url, headers={"User-Agent": "ApejupoBot/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        root = ET.fromstring(r.read())
    items = []
    for it in list(root.iter("item")) + list(root.iter(ATOM + "entry")):
        link = text(it.find("link"))
        if not link:
            l = it.find(ATOM + "link")
            link = l.get("href", "") if l is not None else ""
        raw = text(it.find("description")) or text(it.find(ATOM + "summary")) or text(it.find(ATOM + "content"))
        d = parse_date(text(it.find("pubDate")) or text(it.find(ATOM + "published")) or text(it.find(ATOM + "updated")))
        items.append({
            "source": name,
            "title": clean(text(it.find("title")) or text(it.find(ATOM + "title"))),
            "link": link,
            "date": d.isoformat() if d else "",
            "img": image_from(it, raw),
            "text": clean(raw)[:140],
            "lang": lang,
        })
    return items[:MAX_PER_FEED[lang]]


# ---------- Traducción al español (MyMemory, API pública gratuita sin clave) ----------
def load_cache():
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def translate(text_en, cache):
    """Devuelve el texto en español o None si no se pudo traducir (se reintenta en la siguiente ejecución)."""
    if not text_en:
        return ""
    if text_en in cache:
        return cache[text_en]
    url = "https://api.mymemory.translated.net/get?" + urllib.parse.urlencode({"q": text_en[:480], "langpair": "en|es"})
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ApejupoBot/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        out = (data.get("responseData") or {}).get("translatedText", "")
        if data.get("responseStatus") != 200 or not out or "MYMEMORY WARNING" in out.upper():
            return None
        out = unescape(out).strip()
    except Exception:
        return None
    cache[text_en] = out
    return out


def to_spanish(items):
    cache = load_cache()
    kept, fallidas = [], 0
    for it in items:
        if it["lang"] != "es":
            title, body = translate(it["title"], cache), translate(it["text"], cache)
            if title is None or body is None:
                fallidas += 1
                continue  # no se publica en inglés: se reintenta en la próxima ejecución
            it["title"], it["text"] = title, body
        kept.append(it)
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    if fallidas:
        print(f"[aviso] {fallidas} noticias sin traducir; se omiten por ahora")
    return kept


OG = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', re.I)
OG_REV = re.compile(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', re.I)


def og_image(item):
    """Lee la imagen principal (og:image) del artículo; si falla, deja la del feed."""
    try:
        req = urllib.request.Request(item["link"], headers={"User-Agent": "ApejupoBot/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            html = r.read(150_000).decode("utf-8", "ignore")
        m = OG.search(html) or OG_REV.search(html)
        if m and m.group(1).startswith("http"):
            item["img"] = unescape(m.group(1))
    except Exception:
        pass
    return item


def main():
    all_items = []
    for name, url, lang in FEEDS:
        try:
            all_items += read(name, url, lang)
        except Exception as e:
            print(f"[aviso] {name}: {e}")
    all_items = [i for i in all_items if i["title"] and i["link"].startswith("http")]
    all_items.sort(key=lambda i: i["date"], reverse=True)
    top = to_spanish(all_items[:TOTAL])
    with ThreadPoolExecutor(max_workers=8) as pool:
        top = list(pool.map(og_image, top))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(top, ensure_ascii=False, indent=1), encoding="utf-8")
    con_img = sum(1 for i in top if i["img"])
    print(f"{len(top)} noticias guardadas ({con_img} con imagen) en {OUT}")


if __name__ == "__main__":
    main()
