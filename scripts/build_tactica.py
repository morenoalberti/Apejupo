"""Genera la coleccion de problemas "Apejupo 5000" para la pagina Tactica, en data/tactica/<categoria>.json.

Fuente: base de problemas abiertos de Lichess (licencia CC0, dominio publico):
  https://database.lichess.org/#puzzles  ->  lichess_db_puzzle.csv.zst  (unos 300 MB, ~4 millones de problemas)

El fichero se lee en streaming y se detiene en cuanto todas las categorias estan completas, asi que normalmente
solo se descarga una parte. Cada categoria reparte sus problemas a partes iguales entre tramos de dificultad.

Uso:
  python scripts/build_tactica.py                  descarga en streaming desde Lichess
  python scripts/build_tactica.py --source FICHERO usa un lichess_db_puzzle.csv.zst (o .csv) ya descargado

Requiere: pip install zstandard python-chess

Formato de cada problema (claves cortas para pesar poco):
  i  identificador de Lichess        f  FEN tras la primera jugada del rival (posicion que ve el usuario)
  l  esa jugada del rival (UCI)      s  solucion: jugadas UCI alternando usuario / rival
  r  dificultad (Elo del problema)
"""
import argparse
import csv
import io
import json
import os
import sys
import urllib.request

import chess

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tactica")

# categoria -> (titulo, descripcion, cantidad, temas que debe tener (cualquiera), temas prohibidos)
MATES = {"mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5", "mate"}
CATEGORIAS = {
    "mate1": ("Mate en 1", "Encuentra el mate en una jugada.", 300, {"mateIn1"}, set()),
    "mate2": ("Mate en 2", "Mate forzado en dos jugadas.", 3400, {"mateIn2"}, set()),
    "mate3": ("Mate en 3", "Mate forzado en tres jugadas.", 750, {"mateIn3"}, set()),
    "finales": ("Finales", "Técnica de final: peones, torres y piezas menores.", 150, {"endgame"}, MATES),
    "combinaciones": (
        "Combinaciones", "Horquillas, clavadas, ataques descubiertos y más.", 400,
        {"fork", "pin", "skewer", "discoveredAttack", "deflection", "attraction", "sacrifice", "doubleCheck"}, MATES),
}
# Temas sueltos para las tarjetas "Entrena por temas": id de Lichess -> titulo. Se guardan como t-<id>.json
TEMAS = {
    "backRankMate": "Mate del pasillo", "smotheredMate": "Mate ahogado", "fork": "Horquilla", "pin": "Clavada",
    "skewer": "Enfilada", "discoveredAttack": "Ataque descubierto", "hangingPiece": "Pieza colgada",
    "sacrifice": "Sacrificio", "deflection": "Desviación", "attraction": "Atracción", "zugzwang": "Zugzwang",
    "trappedPiece": "Pieza atrapada", "clearance": "Despejar", "promotion": "Promoción",
    "advancedPawn": "Peón avanzado", "quietMove": "Jugada tranquila", "opening": "Apertura", "middlegame": "Medio juego",
}
POR_TEMA = 150
for _t, _n in TEMAS.items():
    CATEGORIAS["t-" + _t] = (_n, "", POR_TEMA, {_t}, set())
TRAMOS = [(0, 800), (800, 1200), (1200, 1600), (1600, 2000), (2000, 2400), (2400, 4000)]
MIN_JUGADAS_MAX = 12  # descarta problemas de solucion larguisima
POPULARIDAD_MIN = 80
DESVIACION_MAX = 90
JUGADAS_MIN_PARTIDAS = 300


def tramo(r):
    for k, (a, b) in enumerate(TRAMOS):
        if a <= r < b:
            return k
    return len(TRAMOS) - 1


def abrir(source):
    if source and not source.startswith("http"):
        raw = open(source, "rb")
    else:
        print("Descargando en streaming de", source or URL, file=sys.stderr)
        raw = urllib.request.urlopen(urllib.request.Request(source or URL, headers={"User-Agent": "apejupo-tactica"}))
    if (source or URL).endswith(".zst"):
        import zstandard
        raw = zstandard.ZstdDecompressor().stream_reader(raw)
    return io.TextIOWrapper(raw, encoding="utf-8", newline="")


def convertir(row):
    """Aplica la primera jugada (la del rival) y devuelve el problema en formato compacto."""
    jugadas = row["Moves"].split()
    if len(jugadas) < 2 or len(jugadas) > MIN_JUGADAS_MAX:
        return None
    tablero = chess.Board(row["FEN"])
    try:
        tablero.push_uci(jugadas[0])
    except ValueError:
        return None
    return {"i": row["PuzzleId"], "f": tablero.fen(), "l": jugadas[0], "s": jugadas[1:], "r": int(row["Rating"])}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", help="fichero o URL de lichess_db_puzzle.csv(.zst)")
    args = ap.parse_args()

    cupo = {c: -(-v[2] // len(TRAMOS)) for c, v in CATEGORIAS.items()}  # por tramo, redondeo hacia arriba
    datos = {c: [[] for _ in TRAMOS] for c in CATEGORIAS}
    vistos = 0

    for row in csv.DictReader(abrir(args.source)):
        vistos += 1
        if int(row["Popularity"]) < POPULARIDAD_MIN or int(row["RatingDeviation"]) > DESVIACION_MAX \
                or int(row["NbPlays"]) < JUGADAS_MIN_PARTIDAS:
            continue
        temas = set(row["Themes"].split())
        k = tramo(int(row["Rating"]))
        problema = None
        for cat, (_, _, _, quiero, evito) in CATEGORIAS.items():
            if len(datos[cat][k]) >= cupo[cat] or not (temas & quiero) or (temas & evito):
                continue
            if problema is None:
                problema = convertir(row)
                if problema is None:
                    break
            datos[cat][k].append(problema)
        if vistos % 200000 == 0:
            faltan = sum(cupo[c] - len(datos[c][k]) for c in CATEGORIAS for k in range(len(TRAMOS)))
            print(f"  {vistos:,} filas leidas, faltan {faltan} huecos", file=sys.stderr)
            if faltan == 0:
                break
    else:
        print("Fin del fichero antes de llenar todos los cupos.", file=sys.stderr)

    os.makedirs(OUT, exist_ok=True)
    indice, temas = [], []
    for cat, (titulo, desc, total, _, _) in CATEGORIAS.items():
        lista = sorted((p for t in datos[cat] for p in t), key=lambda p: p["r"])[:total]
        with open(os.path.join(OUT, cat + ".json"), "w", encoding="utf-8") as f:
            json.dump(lista, f, ensure_ascii=False, separators=(",", ":"))
        (temas if cat.startswith("t-") else indice).append({
            "id": cat, "titulo": titulo, "desc": desc, "n": len(lista),
            "min": lista[0]["r"] if lista else 0, "max": lista[-1]["r"] if lista else 0})
        print(f"{cat}: {len(lista)} problemas", file=sys.stderr)
    with open(os.path.join(OUT, "indice.json"), "w", encoding="utf-8") as f:
        json.dump({"fuente": "Lichess (CC0)", "categorias": indice, "temas": temas}, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
