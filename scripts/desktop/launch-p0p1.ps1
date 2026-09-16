param([Parameter(Mandatory=$true)][string]$RunName,[switch]$Resume)
$ErrorActionPreference='Stop'
if ($RunName -notmatch '^p0p1-m[2-5]-[A-Za-z0-9_-]+$') {throw 'Use a p0p1-m2 through m5 run name.'}
$projectRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ((Get-Location).Path -ne $projectRoot) {throw 'Run from this checkout.'}
$acceptanceRoot=Join-Path $projectRoot "output/$RunName"
if ((Test-Path -LiteralPath $acceptanceRoot) -and !$Resume) {throw 'Choose a new isolated directory or explicitly resume.'}
if ($Resume -and !(Test-Path -LiteralPath (Join-Path $acceptanceRoot 'paper-test/paper.sqlite3'))) {throw 'No isolated database to resume.'}
$env:INKY_PAPER_TEST_DATA_DIR=Join-Path $acceptanceRoot 'paper-test'
$env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $acceptanceRoot 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9254'
New-Item -ItemType Directory -Force -Path $env:INKY_PAPER_TEST_DATA_DIR,$env:WEBVIEW2_USER_DATA_FOLDER | Out-Null
$testProcess=Start-Process -FilePath (Join-Path $projectRoot 'src-tauri/target/debug/inky-paper.exe') -ArgumentList '--workbench' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$testProcess.Id | Set-Content -LiteralPath (Join-Path $acceptanceRoot 'paper-test.pid')
Write-Output "Isolated native process: $($testProcess.Id); CDP 9254; $RunName."
