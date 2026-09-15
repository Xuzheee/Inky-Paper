param([string]$RunName = 'focus-strip-acceptance')
$ErrorActionPreference = 'Stop'
if ($RunName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$') { throw 'RunName must be a simple directory name.' }
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$acceptanceRoot = Join-Path $projectRoot "output/$RunName"
if (Test-Path -LiteralPath $acceptanceRoot) {
    throw 'Use a fresh directory: choose a new RunName and pass the same name to the verification script.'
}
$testExe = Join-Path $projectRoot 'src-tauri/target/debug/inky-paper.exe'
if (-not (Test-Path -LiteralPath $testExe)) {
    throw 'Build first: corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-test.json'
}
$env:INKY_PAPER_TEST_DATA_DIR = Join-Path $acceptanceRoot 'paper-test'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $acceptanceRoot 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9252'
New-Item -ItemType Directory -Path $env:INKY_PAPER_TEST_DATA_DIR,$env:WEBVIEW2_USER_DATA_FOLDER -Force | Out-Null
$testProcess = Start-Process -FilePath $testExe -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$testProcess.Id | Set-Content -LiteralPath (Join-Path $acceptanceRoot 'paper-test.pid')
Write-Output "Isolated debug process: $($testProcess.Id). Run node scripts/desktop/verify-focus-transparency.mjs."
