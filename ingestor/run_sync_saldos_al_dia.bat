@echo off
REM Cada 5 min (oculto): Saldos al dia (efectivo + CXP)
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set INGESTOR=%~dp0
set PYTHON=C:\Users\magno\AppData\Local\Python\bin\python.exe
set LOGDIR=%INGESTOR%logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

for /f %%i in ('powershell -NoProfile -WindowStyle Hidden -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%i
set LOG=%LOGDIR%\saldos_%TODAY%.log

echo ===== %DATE% %TIME% =====>> "%LOG%"
"%PYTHON%" "%INGESTOR%sync_saldos_al_dia.py" >> "%LOG%" 2>&1
set EXITCODE=%ERRORLEVEL%
echo ExitCode=%EXITCODE%>> "%LOG%"
exit /b %EXITCODE%
