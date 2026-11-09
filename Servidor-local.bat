@echo off
title Apejupo - servidor local (puerto 8080)
cd /d "%~dp0"
echo Web de Apejupo en http://localhost:8080/  (cierra esta ventana para parar)
start "" http://localhost:8080/torneos-live.html
python scripts\dev_server.py 8080
