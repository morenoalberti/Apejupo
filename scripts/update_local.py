"""Torneos de ajedrez de Andalucía (por provincias) -> data/torneos-locales.json.
Dependencias para extraer las bases PDF: pip install -r scripts/requirements-local.txt.

Fuentes (todo automático):
  - Info64 (info64.org): torneos de España que no han empezado o se están jugando.
  - Chess-Results (chess-results.com): torneos recientes de la federación ESP; el «Lugar» de cada ficha trae la provincia.
La provincia de las ciudades de Info64 se averigua con OpenStreetMap (Nominatim) y se guarda en scripts/.cache/geo.json.

Uso:  python scripts/update_local.py
"""
import json
import hashlib
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "data" / "torneos-locales.json"
GEO = ROOT / ".cache" / "geo.json"
UA = "Mozilla/5.0 (compatible; ApejupoChessClub/1.0; web del club)"
PROVINCIAS = ["Almería", "Cádiz", "Córdoba", "Granada", "Huelva", "Jaén", "Málaga", "Sevilla"]
MAX_GEO_POR_EJECUCION = 150  # Nominatim pide máximo 1 consulta por segundo: el resto queda para la siguiente ejecución


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def limpia(s):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def norm(s):
    s = unescape(s or "").lower()
    for a, b in zip("áàäâéèëêíìïîóòöôúùüûñ", "aaaaeeeeiiiioooouuuun"):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


class FichaEnlaces(HTMLParser):
    """Enlaces publicados y texto de «Información adicional» de Info64."""
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.anchor = None
        self.label = []
        self.depth = 0
        self.description = []
        self.description_links = []
        self.description_images = []
        self.group_depth = 0
        self.group_links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.group_depth:
            if tag not in self.VOID:
                self.group_depth += 1
        elif attrs.get("id") == "tournament-selection-nav":
            self.group_depth = 1
        if self.depth:
            if tag not in self.VOID:
                self.depth += 1
            if tag in {"br", "p", "div", "li", "tr", "h2", "h3", "h4"}:
                self.description.append("\n")
        elif attrs.get("id") == "collapseText":
            self.depth = 1
        if tag == "a":
            self.anchor = attrs
            self.label = []
            self.anchor_in_description = bool(self.depth)
            self.anchor_in_group = bool(self.group_depth)
        elif tag == "img" and self.anchor is not None:
            self.label.append(attrs.get("alt", ""))
        if tag == "img" and self.depth and attrs.get("src"):
            self.description_images.append((attrs["src"], attrs.get("alt", "")))

    def handle_data(self, text):
        if self.depth:
            self.description.append(text)
        if self.anchor is not None:
            self.label.append(text)

    def handle_endtag(self, tag):
        if self.depth and tag not in self.VOID:
            self.depth -= 1
        if self.group_depth and tag not in self.VOID:
            self.group_depth -= 1
        if tag == "a" and self.anchor is not None:
            link = (self.anchor.get("href") or "", " ".join(self.label), self.anchor.get("title") or "")
            self.links.append(link)
            if self.anchor_in_description:
                self.description_links.append(link)
            if self.anchor_in_group:
                self.group_links.append(link)
            self.anchor = None


def enlaces_ficha(t, html):
    """Solo usar enlaces reales de la ficha; nunca confundir la web genérica con las bases."""
    parsed = FichaEnlaces()
    parsed.feed(html)
    candidates = []
    for href, label, title in parsed.links:
        if not href.strip() or href.startswith("#"):
            continue
        url = urllib.parse.urljoin(t["url"], href.strip())
        if urllib.parse.urlsplit(url).scheme not in {"http", "https"}:
            continue
        text = norm(label)
        same_source = urllib.parse.urlsplit(url).hostname == urllib.parse.urlsplit(t["url"]).hostname
        if same_source and text in {"ranking inicial", "ranking inicial de los equipos", "starting rank", "starting rank list", "equipos", "inscritos"}:
            candidates.append(url)
        if same_source and text in {"composicion", "listado de jugadores por ranking inicial", "player overview by rating"}:
            t["players_url"] = url
        reference = norm(label + " " + title + " " + urllib.parse.unquote(urllib.parse.urlsplit(url).path))
        if re.search(r"\b(?:bases|reglamento|normativa|regulations|tournament rules|prospectus)\b", reference):
            t.setdefault("rules_url", url)
    t["participants_url"] = candidates[0] if candidates else t["url"]
    description = re.sub(r"[^\S\n]+", " ", "".join(parsed.description))
    description = re.sub(r"\n *\n(?: *\n)+", "\n\n", description).strip()
    def resource_url(href):
        url = urllib.parse.urljoin(t["url"], href.strip())
        return url if href.strip() and not href.startswith("#") and urllib.parse.urlsplit(url).scheme in {"http", "https"} else ""
    if urllib.parse.urlsplit(t["url"]).hostname == "info64.org":
        # «Información adicional» es contenido publicado por el organizador, aunque
        # sea breve, esté en otro idioma o no contenga la palabra «bases».
        if description:
            t["rules_text"] = description
            t["rules_source"] = t["url"]
            t["rules_kind"] = "additional"
        links = [{"url": resource_url(href), "label": limpia(label) or limpia(title) or "Consultar documento"} for href, label, title in parsed.description_links if resource_url(href)]
        images = [{"url": resource_url(src), "label": limpia(alt)} for src, alt in parsed.description_images if resource_url(src)]
        if links:
            t["rules_links"] = links
        if images:
            t["rules_images"] = images
        if links or images:
            t["rules_source"] = t["url"]
            t["rules_kind"] = "additional"
        related = [resource_url(href) for href, _, _ in parsed.group_links if resource_url(href) and urllib.parse.urlsplit(resource_url(href)).hostname == "info64.org"]
        if related:
            t["related_tournaments"] = list(dict.fromkeys(related))
    rule_sections = re.findall(r"^\s*\d{1,2}[.)]+\s*[-–]?\s*(?:participantes|inscripci[oó]n(?:es)?|sistema|ritmo|horario|lugar|fecha|premios|desempates|condiciones|organizaci[oó]n|caracter[ií]sticas|categor[ií]as)\b", description, re.I | re.M)
    explicit_rules = re.search(r"\b(?:bases|reglamento|normativa|tournament rules|regulations)\b", norm(description))
    if len(description) > 120 and (explicit_rules or len(rule_sections) >= 3):
        t["rules_text"] = description
        t["rules_source"] = t["url"]


def bases_relacionadas(tournaments):
    """Conservar los recursos de las modalidades enlazadas por el propio festival.

    No se presentan como reglamento del torneo actual: se mantiene el nombre y
    la fuente de cada modalidad, y nunca se agrupan por parecido del nombre.
    """
    indexed = {t["url"]: t for t in tournaments}
    fields = ("rules_url", "rules_text", "rules_source", "rules_document", "rules_blocks", "rules_kind", "rules_links", "rules_images")
    for t in tournaments:
        related = []
        for url in t.get("related_tournaments", []):
            other = indexed.get(url)
            if not other or url == t["url"] or not any(other.get(key) for key in ("rules_url", "rules_text", "rules_document", "rules_blocks", "rules_links", "rules_images")):
                continue
            related.append({"name": other["name"], "url": url, "source": other["source"], **{key: other[key] for key in fields if key in other}})
        if related:
            t["rules_related"] = related
        else:
            t.pop("rules_related", None)


class TablasInscritos(HTMLParser):
    """Lee las tablas completas, incluidas las composiciones de equipos."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            table = {"rows": [], "caption": "", "row": None, "cell": None, "in_caption": False}
            self.tables.append(table)
            self.stack.append(table)
        if not self.stack:
            return
        t = self.stack[-1]
        if tag == "caption": t["in_caption"] = True
        if tag == "tr": t["row"] = []
        if tag in {"td", "th"}: t["cell"] = ""

    def handle_data(self, data):
        if self.stack:
            t = self.stack[-1]
            if t["cell"] is not None: t["cell"] += data
            if t["in_caption"]: t["caption"] += data

    def handle_endtag(self, tag):
        if not self.stack:
            return
        t = self.stack[-1]
        if tag in {"td", "th"} and t["cell"] is not None:
            if t["row"] is not None: t["row"].append(limpia(t["cell"]))
            t["cell"] = None
        if tag == "tr" and t["row"] is not None:
            t["rows"].append(t["row"])
            t["row"] = None
        if tag == "caption": t["in_caption"] = False
        if tag == "table": self.stack.pop()


def inscritos_html(html):
    parsed = TablasInscritos()
    parsed.feed(html)
    players, seen = [], {}
    titles = {"GM", "IM", "FM", "CM", "WGM", "WIM", "WFM", "WCM"}
    for table in parsed.tables:
        columns = None
        for row in table["rows"]:
            headers = [norm(c) for c in row]
            if "nombre" in headers or "name" in headers:
                columns = headers if any(c in headers for c in {"fide", "elo", "rtg", "rtg int", "elo fide", "rating"}) else None
                continue
            if columns is None or len(row) != len(columns):
                continue
            def cell(*names):
                return next((row[columns.index(n)] for n in names if n in columns), "")
            name = cell("nombre", "name")
            # El Elo medio de un equipo no es el Elo de un jugador.
            rating = cell("fide", "elo", "rtg", "rtg int", "elo fide", "rating")
            if not name or not re.fullmatch(r"\d{1,4}", rating or "0"):
                continue
            fide_id = cell("fide id", "fideid")
            title = next((c for c in row[:columns.index("nombre") if "nombre" in columns else columns.index("name")] if c in titles), "")
            key = fide_id if fide_id and fide_id != "0" else norm(name)
            team = cell("equipo", "team") or limpia(table["caption"])
            if key in seen:
                # Un jugador puede estar incluido en varios equipos del mismo club.
                previous = seen[key]
                if team and team not in previous.get("team", "").split(" / "):
                    previous["team"] = " / ".join(filter(None, [previous.get("team"), team]))
                continue
            player = {"name": name, "title": title, "country": cell("fed", "federacion"), "elo": int(rating or 0)}
            club = cell("origen club", "club", "club ciudad", "club city", "club location", "club ciudad nombre")
            if club: player["club"] = club
            if team: player["team"] = team
            seen[key] = player
            players.append(player)
    return sorted(players, key=lambda p: (-p["elo"], norm(p["name"])))


def inscritos_ficha(t, html):
    """Usa el listado de jugadores enlazado por la propia ficha, si lo hay."""
    players_url = t.get("players_url", t["url"])
    if players_url != t["url"]:
        try:
            html = get(players_url, 25)
        except Exception:
            return
    t["players"] = inscritos_html(html)
    t["players_url"] = players_url


def bases_ficha(t):
    """Sirve las bases PDF desde la web, incluso si la fuente fuerza una descarga."""
    url = t.get("rules_url")
    if not url:
        return
    relative = "data/bases/" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:16] + ".pdf"
    target = ROOT.parent / relative
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as response:
            document = response.read(20 * 1024 * 1024 + 1)
        if not document.startswith(b"%PDF-") or len(document) > 20 * 1024 * 1024:
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(document)
    except Exception:
        if not target.is_file():
            return
    t["rules_document"] = relative
    try:
        from rules_pdf import extract_rules_pdf
        blocks = extract_rules_pdf(target)
        if blocks:
            t["rules_blocks"] = blocks
    except Exception as error:
        print("[aviso] Extracción de bases PDF:", error)


FUERA = {"la rioja", "asturias", "navarra", "cantabria", "madrid", "cataluna", "catalunya", "aragon", "galicia", "murcia", "valencia", "euskadi", "castilla", "extremadura", "canarias", "baleares", "islas baleares"}
PROV_NORM = {norm(p): p for p in PROVINCIAS}


def provincia_de(texto):
    """Devuelve la provincia andaluza que aparezca en un texto («Granada, Spain», «Málaga», «Prov. de Sevilla»…)."""
    n = " " + norm(texto) + " "
    for k, v in PROV_NORM.items():
        if " " + k + " " in n:
            return v
    return ""


# ---------- Geocodificación con caché ----------
def carga_geo():
    try:
        return json.loads(GEO.read_text(encoding="utf-8"))
    except Exception:
        return {}


def guarda_geo(g):
    GEO.parent.mkdir(exist_ok=True)
    GEO.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")


def geocodifica(ciudad, geo, gastadas):
    """Provincia (o «» si no es andaluza / se desconoce) de una ciudad española. None = aún sin consultar."""
    k = norm(ciudad)
    if not k or k in FUERA:
        return ""
    if k in geo:
        return geo[k]
    if gastadas[0] >= MAX_GEO_POR_EJECUCION:
        return None
    gastadas[0] += 1
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"city": ciudad, "country": "Spain", "format": "json", "addressdetails": 1, "limit": 1, "accept-language": "es"})
    try:
        d = json.loads(get(url, 20))
        a = d[0]["address"] if d else {}
        prov = a.get("province") or a.get("county") or ""
        geo[k] = provincia_de(prov) if a.get("state", "").lower().startswith("andaluc") else ""
    except Exception:
        return None
    time.sleep(1.1)
    return geo[k]


# ---------- Info64 ----------
def info64():
    html = get("https://info64.org/search?name=&city=&arbiter=&ttype=1&status=1&status=2", 90)
    out = []
    for fila in re.findall(r"<tr>(.*?)</tr>", html, re.S):
        celdas = [limpia(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", fila, re.S)]
        m = re.search(r'href="(/[^"]+)"', fila)
        if len(celdas) < 7 or not m or celdas[3] != "ESP":
            continue
        out.append({"source": "Info64", "url": "https://info64.org" + m.group(1), "name": celdas[1], "city": celdas[2],
                    "status": "live" if celdas[4].lower().startswith("play") else "soon", "start": celdas[5], "end": celdas[6]})
    return out


def ritmo(tc):
    """Ritmo de juego en español y bien separado:
    «90min/40moves+30min/end+30sec increment per move starting from move 1» ->
    «90 min / 40 jugadas + 30 min / final + 30 s de incremento por jugada desde la jugada 1»."""
    t = " " + (tc or "").strip() + " "
    t = re.sub(r"(\d)\s*(?:minutes?|minutos?|mins?)\b", lambda m: m.group(1) + " min", t, flags=re.I)
    t = re.sub(r"(\d)\s*(?:seconds?|segundos?|secs?|seg)\b", lambda m: m.group(1) + " s", t, flags=re.I)
    t = re.sub(r"(\d)\s*(?:moves?|movimientos?|jugadas?)\b", lambda m: m.group(1) + " jugadas", t, flags=re.I)
    t = re.sub(r"(\d)\s*(?:hours?|horas?)\b", lambda m: m.group(1) + " h", t, flags=re.I)
    t = re.sub(r"\bstarting from move\s*(\d+)", lambda m: "desde la jugada " + m.group(1), t, flags=re.I)
    t = re.sub(r"\bstarting from\b", "desde", t, flags=re.I)
    t = re.sub(r"\bincrement\s+(?:per|each)\s+move\b|\bincrement\b|\bincremento\b", "de incremento", t, flags=re.I)
    t = re.sub(r"\b(?:per move|por movimi\w*|each move)\b", "por jugada", t, flags=re.I)
    t = re.sub(r"\bmove\b", "jugada", t, flags=re.I)
    t = re.sub(r"/\s*end\b|/\s*game\b|\bto finish\b|\bfinal de la partida\b", "/ final", t, flags=re.I)
    t = re.sub(r"\s*([/+])\s*", lambda m: " " + m.group(1) + " ", t)
    return re.sub(r"\s+", " ", t).strip()


def detalle_info64(t, previous=None):
    try:
        h = get(t["url"], 25)
    except Exception:
        # Un fallo temporal de la fuente no debe ocultar unas bases ya publicadas.
        for key, value in (previous or {}).items():
            if key.startswith("rules_") or key == "related_tournaments":
                t[key] = value
        return
    enlaces_ficha(t, h)
    inscritos_ficha(t, h)
    bases_ficha(t)
    m = re.search(r'class="rateofplay">\s*(.*?)\s*</span>', h, re.S)
    if m:
        tc = limpia(m.group(1))
        t["tc"] = ritmo(tc)


# ---------- Chess-Results ----------
def chessresults():
    out = []
    h = get("https://chess-results.com/fed.aspx?lan=2&fed=ESP", 60)
    enlaces = []
    for u in re.findall(r'href="(https://chess-results\.com/tnr\d+\.aspx\?lan=2)"', h):
        if u not in enlaces:
            enlaces.append(u)
    for u in enlaces[:60]:
        try:
            p = get(u, 30)
        except Exception:
            continue
        datos = {}
        for a, b in re.findall(r'<tr><td class="CR">(.*?)</td><td class="CR">(.*?)</td></tr>', p, re.S):
            datos[limpia(a)] = limpia(b)
        lugar = datos.get("Lugar", "") or datos.get("Venue", "")
        prov = provincia_de(lugar)
        if not prov:
            continue
        fechas = re.findall(r"(\d{4})/(\d{2})/(\d{2})", datos.get("Fecha", "") or datos.get("Date", ""))
        if not fechas:
            continue
        ini = "-".join(fechas[0]); fin = "-".join(fechas[-1])
        t = re.search(r"<h2>(.*?)</h2>", p, re.S)
        nombre = limpia(t.group(1)) if t else ""
        if not nombre:
            continue
        ciudad = re.sub(r"\s*\(.*$", "", lugar.split(",")[-2] if lugar.count(",") >= 2 else lugar).strip()
        torneo = {"source": "Chess-Results", "url": u, "name": nombre, "city": ciudad or lugar, "province": prov, "start": ini, "end": fin,
                    "tc": ritmo(datos.get("Control de tiempo (Standard)", "") or datos.get("Time control (Standard)", "")),
                    "rounds": datos.get("Número de rondas", "") or datos.get("Number of rounds", ""),
                    "organizer": datos.get("Organizador", "") or datos.get("Organizer(s)", "")}
        enlaces_ficha(torneo, p)
        inscritos_ficha(torneo, p)
        bases_ficha(torneo)
        out.append(torneo)
        time.sleep(0.3)
    return out


def main():
    hoy = date.today().isoformat()
    geo = carga_geo(); gastadas = [0]
    try:
        previous = {t["url"]: t for t in json.loads(OUT.read_text(encoding="utf-8")).get("tournaments", [])}
    except (OSError, ValueError, KeyError):
        previous = {}
    todos = []
    try:
        for t in info64():
            if t["end"] < hoy:
                continue
            prov = provincia_de(t["city"]) or geocodifica(t["city"], geo, gastadas)
            if prov:
                t["province"] = prov
                todos.append(t)
    except Exception as e:
        print("[aviso] Info64:", e)
    guarda_geo(geo)
    try:
        for t in chessresults():
            if t["end"] >= hoy:
                todos.append(t)
    except Exception as e:
        print("[aviso] Chess-Results:", e)
    # sin repetidos (el mismo torneo puede estar en las dos fuentes): mismo nombre normalizado y misma fecha de inicio
    vistos, lista = {}, []
    for t in sorted(todos, key=lambda x: (x["source"] != "Chess-Results", x["start"])):
        clave = (norm(t["name"]), t["start"])
        if clave in vistos:
            continue
        vistos[clave] = 1
        lista.append(t)
    for t in lista:
        if t["source"] == "Info64":
            detalle_info64(t, previous.get(t["url"]))
    bases_relacionadas(lista)
    lista.sort(key=lambda x: (x["start"], x["name"]))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "tournaments": lista}, ensure_ascii=False, indent=1), encoding="utf-8")
    por_prov = {}
    for t in lista:
        por_prov[t["province"]] = por_prov.get(t["province"], 0) + 1
    print(f"{len(lista)} torneos andaluces guardados en {OUT} {por_prov} (ciudades consultadas ahora: {gastadas[0]})")


if __name__ == "__main__":
    main()
