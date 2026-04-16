param(
  [int]$Port = 8080,
  [switch]$SkipSyntax
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host "[LOCAL-DEV] $msg" -ForegroundColor Cyan
}

function Open-Browser($url) {
  try {
    Start-Process $url | Out-Null
    return $true
  } catch {}
  try {
    cmd /c start "" $url | Out-Null
    return $true
  } catch {}
  try {
    explorer.exe $url | Out-Null
    return $true
  } catch {}
  return $false
}

# Detect placeholder in supabase.dev.js without non-ASCII in this script (PS 5.1 + UTF-8 no BOM safe).
function Test-SupabaseDevPlaceholder([string]$text) {
  if (-not $text) { return $false }
  # Korean "yeogi-e" from example template: U+C5EC U+AE30 U+C5D0
  $marker = "$([char]0xC5EC)$([char]0xAE30)$([char]0xC5D0)"
  return $text.Contains($marker)
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$devCfg = Join-Path $root "js\supabase.dev.js"
$devExample = Join-Path $root "js\supabase.dev.example.js"

if (-not (Test-Path $devCfg)) {
  Write-Step "Missing js/supabase.dev.js — copying from supabase.dev.example.js"
  Copy-Item $devExample $devCfg
}

if (Test-Path $devCfg) {
  $raw = Get-Content -Raw -Path $devCfg -Encoding UTF8 -ErrorAction SilentlyContinue
  if (Test-SupabaseDevPlaceholder $raw) {
    Write-Host ""
    Write-Host "[NOTE] js/supabase.dev.js still contains the template placeholder text." -ForegroundColor Yellow
    Write-Host "  Login/API may fail until you set real DEV Supabase URL and anon key." -ForegroundColor Yellow
    Write-Host "  File: $devCfg" -ForegroundColor DarkYellow
    Write-Host ""
  }
}

if (-not $SkipSyntax) {
  Write-Step "Running JS syntax check..."
  & "$root\tools\check-js-syntax.ps1"
} else {
  Write-Step "Skipping JS syntax check (-SkipSyntax)"
}

$url = "http://localhost:$Port/index.html"
$mainUrl = "http://localhost:$Port/main.html"
Write-Host ""
Write-Host "  Login: $url" -ForegroundColor Green
Write-Host "  Main (session required): $mainUrl" -ForegroundColor Green
Write-Host ""
Write-Step "Opening browser: $url"
if (-not (Open-Browser $url)) {
  Write-Host "Could not launch browser. Open this URL manually:" -ForegroundColor Yellow
  Write-Host "  $url" -ForegroundColor Yellow
}

Write-Step "Starting local server (stop: Ctrl+C)"
try {
  python --version | Out-Null
  python -m http.server $Port
} catch {
  Write-Step "Python failed. Trying npx serve..."
  npx --yes serve . -l $Port
}
