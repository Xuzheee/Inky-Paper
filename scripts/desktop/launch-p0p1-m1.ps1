param([Parameter(Mandatory=$true)][string]$RunName)
$ErrorActionPreference = 'Stop'
if ($RunName -notmatch '^p0p1-m1-[A-Za-z0-9_-]+$') { throw 'Use a new p0p1-m1-* run name.' }
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ((Get-Location).Path -ne $projectRoot) { throw 'Run from this Inky-Paper checkout.' }
$acceptanceRoot = Join-Path $projectRoot "output/$RunName"
if (Test-Path -LiteralPath $acceptanceRoot) { throw 'Choose a new acceptance directory.' }
$fixture = Join-Path $projectRoot 'output/p0p1-m0/legacy/paper.pre-migration.sqlite'
if (!(Test-Path -LiteralPath $fixture)) { throw 'Prepare the M0 synthetic legacy fixture first.' }
$env:INKY_PAPER_TEST_DATA_DIR = Join-Path $acceptanceRoot 'paper-test'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $acceptanceRoot 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9254'
New-Item -ItemType Directory -Path $env:INKY_PAPER_TEST_DATA_DIR,$env:WEBVIEW2_USER_DATA_FOLDER | Out-Null
Copy-Item -LiteralPath $fixture -Destination (Join-Path $env:INKY_PAPER_TEST_DATA_DIR 'paper.sqlite3')
$testProcess = Start-Process -FilePath (Join-Path $projectRoot 'src-tauri/target/debug/inky-paper.exe') -ArgumentList '--workbench' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$testProcess.Id | Set-Content -LiteralPath (Join-Path $acceptanceRoot 'paper-test.pid')
Write-Output "Isolated M1 legacy process: $($testProcess.Id); CDP 9254."
