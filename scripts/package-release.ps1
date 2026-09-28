param(
  [string]$OutputDirectory = "dist/release-3.1.25",
  [string]$CandidatePath = "dist/ZotQuery-3.1.25-source-candidate.xpi"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$version = (Get-Content -Raw -LiteralPath (Join-Path $root "manifest.json") | ConvertFrom-Json).version
if ($version -ne "3.1.25") { throw "Unexpected release version: $version" }
$output = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $root $OutputDirectory }
if (Test-Path -LiteralPath $output) { throw "Release output already exists: $output" }
$candidate = if ([System.IO.Path]::IsPathRooted($CandidatePath)) { $CandidatePath } else { Join-Path $root $CandidatePath }
if (-not (Test-Path -LiteralPath $candidate)) { throw "Build and test the XPI first" }
New-Item -ItemType Directory -Path $output | Out-Null
$xpi = Join-Path $output "ZotQuery-$version.xpi"
$source = Join-Path $output "ZotQuery-$version-source.zip"
$bridge = Join-Path $output "ZotQuery-ChatGPT-bridge-$version.zip"
Copy-Item -LiteralPath $candidate -Destination $xpi
Copy-Item -LiteralPath (Join-Path $root "docs/DEPTH-QC-HOTFIX.md") -Destination (Join-Path $output "DEPTH-QC-HOTFIX.md")
Copy-Item -LiteralPath (Join-Path $root "docs/VISUAL-TAG-HOTFIX.md") -Destination (Join-Path $output "VISUAL-TAG-HOTFIX.md")
Copy-Item -LiteralPath (Join-Path $root "docs/TOOL-CONTRACT-ARCHITECTURE.md") -Destination (Join-Path $output "TOOL-CONTRACT-ARCHITECTURE.md")
Copy-Item -LiteralPath (Join-Path $root "docs/AUDIT-FIXES-3.1.25.md") -Destination (Join-Path $output "AUDIT-FIXES-3.1.25.md")

$sourcePayload = @(
  "manifest.json", "bootstrap.js", "prefs.js", "BUILD-INFO.json", "updates.json",
  "README.md", "README-EN.md", "README-ZH.md", "LICENSE", "THIRD-PARTY-NOTICE.md",
  "THIRD-PARTY-LICENSES", "content", "locale", "skin", "scripts", "tests", "bridge",
  "docs"
)
Push-Location $root
try {
  & 7z a -tzip -mx=3 $source @sourcePayload | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Source archive failed" }
  & 7z a -tzip -mx=3 $bridge "bridge/chatgpt-mcp-stdio.mjs" "bridge/strawberry-vnext-depth.schema.json" "bridge/tool-contracts.json" "docs/CHATGPT-PRIVATE-MCP.md" "docs/TOOL-CONTRACT-ARCHITECTURE.md" "docs/AUDIT-FIXES-3.1.25.md" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Bridge archive failed" }
} finally { Pop-Location }
foreach ($file in @($xpi, $source, $bridge)) {
  & 7z t $file | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Archive integrity failed: $file" }
}
$checksums = foreach ($file in @($xpi, $source, $bridge)) {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
  "$hash  $([System.IO.Path]::GetFileName($file))"
}
[System.IO.File]::WriteAllLines((Join-Path $output "SHA256SUMS-$version.txt"), [string[]]$checksums, [System.Text.UTF8Encoding]::new($false))
Write-Output "Packaged $output"
$checksums
