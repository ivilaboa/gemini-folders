# Empaqueta la extensión en un ZIP listo para la Chrome Web Store.
#
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1
#
# Sólo se incluyen los archivos que Chrome carga; el resto del repo (tools,
# tests, scripts) se queda fuera.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$outDir = Join-Path $root 'dist'
$zip = Join-Path $outDir ("gemini-folders-{0}.zip" -f $manifest.version)

$files = @(
  'manifest.json'
  'lib.js'
  'content.js'
  'content.css'
  'popup.html'
  'popup.js'
) + (Get-ChildItem (Join-Path $root 'icons') -File | ForEach-Object { "icons/$($_.Name)" })

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("gf-stage-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

try {
  foreach ($file in $files) {
    $src = Join-Path $root $file
    if (-not (Test-Path $src)) { throw "Falta el archivo: $file" }
    $dest = Join-Path $stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item $src $dest
  }

  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  if (Test-Path $zip) { Remove-Item $zip }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

  "{0}  ({1:N0} KB)" -f $zip, ((Get-Item $zip).Length / 1KB)
}
finally {
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
