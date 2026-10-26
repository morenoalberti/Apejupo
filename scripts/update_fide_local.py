"""Actualiza el Elo de FIDE desde este equipo y lo sube a GitHub.

GitHub no siempre consigue conectar con ratings.fide.com, pero este equipo sí. Esta tarea (programada en
Windows, ver scripts/instalar_tarea_fide.ps1) comprueba cada día si FIDE ha publicado una lista nueva y,
solo entonces, descarga la lista completa (todos los países), guarda una instantánea (nombre, federación,
título y ratings; sin año de nacimiento ni sexo) y la sube a la rama `fide-data` de GitHub.

La rama `fide-data` se sobrescribe cada vez con un único commit, así el historial del repositorio no crece.
GitHub la usa para reconstruir las bases de datos de FIDE y FADA.

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
BRANCH = "fide-data"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_elo  # noqa: E402


def log(msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def git(*args, input_text=None):
    # La entrada va en bytes: en modo texto Windows convertiría "\n" en "\r\n" y git lo guardaría en el nombre del fichero.
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                       input=None if input_text is None else input_text.encode("utf-8"))
    out, err = r.stdout.decode("utf-8", "replace").strip(), r.stderr.decode("utf-8", "replace").strip()
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} falló: {err or out}")
    return out


def publish_snapshot(snap):
    """Sube la instantánea a la rama huérfana `fide-data` (un único commit, sobrescrito) sin tocar el árbol de trabajo."""
    blob = git("hash-object", "-w", str(build_elo.SNAPSHOT))
    tree = git("mktree", input_text=f"100644 blob {blob}\tfide_all.json.gz\n")
    commit = git("commit-tree", tree, "-m", f"Instantánea de FIDE (lista del {snap['generado']})")
    git("push", "--force", "origin", f"{commit}:refs/heads/{BRANCH}")


def main():
    if "--republicar" in sys.argv:  # vuelve a subir la instantánea que ya hay en este equipo
        snap = build_elo.load_fide_snapshot()
        if snap is None:
            raise RuntimeError("No hay instantánea local que publicar")
        publish_snapshot(snap)
        log(f"Instantánea republicada en la rama {BRANCH}: {len(snap['filas'])} jugadores.")
        return
    log("Comprobando la lista de FIDE…")
    changed = build_elo.export_fide_snapshot(force="--forzar" in sys.argv)
    if not changed:
        if git("ls-remote", "--heads", "origin", BRANCH):
            log("Sin novedades: la instantánea ya está al día.")
            return
        # La rama de GitHub aún no existe (o se borró): se publica la instantánea que ya tenemos.
        log(f"La rama {BRANCH} no existe en GitHub: se publica la instantánea actual.")
    snap = build_elo.load_fide_snapshot()
    publish_snapshot(snap)
    log(f"Subida a la rama {BRANCH}: {len(snap['filas'])} jugadores. GitHub reconstruirá las bases en unos minutos.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("ERROR:\n" + traceback.format_exc())
        sys.exit(1)
