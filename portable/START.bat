@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ThyroVision LAB
if not exist "runtime\python.exe" goto missing_files
if not exist "research\serve.py" goto missing_files
if not exist "dist\index.html" goto missing_files
echo Starting ThyroVision LAB...
echo Keep this window open while using the application.
echo.
"%~dp0runtime\python.exe" -I "%~dp0research\serve.py" %*
set "THYROLAB_EXIT_CODE=%errorlevel%"
if "%THYROLAB_EXIT_CODE%"=="0" exit /b 0
echo.
echo The application stopped. Read the message above.
pause
exit /b %THYROLAB_EXIT_CODE%

:missing_files
echo Project files are missing. Extract the complete ZIP first.
echo Do not run START.bat from inside the ZIP viewer.
pause
exit /b 1
