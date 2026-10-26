"""Descarga las listas oficiales de FIDE y FADA y genera, con la MISMA estructura que RondaSwiss:

  RondaSwissFIDE.db  -> tabla jugadores_fide (+ app_settings)
  RondaSwissFADA.db  -> tabla jugadores_fada (+ app_settings)

y, para el buscador de la web, ficheros data/elo/<inicial>.json.

Fuentes oficiales y públicas:
  - FIDE: https://ratings.fide.com/download/players_list_xml.zip (lista completa, se publica el día 1)
  - FADA: artículo mensual "Elo FADA <mes> <año>" de https://fadajedrez.com/wp/category/elo/

Modos:
  python scripts/build_elo.py
      Web (público): solo jugadores de España (FIDE) y Andalucía (FADA) con algún rating. Las columnas
      anio_nacimiento y sexo existen pero van vacías, porque la web es pública. Solo reconstruye si hay
      listas nuevas.
  python scripts/build_elo.py --force
      Igual, pero reconstruye siempre.
  python scripts/build_elo.py --full [--all-countries] [--db-dir CARPETA]
      Versión completa para uso privado (con año de nacimiento y sexo, como importa RondaSwiss), sin filtrar
      por rating. Por defecto solo España; con --all-countries, todos los países. Se guarda en --db-dir
      (por defecto build/full), que NO se publica.

La web ejecuta esto a menudo: la comprobación son 2 peticiones ligeras y solo reconstruye si la FADA ha
publicado un mes nuevo, o si FIDE ha cambiado su lista durante los primeros 7 días del mes.
"""
import json
import re
import sqlite3
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

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "elo"
UA = {"User-Agent": "ApejupoBot/1.0 (+https://morenoalberti.github.io/Apejupo/)"}
FIDE_ZIP = "https://ratings.fide.com/download/players_list_xml.zip"
FIDE_COUNTRY = "ESP"
FADA_CATEGORY = "https://fadajedrez.com/wp/category/elo/"
FIDE_DB = "RondaSwissFIDE.db"
FADA_DB = "RondaSwissFADA.db"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# Estructura idéntica a la de RondaSwiss (Data/FideDatabase.cs y ELOFada.cs)
FIDE_TABLE = """
CREATE TABLE IF NOT EXISTS jugadores_fide (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    federacion TEXT,
    titulo TEXT,
    anio_nacimiento INTEGER,
    elo_standard INTEGER,
    elo_blitz INTEGER,
    elo_rapid INTEGER,
    fide_id INTEGER,
    sexo TEXT
);
CREATE TABLE IF NOT EXISTS app_settings (
    clave TEXT PRIMARY KEY,
    valor TEXT
);
"""
FIDE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_jugadores_fide_nombre_nocase ON jugadores_fide(nombre COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_jugadores_fide_standard_desc ON jugadores_fide(elo_standard DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_jugadores_fide_fide_id ON jugadores_fide(fide_id);
PRAGMA user_version = 1;
"""
FADA_TABLE = """
CREATE TABLE IF NOT EXISTS jugadores_fada (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    club TEXT,
    federado TEXT,
    titulo TEXT,
    anio_nacimiento INTEGER,
    elo_fada INTEGER,
    fide_id INTEGER,
    sexo TEXT,
    provincia TEXT
);
CREATE TABLE IF NOT EXISTS app_settings (
    clave TEXT PRIMARY KEY,
    valor TEXT
);
"""
FADA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_jugadores_fada_nombre_nocase ON jugadores_fada(nombre COLLATE NOCASE);
"""
PROVINCIAS = {"AL": "ALMERIA", "CA": "CADIZ", "CO": "CORDOBA", "GR": "GRANADA", "HU": "HUELVA", "JA": "JAEN", "MA": "MALAGA", "SE": "SEVILLA"}


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


def opt(n):
    """0 -> NULL, como hace RondaSwiss con los valores vacíos."""
    return n if n else None


def now_iso():
    return datetime.now().astimezone().isoformat()


# ---------- Comprobación de novedades ----------
def fada_latest():
    cat = fetch(FADA_CATEGORY).decode("utf-8", "ignore")
    arts = list(dict.fromkeys(re.findall(r'href="(https?://[^"]*/wp/elo-fada-[^"]+/)"', cat)))
    if not arts:
        raise RuntimeError("No se encontró el artículo mensual de la FADA")
    return arts[0]


def fide_stamp():
    with urllib.request.urlopen(request(FIDE_ZIP, "HEAD"), timeout=60) as r:
        return r.headers.get("Last-Modified", "") + "|" + r.headers.get("Content-Length", "")


def needs_rebuild(meta_path):
    if not meta_path.exists() or not (OUT / FIDE_DB).exists() or not (OUT / FADA_DB).exists():
        return True, "no hay datos previos"
    old = json.loads(meta_path.read_text(encoding="utf-8"))
    if old.get("fada_article") != fada_latest():
        return True, "la FADA ha publicado una lista nueva"
    if old.get("fide_stamp") != fide_stamp() and datetime.now(timezone.utc).day <= 7:
        return True, "FIDE ha actualizado su lista"
    return False, "sin novedades"


# ---------- FIDE ----------
def read_fide(countries):
    """Filas (fide_id, nombre, federacion, titulo, anio_nacimiento, std, rapid, blitz, sexo)."""
    rows = []
    with tempfile.TemporaryFile() as tmp:
        with urllib.request.urlopen(request(FIDE_ZIP), timeout=300) as r:
            while chunk := r.read(1 << 20):
                tmp.write(chunk)
        tmp.seek(0)
        z = zipfile.ZipFile(tmp)
        with z.open(z.namelist()[0]) as xml:
            for _, el in ET.iterparse(xml, events=("end",)):
                if el.tag != "player":
                    continue
                fed = (el.findtext("country") or "").strip()
                if countries is None or fed in countries:
                    pid, name = to_int(el.findtext("fideid")), (el.findtext("name") or "").strip()
                    title = (el.findtext("title") or el.findtext("foa_title") or "").strip()
                    if title.lower() in ("none", "ninguno", "-"):
                        title = ""
                    if pid and name:
                        rows.append((pid, name, fed, title, to_int(el.findtext("birthday")),
                                     to_int(el.findtext("rating")), to_int(el.findtext("rapid_rating")),
                                     to_int(el.findtext("blitz_rating")), (el.findtext("sex") or "").strip()))
                el.clear()
    return rows


# ---------- FADA (xlsx, solo biblioteca estándar) ----------
def read_fada_raw(article):
    html = fetch(article).decode("utf-8", "ignore")
    m = re.search(r'data-downloadurl\s*=\s*"(.*?)"', html, re.S) or re.search(r'href="([^"]*/wp/download/[^"]+)"', html)
    if not m:
        raise RuntimeError("No se encontró el enlace de descarga de la FADA")
    import io
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
            rows.append({k: (cells.get(i, "") or "").strip() for k, i in header.items()})
    return rows


def first(row, *keys):
    for k in keys:
        v = row.get(k, "").strip()
        if v and v != "0":
            return v
    return ""


def fada_rows(raw):
    """Filas (nombre, club, federado, titulo, anio_nacimiento, elo_fada, fide_id, sexo, provincia) como RondaSwiss."""
    out = []
    for r in raw:
        club = first(r, "Entidad", "Club")
        prov = first(r, "NombreProvincia", "Prov")
        if not prov or (prov.upper() == "HA" and club.upper().startswith("HABILIT")):
            prov = ""
        prov = PROVINCIAS.get(prov.upper(), prov)
        fed = {"FED": "FED", "FEDERADO": "FED", "HAB": "HAB", "HABILITADO": "HAB", "HABILITANTE": "HAB"}.get(r.get("Federado", "").upper(), "NO")
        out.append((r["Apellidos_Nombre"].strip(), club, fed, r.get("Titl", ""), to_int(first(r, "AnoNacimiento", "FNac")),
                    to_int(first(r, "E_FADA", "EloFADA")), to_int(first(r, "CodigoFIDE", "ID_Fide")),
                    first(r, "Sexo", "Se"), prov))
    return out


# ---------- Bases de datos SQLite (misma estructura que RondaSwiss) ----------
def write_fide_db(path, rows, full):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    db = sqlite3.connect(path)
    db.executescript(FIDE_TABLE)
    # pid, nombre, fed, titulo, nacimiento, std, rapid, blitz, sexo
    db.executemany(
        "INSERT INTO jugadores_fide (nombre, federacion, titulo, anio_nacimiento, elo_standard, elo_blitz, elo_rapid, fide_id, sexo)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        [(r[1], r[2], r[3] or None, opt(r[4]) if full else None, opt(r[5]), opt(r[7]), opt(r[6]), r[0], (r[8] or None) if full else None)
         for r in rows])
    db.execute("INSERT OR REPLACE INTO app_settings (clave, valor) VALUES ('jugadores_fide_tipo', 'Completo')")
    db.execute("INSERT OR REPLACE INTO app_settings (clave, valor) VALUES ('jugadores_fide_actualizado', ?)", (now_iso(),))
    db.executescript(FIDE_INDEXES)
    db.commit()
    db.execute("VACUUM")
    db.close()


def write_fada_db(path, rows, full):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    db = sqlite3.connect(path)
    db.executescript(FADA_TABLE)
    db.executemany(
        "INSERT INTO jugadores_fada (nombre, club, federado, titulo, anio_nacimiento, elo_fada, fide_id, sexo, provincia)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        [(r[0], r[1] or None, r[2], r[3] or None, opt(r[4]) if full else None, opt(r[5]), opt(r[6]), (r[7] or None) if full else None, r[8] or None)
         for r in rows])
    db.execute("INSERT OR REPLACE INTO app_settings (clave, valor) VALUES ('jugadores_fada_actualizado', ?)", (now_iso(),))
    db.executescript(FADA_INDEXES)
    db.commit()
    db.execute("VACUUM")
    db.close()


def surname_letter(name):
    base = norm(name.split(",")[0]) or norm(name)
    return base[:1] if base[:1].isalpha() else "_"


def build_full(db_dir, all_countries):
    article = fada_latest()
    print("FIDE: descargando lista completa…")
    fide = read_fide(None if all_countries else {FIDE_COUNTRY})
    print(f"  jugadores FIDE: {len(fide)}")
    print("FADA: descargando", article)
    fada = fada_rows(read_fada_raw(article))
    print(f"  jugadores FADA: {len(fada)}")
    write_fide_db(db_dir / FIDE_DB, fide, full=True)
    write_fada_db(db_dir / FADA_DB, fada, full=True)
    print(f"Listo (versión completa, uso privado): {db_dir}")


def build_public():
    article = fada_latest()
    stamp = fide_stamp()
    print("FIDE: descargando lista completa…")
    fide_all = read_fide({FIDE_COUNTRY})
    fide = [r for r in fide_all if r[5] or r[6] or r[7]]  # solo con algún rating
    print(f"  jugadores {FIDE_COUNTRY}: {len(fide_all)} ({len(fide)} con rating)")
    print("FADA: descargando", article)
    fada_all = fada_rows(read_fada_raw(article))
    fada = [r for r in fada_all if r[5]]  # solo con Elo FADA
    print(f"  jugadores FADA: {len(fada_all)} ({len(fada)} con Elo)")

    OUT.mkdir(parents=True, exist_ok=True)
    write_fide_db(OUT / FIDE_DB, fide, full=False)
    write_fada_db(OUT / FADA_DB, fada, full=False)

    # Buscador de la web: una sola entrada por persona (se unen por número FIDE)
    people = {}
    for pid, name, _, title, _, s, rapid, blitz, _ in fide:
        people[pid] = {"n": name, "id": pid, "t": title, "s": s, "r": rapid, "b": blitz, "f": 0, "p": ""}
    for i, (name, club, fed, title, _, elo, pid, _, prov) in enumerate(fada):
        rec = people.setdefault(pid or "f%d" % i, {"n": name, "id": pid, "t": title, "s": 0, "r": 0, "b": 0, "f": 0, "p": ""})
        rec["f"], rec["p"] = elo, prov

    shards = {}
    for rec in people.values():
        shards.setdefault(surname_letter(rec["n"]), []).append(
            [rec["n"], rec["id"], rec["t"], rec["s"], rec["r"], rec["b"], rec["f"], rec["p"]])
    for old in OUT.glob("*.json"):
        old.unlink()
    for letter, items in shards.items():
        items.sort(key=lambda x: norm(x[0]))
        (OUT / f"{letter}.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    periodo = re.search(r"elo-fada-([a-z]+-\d{4})", article)
    meta = {
        "fada_article": article,
        "fada_periodo": periodo.group(1).replace("-", " ") if periodo else "",
        "fide_stamp": stamp,
        "construido": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "jugadores": len(people),
        "letras": sorted(shards),
        "bases_de_datos": {
            FIDE_DB: {"tabla": "jugadores_fide", "filas": len(fide), "bytes": (OUT / FIDE_DB).stat().st_size},
            FADA_DB: {"tabla": "jugadores_fada", "filas": len(fada), "bytes": (OUT / FADA_DB).stat().st_size},
        },
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print(f"Listo: {len(people)} jugadores en {len(shards)} ficheros + 2 bases SQLite -> {OUT}")


def main():
    args = sys.argv[1:]
    if "--full" in args:
        db_dir = Path(args[args.index("--db-dir") + 1]) if "--db-dir" in args else ROOT / "build" / "full"
        build_full(db_dir, "--all-countries" in args)
        return
    if "--force" not in args:
        rebuild, why = needs_rebuild(OUT / "meta.json")
        print("Comprobación:", why)
        if not rebuild:
            return
    build_public()


if __name__ == "__main__":
    main()
