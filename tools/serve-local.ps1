# Smart Log AI — 로컬 정적 서버 (프로젝트 루트에서 실행)
# 사용:  .\tools\serve-local.ps1
# 브라우저: http://127.0.0.1:8080/index.html  → 로그인 후 승인(Approval) 메뉴에서 목록 확인

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$port = 8080

Write-Host ""
Write-Host "  Smart Log AI — 로컬 미리보기" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:${port}/index.html" -ForegroundColor White
Write-Host "  (승인 목록: 로그인 → 왼쪽 메뉴 Approval)" -ForegroundColor DarkGray
Write-Host "  중지: Ctrl+C`n" -ForegroundColor DarkGray

if (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $port
}
elseif (Get-Command py -ErrorAction SilentlyContinue) {
  py -m http.server $port
}
else {
  npx --yes serve . -l $port
}
