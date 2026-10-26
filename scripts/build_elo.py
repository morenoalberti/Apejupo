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
import gzip
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
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
FIDE_ZIP = "https://ratings.fide.com/download/players_list_xml.zip"  # lista completa (uso privado, --full)
FIDE_ZIPS = {  # listas por ritmo, más ligeras y fiables desde GitHub (modo público)
    "std": "https://ratings.fide.com/download/standard_rating_list_xml.zip",
    "rpd": "https://ratings.fide.com/download/rapid_rating_list_xml.zip",
    "blz": "https://ratings.fide.com/download/blitz_rating_list_xml.zip",
}
FIDE_COUNTRY = "ESP"
FADA_CATEGORY = "https://fadajedrez.com/wp/category/elo/"
SNAPSHOT = ROOT / "scripts" / ".cache" / "fide_all.json.gz"  # la genera este equipo (update_fide_local.py)
SNAPSHOT_CI = ROOT / "fide-data" / "fide_all.json.gz"          # copia que GitHub recupera de la rama fide-data
FORMATO = 2   # súbelo si cambia la forma de las bases o de los ficheros de data/elo: fuerza a reconstruirlos
TOP_N = 1000  # jugadores de las listas iniciales ya calculadas (top_fide.json y top_fada.json)
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
    """Huella de la lista de FIDE (fecha y tamaño). Devuelve "" si FIDE no responde: la comprobación no falla."""
    for method, extra in (("HEAD", {}), ("GET", {"Range": "bytes=0-0"})):
        try:
            req = request(FIDE_ZIPS["std"], method)
            for k, v in extra.items():
                req.add_header(k, v)
            with urllib.request.urlopen(req, timeout=15) as r:
                size = r.headers.get("Content-Range", "").split("/")[-1] or r.headers.get("Content-Length", "")
                return r.headers.get("Last-Modified", "") + "|" + size
        except Exception as e:
            print(f"  aviso: no se pudo consultar FIDE ({method}): {e}")
    return ""


# ---------- Instantánea de FIDE (se genera en el equipo del usuario y se sube a GitHub) ----------
# GitHub no siempre consigue conectar con ratings.fide.com. Desde un equipo normal sí, así que una tarea
# programada allí guarda una instantánea de los ratings (solo nombre, federación, título y ratings) y la sube.
def load_fide_snapshot():
    """Devuelve {"stamp", "generado", "filas"} o None si no hay instantánea."""
    for path in (os.environ.get("FIDE_SNAPSHOT"), SNAPSHOT_CI, SNAPSHOT):
        if path and Path(path).exists():
            try:
                with gzip.open(path, "rt", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"  aviso: instantánea de FIDE ilegible ({path}): {e}")
    return None


def export_fide_snapshot(force=False):
    """Descarga las listas de FIDE (desde un equipo que sí llegue) y guarda la instantánea. True si hay cambios."""
    stamp = fide_stamp()
    if not stamp:
        raise RuntimeError("No se pudo consultar FIDE desde este equipo")
    snap = load_fide_snapshot()
    if snap and snap.get("stamp") == stamp and not force:
        print("Instantánea de FIDE al día:", stamp)
        return False
    print("FIDE: descargando la lista completa (todos los países)…")
    rows = read_fide(None)
    filas = [[r[0], r[1], r[2], r[3], r[5], r[6], r[7]] for r in rows]  # sin año de nacimiento ni sexo
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(SNAPSHOT, "wt", encoding="utf-8") as f:
        json.dump({"stamp": stamp, "generado": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "filas": filas},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"Instantánea guardada: {len(filas)} jugadores ({SNAPSHOT.stat().st_size // 1024} KB), huella {stamp}")
    return True


def snapshot_rows(snap):
    """Convierte la instantánea al formato de read_fide_lists."""
    return [(p, n, fed, t, 0, s, r, b, "") for p, n, fed, t, s, r, b in snap["filas"]]


def needs_rebuild(meta_path):
    if not meta_path.exists() or not (OUT / FIDE_DB).exists() or not (OUT / FADA_DB).exists():
        return True, "no hay datos previos"
    old = json.loads(meta_path.read_text(encoding="utf-8"))
    if old.get("fide_alcance") != "mundial" or old.get("formato") != FORMATO:
        return True, "cambió el formato de las bases de datos"
    if old.get("fada_article") != fada_latest():
        return True, "la FADA ha publicado una lista nueva"
    snap = load_fide_snapshot()
    stamp = fide_stamp()
    if snap and old.get("fide_stamp") != snap["stamp"] and (not stamp or stamp == snap["stamp"]):
        return True, "hay una instantánea de FIDE nueva"
    if stamp and old.get("fide_stamp") != stamp and not snap and datetime.now(timezone.utc).day <= 7:
        return True, "FIDE ha actualizado su lista"
    return False, "sin novedades"


# ---------- FIDE ----------
def read_fide(countries):
    """Filas (fide_id, nombre, federacion, titulo, anio_nacimiento, std, rapid, blitz, sexo)."""
    rows = []
    with tempfile.TemporaryFile() as tmp:
        with urllib.request.urlopen(request(FIDE_ZIP), timeout=60) as r:
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


def _read_list(url, countries):
    """{fide_id: (nombre, federacion, titulo, rating)} de una lista FIDE por ritmo."""
    out = {}
    with tempfile.TemporaryFile() as tmp:
        with urllib.request.urlopen(request(url), timeout=30) as r:
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
                    title = (el.findtext("title") or el.findtext("foa_title") or "").strip()
                    out[to_int(el.findtext("fideid"))] = (
                        (el.findtext("name") or "").strip(), fed,
                        "" if title.lower() in ("none", "ninguno", "-") else title, to_int(el.findtext("rating")))
                el.clear()
    return out


def read_fide_lists(countries):
    """Como read_fide, pero con las tres listas por ritmo. No trae año de nacimiento ni sexo
    (la versión pública no los publica)."""
    lists = {}
    for kind, url in FIDE_ZIPS.items():
        for attempt in range(2):
            try:
                lists[kind] = _read_list(url, countries)
                break
            except Exception as e:  # reintenta una vez si la conexión falla
                print(f"  reintento de la lista {kind}: {e}")
                if attempt == 1:
                    raise
                time.sleep(5)
    rows = []
    for pid in set(lists["std"]) | set(lists["rpd"]) | set(lists["blz"]):
        base = lists["std"].get(pid) or lists["rpd"].get(pid) or lists["blz"].get(pid)
        if pid and base[0]:
            rows.append((pid, base[0], base[1], base[2], 0,
                         lists["std"].get(pid, ("", "", "", 0))[3], lists["rpd"].get(pid, ("", "", "", 0))[3],
                         lists["blz"].get(pid, ("", "", "", 0))[3], ""))
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
def write_fide_db(path, rows, full, web=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    db = sqlite3.connect(path)
    db.executescript(FIDE_TABLE)
    if web:
        # Se guardan ordenados por nombre: la búsqueda por nombre de la web lee un único trozo contiguo del fichero
        # (los id cambian respecto a RondaSwiss, la estructura no). La lista inicial (más Elo) va aparte, ya calculada.
        rows = sorted(rows, key=lambda r: (r[1].lower(), r[0]))
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
    print("FADA: descargando", article)
    fada_all = fada_rows(read_fada_raw(article))
    fada = [r for r in fada_all if r[5]]  # con Elo FADA (para el buscador rápido)
    print(f"  jugadores FADA: {len(fada_all)} ({len(fada)} con Elo)")
    OUT.mkdir(parents=True, exist_ok=True)

    # FIDE (todos los países, como RondaSwiss). Prioridad: 1) la instantánea subida desde el equipo del usuario,
    # si está al día con FIDE o FIDE no responde; 2) descarga directa de la lista completa.
    snap = load_fide_snapshot()
    fide_all, fide_origen = None, ""
    if snap and (not stamp or snap.get("stamp") == stamp):
        fide_all, stamp, fide_origen = snapshot_rows(snap), snap["stamp"], "instantánea del " + snap["generado"]
    if fide_all is None:
        print("FIDE: descargando la lista completa…")
        try:
            fide_all, fide_origen = read_fide(None), "descarga directa"
        except Exception as e:  # FIDE no responde (a veces bloquea las conexiones desde GitHub)
            if snap:
                print(f"AVISO: FIDE no responde desde aquí ({e}). Se usa la instantánea del {snap['generado']}.")
                fide_all, stamp, fide_origen = snapshot_rows(snap), snap["stamp"], "instantánea del " + snap["generado"]
            else:
                print(f"AVISO: no se pudo descargar FIDE desde aquí ({e}) y no hay instantánea. Se publica solo la FADA y se reintentará.")
                write_fada_db(OUT / FADA_DB, fada_all, full=False)
                meta_path = OUT / "meta.json"
                meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
                periodo = re.search(r"elo-fada-([a-z]+-\d{4})", article)
                meta.update({"fada_article": article, "fada_periodo": periodo.group(1).replace("-", " ") if periodo else "",
                             "construido": datetime.now(timezone.utc).strftime("%Y-%m-%d")})
                meta.setdefault("bases_de_datos", {})[FADA_DB] = {
                    "tabla": "jugadores_fada", "filas": len(fada_all), "bytes": (OUT / FADA_DB).stat().st_size}
                meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
                print("Listo (parcial): base de datos de la FADA publicada; falta la de FIDE.")
                return
    print(f"  jugadores FIDE: {len(fide_all)} ({fide_origen})")

    # Bases de datos con la estructura de RondaSwiss: todos los jugadores (también los que no tienen rating)
    write_fide_db(OUT / FIDE_DB, fide_all, full=False, web=True)
    write_fada_db(OUT / FADA_DB, fada_all, full=False)

    for old in OUT.glob("?.json"):  # restos del buscador rápido anterior (a.json … z.json), que ya no se usa
        old.unlink()

    # Listas iniciales ya calculadas (las TOP_N con más Elo): se muestran al instante, sin consultar la base de datos
    fide_top = sorted((r for r in fide_all if r[5]), key=lambda r: (-r[5], r[0]))[:TOP_N]
    (OUT / "top_fide.json").write_text(json.dumps(
        [[r[0], r[1], r[2], r[3], r[5], r[6], r[7]] for r in fide_top], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fada_top = sorted((r for r in fada_all if r[5]), key=lambda r: (-r[5], r[0]))[:TOP_N]
    (OUT / "top_fada.json").write_text(json.dumps(
        [[r[0], r[1], r[2], r[3], r[5], r[6], r[8]] for r in fada_top], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    periodo = re.search(r"elo-fada-([a-z]+-\d{4})", article)
    meta = {
        "fada_article": article,
        "fada_periodo": periodo.group(1).replace("-", " ") if periodo else "",
        "fide_stamp": stamp,
        "fide_origen": fide_origen,
        "fide_alcance": "mundial",
        "formato": FORMATO,
        "top": TOP_N,
        "construido": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "bases_de_datos": {
            FIDE_DB: {"tabla": "jugadores_fide", "filas": len(fide_all), "bytes": (OUT / FIDE_DB).stat().st_size},
            FADA_DB: {"tabla": "jugadores_fada", "filas": len(fada_all), "bytes": (OUT / FADA_DB).stat().st_size},
        },
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print(f"Listo: {len(fide_all)} jugadores FIDE y {len(fada_all)} FADA en las bases -> {OUT}")


def main():
    args = sys.argv[1:]
    if "--export-fide" in args:
        # Se ejecuta en el equipo del usuario: guarda scripts/snapshots/fide_esp.json.gz si FIDE tiene lista nueva.
        export_fide_snapshot(force="--force" in args)
        return
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
