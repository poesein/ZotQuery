param(
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Unexpected manifest version: $version" }
& node (Join-Path $PSScriptRoot 'privacy-scan.mjs') $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Public distribution privacy scan failed.' }

# Output templates are user-owned files, never distributable plugin assets.
$templateDirectory = Join-Path $projectRoot 'content\templates'
if ((Test-Path -LiteralPath $templateDirectory) -and (Get-ChildItem -LiteralPath $templateDirectory -File -Recurse -Filter '*.md')) {
  throw 'Bundled Markdown output templates are forbidden. Templates are optional user files.'
}
if (Test-Path -LiteralPath (Join-Path $projectRoot 'docs\REPORT-TEMPLATE-vNext.md')) {
  throw 'Remove the private writing-template document before building a distribution.'
}

$modelPath = Join-Path $projectRoot "content\models\Xenova\nomic-embed-text-v1.5\onnx\model_quantized.onnx"
if (-not (Test-Path -LiteralPath $modelPath)) { throw "Bundled model is missing. Run git lfs pull first." }
$modelHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $modelPath).Hash.ToLowerInvariant()
$expectedModelHash = "b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27"
if ($modelHash -ne $expectedModelHash) { throw "Bundled model hash mismatch. Run git lfs pull and verify the source." }

if (-not (Get-Command 7z -ErrorAction SilentlyContinue)) { throw "7z is required to build the XPI." }
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $projectRoot $OutputDirectory }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$xpiPath = Join-Path $outputPath "ZotQuery-$version-source-candidate.xpi"
if (Test-Path -LiteralPath $xpiPath) { throw "Output already exists; refusing to overwrite: $xpiPath" }

$payload = @(
  "manifest.json", "bootstrap.js", "prefs.js", "BUILD-INFO.json",
  "README.md", "README-EN.md", "README-ZH.md", "LICENSE", "THIRD-PARTY-NOTICE.md",
  "THIRD-PARTY-LICENSES", "content", "locale", "skin"
)

Push-Location $projectRoot
try {
  & 7z a -tzip -mx=3 $xpiPath @payload | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "7z failed to create the XPI" }
  & 7z t $xpiPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Archive integrity test failed" }
} finally {
  Pop-Location
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $xpiPath
Write-Output "Built: $xpiPath"
Write-Output "SHA256: $($hash.Hash)"
