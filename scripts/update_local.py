"""Torneos de ajedrez de Andalucía (por provincias) -> data/torneos-locales.json. Solo biblioteca estándar.

Fuentes (todo automático):
  - Info64 (info64.org): torneos de España que no han empezado o se están jugando.
  - Chess-Results (chess-results.com): torneos recientes de la federación ESP; el «Lugar» de cada ficha trae la provincia.
La provincia de las ciudades de Info64 se averigua con OpenStreetMap (Nominatim) y se guarda en scripts/.cache/geo.json.

Uso:  python scripts/update_local.py
"""
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from html import unescape
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


def detalle_info64(t):
    try:
        h = get(t["url"], 25)
    except Exception:
        return
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
        out.append({"source": "Chess-Results", "url": u, "name": nombre, "city": ciudad or lugar, "province": prov, "start": ini, "end": fin,
                    "tc": ritmo(datos.get("Control de tiempo (Standard)", "") or datos.get("Time control (Standard)", "")),
                    "rounds": datos.get("Número de rondas", "") or datos.get("Number of rounds", ""),
                    "organizer": datos.get("Organizador", "") or datos.get("Organizer(s)", "")})
        time.sleep(0.3)
    return out


def main():
    hoy = date.today().isoformat()
    geo = carga_geo(); gastadas = [0]
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
            detalle_info64(t)
    lista.sort(key=lambda x: (x["start"], x["name"]))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "tournaments": lista}, ensure_ascii=False, indent=1), encoding="utf-8")
    por_prov = {}
    for t in lista:
        por_prov[t["province"]] = por_prov.get(t["province"], 0) + 1
    print(f"{len(lista)} torneos andaluces guardados en {OUT} {por_prov} (ciudades consultadas ahora: {gastadas[0]})")


if __name__ == "__main__":
    main()
