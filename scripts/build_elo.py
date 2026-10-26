"""Construye data/elo/*.json con el Elo FIDE (jugadores de España) y el Elo FADA (Andalucía).

Fuentes oficiales y públicas:
  - FIDE: https://ratings.fide.com/download/*_rating_list_xml.zip (lista mensual, se publica el día 1)
  - FADA: artículo mensual "Elo FADA <mes> <año>" de https://fadajedrez.com/wp/category/elo/

Solo se publican nombre, título, ratings, provincia y número FIDE. No se publica año de nacimiento, sexo ni
ningún otro dato personal.

Uso:
  python scripts/build_elo.py           # solo reconstruye si hay listas nuevas
  python scripts/build_elo.py --force   # reconstruye siempre

Pensado para ejecutarse a menudo (la comprobación son 2 peticiones ligeras): reconstruye si la FADA ha
publicado un mes nuevo, o si FIDE ha cambiado su lista durante los primeros 7 días del mes.
"""
import io
import json
import re
import sys
import tempfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urljoin

OUT = Path(__file__).resolve().parent.parent / "data" / "elo"
UA = {"User-Agent": "ApejupoBot/1.0 (+https://morenoalberti.github.io/Apejupo/)"}
FIDE_COUNTRY = "ESP"
FIDE_ZIPS = {
    "std": "https://ratings.fide.com/download/standard_rating_list_xml.zip",
    "rpd": "https://ratings.fide.com/download/rapid_rating_list_xml.zip",
    "blz": "https://ratings.fide.com/download/blitz_rating_list_xml.zip",
}
FADA_CATEGORY = "https://fadajedrez.com/wp/category/elo/"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def request(url, method="GET"):
    return urllib.request.Request(url, headers=UA, method=method)


def fetch(url):
    with urllib.request.urlopen(request(url), timeout=120) as r:
        return r.read()


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    return re.sub(r"[^a-z0-9 ]", "", "".join(c for c in s if unicodedata.category(c) != "Mn").lower()).strip()


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


# ---------- Comprobación de novedades ----------
def fada_latest():
    cat = fetch(FADA_CATEGORY).decode("utf-8", "ignore")
    arts = list(dict.fromkeys(re.findall(r'href="(https?://[^"]*/wp/elo-fada-[^"]+/)"', cat)))
    if not arts:
        raise RuntimeError("No se encontró el artículo mensual de la FADA")
    return arts[0]


def fide_stamp():
    with urllib.request.urlopen(request(FIDE_ZIPS["std"], "HEAD"), timeout=60) as r:
        return r.headers.get("Last-Modified", "") + "|" + r.headers.get("Content-Length", "")


def needs_rebuild(meta_path):
    if not meta_path.exists():
        return True, "no hay datos previos"
    old = json.loads(meta_path.read_text(encoding="utf-8"))
    if old.get("fada_article") != fada_latest():
        return True, "la FADA ha publicado una lista nueva"
    if old.get("fide_stamp") != fide_stamp() and datetime.now(timezone.utc).day <= 7:
        return True, "FIDE ha actualizado su lista"
    return False, "sin novedades"


# ---------- FIDE ----------
def read_fide(kind, url, only_players=None):
    """Devuelve {fide_id: (name, title, rating)} de los jugadores del país configurado."""
    with tempfile.TemporaryFile() as tmp:
        with urllib.request.urlopen(request(url), timeout=300) as r:
            while chunk := r.read(1 << 20):
                tmp.write(chunk)
        tmp.seek(0)
        z = zipfile.ZipFile(tmp)
        out = {}
        with z.open(z.namelist()[0]) as xml:
            for _, el in ET.iterparse(xml, events=("end",)):
                if el.tag != "player":
                    continue
                if el.findtext("country") == FIDE_COUNTRY:
                    pid = to_int(el.findtext("fideid"))
                    out[pid] = (
                        (el.findtext("name") or "").strip(),
                        (el.findtext("title") or el.findtext("w_title") or "").strip(),
                        to_int(el.findtext("rating")),
                    )
                el.clear()
    return out


# ---------- FADA (xlsx, solo biblioteca estándar) ----------
def read_fada(article):
    html = fetch(article).decode("utf-8", "ignore")
    m = re.search(r'data-downloadurl\s*=\s*"(.*?)"', html, re.S) or re.search(r'href="([^"]*/wp/download/[^"]+)"', html)
    if not m:
        raise RuntimeError("No se encontró el enlace de descarga de la FADA")
    z = zipfile.ZipFile(io.BytesIO(fetch(urljoin(article, unescape(m.group(1)).strip()))))
    shared = [
        "".join(t.text or "" for t in si.iter("{%s}t" % MAIN))
        for si in ET.parse(z.open("xl/sharedStrings.xml")).getroot().findall("{%s}si" % MAIN)
    ]
    wb = ET.parse(z.open("xl/workbook.xml")).getroot()
    rels = {r.get("Id"): r.get("Target") for r in ET.parse(z.open("xl/_rels/workbook.xml.rels")).getroot()}
    target = next(rels[s.get("{%s}id" % REL)] for s in wb.find("{%s}sheets" % MAIN) if s.get("name").lower() == "elo")
    sheet = "xl/" + target.lstrip("/").replace("xl/", "")

    def col(ref):
        n = 0
        for ch in re.match(r"[A-Z]+", ref).group(0):
            n = n * 26 + ord(ch) - 64
        return n - 1

    rows, header = [], None
    for _, el in ET.iterparse(z.open(sheet), events=("end",)):
        if el.tag != "{%s}row" % MAIN:
            continue
        cells = {}
        for c in el.findall("{%s}c" % MAIN):
            v = c.find("{%s}v" % MAIN)
            if v is not None:
                cells[col(c.get("r"))] = shared[int(v.text)] if c.get("t") == "s" else v.text
        el.clear()
        if header is None:
            if cells.get(0) == "ID_Fada":
                header = {v: k for k, v in cells.items()}  # nombre de columna -> posición
            continue
        if cells.get(header["Apellidos_Nombre"]):
            rows.append({k: cells.get(i, "") for k, i in header.items()})
    return rows


def surname_letter(name):
    base = norm(name.split(",")[0]) or norm(name)
    return base[:1] if base[:1].isalpha() else "_"


def build():
    article = fada_latest()
    stamp = fide_stamp()
    print("FIDE: descargando listas…")
    std = read_fide("std", FIDE_ZIPS["std"])
    rpd = read_fide("rpd", FIDE_ZIPS["rpd"])
    blz = read_fide("blz", FIDE_ZIPS["blz"])
    print(f"  jugadores {FIDE_COUNTRY}: {len(std)}")
    print("FADA: descargando", article)
    fada = read_fada(article)
    print(f"  jugadores FADA: {len(fada)}")

    people = {}  # clave: id FIDE o "f<n>" si no tiene
    for pid, (name, title, rating) in std.items():
        people[pid] = {"n": name, "id": pid, "t": title, "s": rating, "r": rpd.get(pid, ("", "", 0))[2],
                       "b": blz.get(pid, ("", "", 0))[2], "f": 0, "p": ""}
    for i, row in enumerate(fada):
        pid = to_int(row.get("ID_Fide"))
        rec = people.get(pid) if pid else None
        if rec is None:
            rec = people.setdefault(pid or "f%d" % i, {"n": row["Apellidos_Nombre"].strip(), "id": pid, "t": row.get("Titl", "").strip(),
                                                         "s": to_int(row.get("E_FIDE")), "r": to_int(row.get("RRtng")),
                                                         "b": to_int(row.get("BRtng")), "f": 0, "p": ""})
        rec["f"] = to_int(row.get("E_FADA")) or to_int(row.get("EloFADA"))
        prov = (row.get("Prov") or "").strip()
        rec["p"] = "" if prov in ("0", "00") else prov

    # Solo jugadores con algún rating: el resto no aporta nada y así se publican menos datos personales.
    people = {k: r for k, r in people.items() if r["s"] or r["r"] or r["b"] or r["f"]}

    shards = {}
    for rec in people.values():
        shards.setdefault(surname_letter(rec["n"]), []).append(
            [rec["n"], rec["id"], rec["t"], rec["s"], rec["r"], rec["b"], rec["f"], rec["p"]])

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    for letter, items in shards.items():
        items.sort(key=lambda x: norm(x[0]))
        (OUT / f"{letter}.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fada_month = re.search(r"elo-fada-([a-z]+-\d{4})", article)
    meta = {
        "fada_article": article,
        "fada_periodo": fada_month.group(1).replace("-", " ") if fada_month else "",
        "fide_stamp": stamp,
        "construido": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "jugadores": len(people),
        "letras": sorted(shards),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    con_fada = sum(1 for r in people.values() if r["f"])
    print(f"Listo: {len(people)} jugadores ({con_fada} con Elo FADA) en {len(shards)} ficheros -> {OUT}")


def main():
    meta = OUT / "meta.json"
    if "--force" not in sys.argv:
        rebuild, why = needs_rebuild(meta)
        print("Comprobación:", why)
        if not rebuild:
            return
    build()


if __name__ == "__main__":
    main()
