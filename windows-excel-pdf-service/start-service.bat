@echo off
setlocal
cd /d %~dp0

if "%WORKWEAR_WINDOWS_PDF_PORT%"=="" set WORKWEAR_WINDOWS_PDF_PORT=3010
if "%WORKWEAR_WINDOWS_PDF_HOST%"=="" set WORKWEAR_WINDOWS_PDF_HOST=0.0.0.0

echo [windows-excel-pdf] starting...
node server.js

endlocal
