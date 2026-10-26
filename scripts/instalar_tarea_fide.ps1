# Crea (o actualiza) la tarea programada de Windows que mantiene al día el Elo de FIDE.
# Cada día a las 12:00 comprueba si FIDE ha publicado una lista nueva; solo entonces la descarga y la sube a GitHub.
# Si el equipo estaba apagado a esa hora, se ejecuta en cuanto se pueda.
#
# Instalar:   powershell -ExecutionPolicy Bypass -File scripts\instalar_tarea_fide.ps1
# Quitar:     powershell -ExecutionPolicy Bypass -File scripts\instalar_tarea_fide.ps1 -Quitar
param([switch]$Quitar)

$nombre = "Apejupo - Actualizar Elo FIDE"

if ($Quitar) {
    Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarea eliminada."
    return
}

$raiz = Split-Path -Parent $PSScriptRoot
$python = (Get-Command python -ErrorAction Stop).Source
$accion = New-ScheduledTaskAction -Execute $python -Argument "`"$raiz\scripts\update_fide_local.py`"" -WorkingDirectory $raiz
$disparador = New-ScheduledTaskTrigger -Daily -At 12:00
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes `
    -Description "Descarga el Elo de FIDE cuando hay lista nueva y la sube a GitHub (web Apejupo)." -Force | Out-Null
Write-Host "Tarea '$nombre' instalada: cada día a las 12:00 (o en cuanto el equipo esté disponible)."
