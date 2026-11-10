@echo off
setlocal
cd /d "%~dp0"
if not exist "research\serve.py" goto missing_files
if not exist "dist\index.html" goto missing_files

rem Prefer the Python launcher, then try Python on PATH.
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if not errorlevel 1 goto launch_py
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if not errorlevel 1 goto launch_python

echo Python 3.8 or newer was not found.
echo Install Python 3 from https://www.python.org/downloads/windows/
echo Enable "Add python.exe to PATH" if the installer offers it.
echo Then close this window and run START_WINDOWS.bat again.
pause
exit /b 1

:launch_py
py -3 "research\serve.py" %*
goto after_run

:launch_python
python "research\serve.py" %*
goto after_run

:after_run
set "THYROLAB_EXIT_CODE=%errorlevel%"
if "%THYROLAB_EXIT_CODE%"=="0" exit /b 0
echo.
echo The application stopped with an error. Read the message above.
pause
exit /b %THYROLAB_EXIT_CODE%

:missing_files
echo Project files are missing. Extract the whole ZIP into one folder first.
echo Do not run this file from inside the ZIP viewer.
pause
exit /b 1
