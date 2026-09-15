param([string]$OutputDirectory = 'output/packages')
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$projectRoot = Split-Path (Split-Path $source -Parent) -Parent
$destination = [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
if (-not $destination.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputDirectory must stay inside the Inky-Paper project.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $source 'dashboard/manifest.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid plugin version' }
$package = Join-Path $destination "inky-coach-hermes-plugin-$version.zip"
$entries = @('plugin.yaml', '__init__.py', 'dashboard', 'desktop', 'skills', 'README.md')
$paths = $entries | ForEach-Object { Join-Path $source $_ }
# This only packages project-local runtime files; it does not install or enable Hermes.
Compress-Archive -LiteralPath $paths -DestinationPath $package -Force
$hash = Get-FileHash -LiteralPath $package -Algorithm SHA256
"$($hash.Hash.ToLower())  $([IO.Path]::GetFileName($package))" | Set-Content -LiteralPath "$package.sha256" -Encoding ascii
Write-Output $package
Write-Output "SHA256 $($hash.Hash.ToLower())"
