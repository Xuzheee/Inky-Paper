$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$acceptanceRoot = Join-Path $projectRoot 'output/desktop-acceptance'
if (Test-Path -LiteralPath $acceptanceRoot) {
    throw 'Use a fresh acceptance directory. Archive or remove output/desktop-acceptance before this run.'
}
$testExe = Join-Path $projectRoot 'src-tauri/target/debug/inky-paper.exe'
if (-not (Test-Path -LiteralPath $testExe)) {
    throw 'Build first: corepack pnpm tauri build --debug --no-bundle --config scripts/desktop/tauri-test.json'
}
$env:INKY_PAPER_TEST_DATA_DIR = Join-Path $acceptanceRoot 'paper-test-final'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $acceptanceRoot 'paper-webview-final'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9247'
New-Item -ItemType Directory -Path $env:INKY_PAPER_TEST_DATA_DIR,$env:WEBVIEW2_USER_DATA_FOLDER -Force | Out-Null
$testProcess = Start-Process -FilePath $testExe -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$testProcess.Id | Set-Content -LiteralPath (Join-Path $acceptanceRoot 'paper-test.pid')
Write-Output "Isolated debug process: $($testProcess.Id). Run node scripts/desktop/verify-session-pages.mjs from the project root."
