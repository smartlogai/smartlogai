# 로컬 개발 워크플로우 (push 없이 확인)

목표: 개발 중에는 로컬 화면에서 즉시 확인하고, 최종 승인된 변경만 배포 앱에서 검증합니다.

## 핵심 원칙

1. 개발 확인은 항상 `localhost`에서 한다.
2. 배포 URL 확인은 "최종 승인 직전/직후"에만 한다.
3. 기능은 Step 단위로 잘라서 개발-테스트-확정 순환한다.

## 1회 준비

1. `js/supabase.dev.example.js`를 `js/supabase.dev.js`로 복사
2. `js/supabase.dev.js`에 DEV Supabase URL/anonKey 입력
3. DEV DB 스키마 적용 (예: `docs/sql/dev_schema_consulting_pm.sql`)

## 매일 개발 루프

1. 로컬 서버 시작:

```powershell
.\tools\start-local-dev.ps1
```

2. 브라우저는 반드시 `http://localhost:8080/index.html` 접속
3. 코드 수정 후 `Ctrl+F5`로 강력 새로고침
4. Step 테스트 체크리스트 수행
5. 통과한 Step만 다음 Step 진행

## 배포 전 체크

1. 로컬 Step 테스트 통과
2. 문법 체크 통과 (`tools/check-js-syntax.ps1`)
3. 필요한 DB 스키마가 DEV에 반영되어 있는지 확인
4. 그 후에만 PR/배포 브랜치 반영

## 배포 앱에서 안 보일 때

- 배포 URL은 캐시/배포 타이밍 때문에 최신 로컬 변경이 바로 보이지 않을 수 있습니다.
- 로컬 검증이 끝나기 전에는 배포 URL을 기준으로 판단하지 않습니다.
- 메뉴 미노출/화면 불일치가 있으면 먼저 `localhost`에서 동일 증상이 재현되는지 확인합니다.
