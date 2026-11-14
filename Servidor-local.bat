@echo off
title Apejupo - servidor local (puerto 8080)
cd /d "%~dp0"
rem Servidor de torneos y cuentas (puerto 8789) en su propia ventana; si ya esta en marcha, no se arranca otro.
netstat -ano | findstr /r /c:":8789 .*LISTENING" >nul
if errorlevel 1 (
  start "Apejupo - torneos y cuentas (puerto 8789)" /d "%~dp0worker\tournaments" cmd /k npm run dev
) else (
  echo El servidor de torneos ya estaba en marcha en el puerto 8789.
)
echo Web de Apejupo en http://localhost:8080/  (cierra esta ventana para parar)
echo Torneos y cuentas en http://127.0.0.1:8789/  (se para cerrando su ventana)
start "" http://localhost:8080/torneos-live.html
python scripts\dev_server.py 8080
