@echo off
setlocal
cd /d "%~dp0"
if exist "runtime\python.exe" goto embedded
call "START_WINDOWS.bat" %*
exit /b %errorlevel%
:embedded
"%~dp0runtime\python.exe" -I "%~dp0research\serve.py" %*
exit /b %errorlevel%
