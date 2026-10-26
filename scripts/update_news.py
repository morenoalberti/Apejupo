"""Descarga los feeds RSS/Atom y genera data/news.json. Solo usa la biblioteca estándar.

Uso:  python scripts/update_news.py
Prográmalo cada 30 min (Programador de tareas de Windows, cron o GitHub Actions).
"""
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

FEEDS = [
    ("Chess.com", "https://www.chess.com/rss/news"),
    ("Lichess", "https://lichess.org/blog.atom"),
    ("ChessBase", "https://en.chessbase.com/feed"),
]
OUT = Path(__file__).resolve().parent.parent / "data" / "news.json"
ATOM = "{http://www.w3.org/2005/Atom}"


def text(el):
    return (el.text or "").strip() if el is not None else ""


def clean(html):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html or ""))).strip()


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


def read(name, url):
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
        })
    return items[:8]


def main():
    all_items = []
    for name, url in FEEDS:
        try:
            all_items += read(name, url)
        except Exception as e:
            print(f"[aviso] {name}: {e}")
    all_items = [i for i in all_items if i["title"] and i["link"].startswith("http")]
    all_items.sort(key=lambda i: i["date"], reverse=True)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(all_items[:24], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(all_items[:24])} noticias guardadas en {OUT}")


if __name__ == "__main__":
    main()
