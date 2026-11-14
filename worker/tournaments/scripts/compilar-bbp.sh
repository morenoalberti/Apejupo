#!/usr/bin/env bash
# Compila bbpPairings (motor FIDE del suizo holandés) a WebAssembly para el servidor de torneos.
# Solo hace falta para actualizar el motor: el resultado (src/bbp/) ya está en el repositorio.
#
# Requisitos: Emscripten (https://emscripten.org) activado en la consola (emsdk_env) y git.
# Uso:  bash scripts/compilar-bbp.sh [carpeta con el código de bbpPairings]
set -euo pipefail

COMMIT=8f9e3c5ffdc4d7a08a33d31c6fb49b4e7acef4d5   # versión revisada de bbpPairings (julio de 2026)
SRC=${1:-/c/bbpPairings-src}
OUT="$(cd "$(dirname "$0")/.." && pwd)/src/bbp"

if [ ! -d "$SRC/.git" ]; then git clone https://github.com/BieremaBoyzProgramming/bbpPairings.git "$SRC"; fi
git -C "$SRC" fetch --depth 1 origin "$COMMIT" 2>/dev/null || true
git -C "$SRC" checkout -q "$COMMIT"

mkdir -p "$OUT"
cd "$SRC"
# Sin generador ni comprobador de torneos. (Se deja el sistema Burstein: con OMIT_BURSTEIN
# esta versión no compila. Solo se usa el holandés.)
# DYNAMIC_EXECUTION=0: Cloudflare Workers no permite eval. INVOKE_RUN=0: se llama a main desde JavaScript.
em++ -std=c++20 -O3 -DNDEBUG -fexceptions -Isrc \
  -DOMIT_GENERATOR -DOMIT_CHECKER -DVERSION_INFO="\"$COMMIT\"" \
  $(find src -name '*.cpp') \
  -o "$OUT/bbp.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web -sDYNAMIC_EXECUTION=0 \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS=callMain,FS -sEXPORT_NAME=createBbp
cp LICENSE.txt "$OUT/LICENSE.txt"; cp Apache-2.0.txt "$OUT/Apache-2.0.txt"
echo "Listo: $OUT/bbp.mjs y $OUT/bbp.wasm (bbpPairings $COMMIT)"
