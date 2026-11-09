@echo off
setlocal
cd /d "%~dp0"
set "YUNO_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "YUNO_ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "YUNO_ARCH=arm64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if "%PROCESSOR_ARCHITEW6432%"=="" goto unsupported
set "YUNO_NODE=%CD%\.runtime\node-v24.20.0-win-%YUNO_ARCH%"
if exist "%YUNO_NODE%\node.exe" goto ready
echo Preparing private Node.js v24.20.0 from nodejs.org. No global installation.
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $a=$env:YUNO_ARCH; $file='node-v24.20.0-win-'+$a+'.zip'; $sha=if($a -eq 'arm64'){'31c6799744de8a54601643098040c68c3697e56c94e407d61d0e5fa5f34191d7'}else{'6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'}; New-Item -ItemType Directory -Force '.runtime' | Out-Null; $zip=Join-Path '.runtime' $file; Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 ('https://nodejs.org/dist/v24.20.0/'+$file) -OutFile $zip; $stream=[IO.File]::OpenRead([IO.Path]::GetFullPath($zip)); try{$hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-','').ToLower()}finally{$stream.Dispose()}; if($hash -ne $sha){throw 'Node.js SHA-256 verification failed; nothing executed.'}; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($zip),[IO.Path]::GetFullPath('.runtime'))"
if errorlevel 1 goto failed
:ready
set "PATH=%YUNO_NODE%;%PATH%"
"%YUNO_NODE%\node.exe" scripts\launcher.mjs %*
if errorlevel 1 goto failed
exit /b 0
:unsupported
echo Everse requires 64-bit Windows x64 or ARM64.
:failed
echo Installation or startup failed. Existing saves were not deleted. See the error above.
if not defined YUNO_NO_PAUSE pause
exit /b 1
