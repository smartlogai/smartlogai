# Smart Log AI — JS 문법 체크 (PowerShell 래퍼)
# 사용:
#   .\tools\check-js-syntax.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "[JS-SYNTAX] node.exe not found in PATH. Install Node.js or add it to PATH." -ForegroundColor Yellow
  exit 1
}

& node "$root\tools\check-js-syntax.js"
exit $LASTEXITCODE
