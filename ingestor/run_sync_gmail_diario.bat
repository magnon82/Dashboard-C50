@echo off
REM Diario 5:00 AM (oculto): Infocaja + CORTE
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set INGESTOR=%~dp0
set PYTHON=C:\Users\magno\AppData\Local\Python\bin\python.exe
set LOGDIR=%INGESTOR%logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

for /f %%i in ('powershell -NoProfile -WindowStyle Hidden -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%i
set LOG=%LOGDIR%\sync_%TODAY%.log

echo ===== %DATE% %TIME% =====>> "%LOG%"
"%PYTHON%" "%INGESTOR%sync_gmail_diario.py" --newer-than 7 >> "%LOG%" 2>&1
set EXITCODE=%ERRORLEVEL%
echo ExitCode=%EXITCODE%>> "%LOG%"
exit /b %EXITCODE%
