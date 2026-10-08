@echo off
setlocal
cd /d "%~dp0"

rem Fast debug launcher: node-pty rebuilds only on first run / npm install / Electron
rem version change; TypeScript compiles incrementally.
rem Usage:   debug.bat            incremental compile + launch
rem          debug.bat --no-build skip compile, launch with existing dist

set "NO_BUILD=0"
if /i "%~1"=="--no-build" set "NO_BUILD=1"

where node >nul 2>nul
if errorlevel 1 (
  echo [debug] node not found, install Node.js first
  exit /b 1
)
if not exist "node_modules\" (
  echo [debug] node_modules missing, run npm install first
  exit /b 1
)

rem Remember the current Electron version to decide if node-pty needs a rebuild
node -p "require('electron/package.json').version" > "%TEMP%\gitter-electron-ver.txt" 2>nul
set /p ELECTRON_VER=<"%TEMP%\gitter-electron-ver.txt"

set "MARKER=node_modules\.pty-electron"
set "MARKER_VER="
if exist "%MARKER%" set /p MARKER_VER=<"%MARKER%"

set "NEED_REBUILD=1"
if exist "node_modules\node-pty\build\Release\pty.node" if "%MARKER_VER%"=="%ELECTRON_VER%" if not "%ELECTRON_VER%"=="" set "NEED_REBUILD=0"

if "%NEED_REBUILD%"=="0" goto pty_ok
echo [debug] Rebuilding node-pty for Electron %ELECTRON_VER% (only runs on first time or version change)...
call npx electron-rebuild -f -w node-pty
if errorlevel 1 (
  echo [debug] electron-rebuild failed, terminal feature may not work
  exit /b 1
)
>"%MARKER%" echo %ELECTRON_VER%
:pty_ok
echo [debug] node-pty ready (Electron %ELECTRON_VER%), skipping rebuild

if "%NO_BUILD%"=="1" goto launch
echo [debug] Incremental TypeScript compile...
call npx tsc -p tsconfig.json --incremental --tsBuildInfoFile dist\.tsbuildinfo
if errorlevel 1 (
  echo [debug] Compile failed
  exit /b 1
)

:launch
echo [debug] Starting Electron...
call npx electron .
