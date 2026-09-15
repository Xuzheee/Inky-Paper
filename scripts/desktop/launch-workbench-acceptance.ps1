param([string]$RunName = 'workbench-acceptance')
$ErrorActionPreference = 'Stop'
if ($RunName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$') { throw 'Invalid RunName.' }
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$acceptanceRoot = Join-Path $projectRoot "output/$RunName"
if (Test-Path -LiteralPath $acceptanceRoot) { throw 'Choose a new acceptance directory.' }
$testExe = Join-Path $projectRoot 'src-tauri/target/debug/inky-paper.exe'
$env:INKY_PAPER_TEST_DATA_DIR = Join-Path $acceptanceRoot 'paper-test'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $acceptanceRoot 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9254'
New-Item -ItemType Directory -Path $env:INKY_PAPER_TEST_DATA_DIR,$env:WEBVIEW2_USER_DATA_FOLDER -Force | Out-Null
$testProcess = Start-Process -FilePath $testExe -ArgumentList '--workbench' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$testProcess.Id | Set-Content -LiteralPath (Join-Path $acceptanceRoot 'paper-test.pid')
Write-Output "Isolated workbench process: $($testProcess.Id); CDP 9254."
