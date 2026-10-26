"""Actualiza el Elo de FIDE desde este equipo y lo sube a GitHub.

GitHub no siempre consigue conectar con ratings.fide.com, pero este equipo sí. Esta tarea (programada en
Windows, ver scripts/instalar_tarea_fide.ps1) comprueba cada día si FIDE ha publicado una lista nueva y,
solo entonces, guarda una instantánea (nombre, federación, título y ratings de los jugadores de España) en
scripts/snapshots/fide_esp.json.gz y la sube. GitHub la usa para reconstruir la base de datos de FIDE.

Uso manual:  python scripts/update_fide_local.py
El registro queda en scripts/.cache/update_fide_local.log
"""
import subprocess
import sys
import traceback
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "scripts" / ".cache" / "update_fide_local.log"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_elo  # noqa: E402


def log(msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} falló: {(r.stderr or r.stdout).strip()}")
    return r.stdout.strip()


def main():
    log("Comprobando la lista de FIDE…")
    git("pull", "--rebase", "--autostash")
    if not build_elo.export_fide_snapshot():
        log("Sin novedades: la instantánea ya está al día.")
        return
    git("add", str(build_elo.SNAPSHOT.relative_to(ROOT)))
    if not git("status", "--porcelain", "--", str(build_elo.SNAPSHOT.relative_to(ROOT))):
        log("La instantánea no cambió.")
        return
    snap = build_elo.load_fide_snapshot()
    git("commit", "-m", f"Actualiza el Elo de FIDE (lista del {snap['generado']})")
    git("push", "origin", "HEAD")
    log(f"Subida a GitHub: {len(snap['filas'])} jugadores. GitHub reconstruirá la base de FIDE en unos minutos.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("ERROR:\n" + traceback.format_exc())
        sys.exit(1)
