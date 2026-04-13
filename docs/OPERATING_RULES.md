# SmartLog 배포 운영 규칙

이 문서는 현재 운영/검증/개발 분리 구조에서 실수를 줄이기 위한 최소 운영 규칙과, **검증 DB(STG)에서 검증한 뒤 운영에 반영**하는 표준 절차를 고정합니다.

## 환경 매핑 표 (1:1 고정)

아래 조합이 서로 바뀌지 않도록 Vercel 프로젝트별 **Supabase Project URL·anon key**(및 빌드 주입 값)를 설정한다. 실제 키 값은 이 파일에 적지 않는다.

| 구분 | Vercel 프로젝트 | GitHub 저장소 · 브랜치 | Supabase 참조 이름 |
|------|-----------------|------------------------|-------------------|
| 개발 | `supersmartlogai` | `hanjoo82/supersmartlogai` · `main` | **DEV_DB_REF** = 개발용 프로젝트(예: supersmartlogai) |
| 검증 | `smartlogai_stg` | `hanjoo82/smartlogai-stg` · `main` | **STG_DB_REF** = `smartlogai-stg` |
| 운영 | `smartlogai` | `hanjoo82/smartlogai` · `main` | **PROD_DB_REF** = 운영 프로젝트(예: smartlogai) |

검증 루프는 **「STG_DB_REF + smartlogai_stg 앱 + smartlogai-stg Git main」**이 한 세트이며, 승인 후에만 **「PROD_DB_REF + smartlogai 앱 + smartlogai Git main」**에 동일 변경을 옮긴다.

## 운영 규칙 7개

1. 운영 배포는 `hanjoo82/smartlogai`의 `main`에서만 진행한다.
2. 검증 배포는 `hanjoo82/smartlogai-stg`의 `main`에서만 진행한다.
3. 개발 배포는 `hanjoo82/supersmartlogai`의 `main`에서만 진행한다.
4. 운영 핫픽스 후에는 동일 변경을 검증/개발 라인에도 즉시 반영한다. (자세한 절차는 아래 「핫픽스 시 역반영」)
5. DB 변경은 개발/검증에서 먼저 검증하고, 운영에는 승인된 SQL만 반영한다.
6. 배포 전에는 `커밋 SHA 일치`, `Environment(Production)`, `대상 도메인` 3가지를 반드시 확인한다.
7. 장애 발생 시 마지막 정상 태그/커밋으로 즉시 롤백하고, 원인 분석 전 추가 배포를 중지한다.

## 코드 반영 절차 (개발 → 검증 → 운영)

1. **개발**: `hanjoo82/supersmartlogai` `main`에서 작업 후 푸시한다.
2. **검증 반영**: 동일 변경을 `hanjoo82/smartlogai-stg` `main`에 반영한다(머지·체리픽·PR 등 팀 규칙에 따름).
3. **검증 앱**: Vercel `smartlogai_stg`의 Production이 STG 레포 최신 커밋 SHA인지 확인한다.
4. **검증 실행**: STG 앱 URL로 접속해 **STG_DB_REF(smartlogai-stg)** 데이터를 사용하는지 확인한 뒤, 핵심 시나리오(로그인·자료실·결재 등)를 테스트한다.
5. **운영 반영**: 검증 완료 후 동일 커밋(또는 동등 diff)을 `hanjoo82/smartlogai` `main`에 반영한다.
6. **운영 앱**: Vercel `smartlogai` Production SHA가 운영 레포 `main`과 일치하는지 확인한다.

## DB 반영 절차 (마이그레이션 승격)

DB는 환경 간 “데이터 통합”이 아니라 **동일 SQL/마이그레이션 파일을 순서대로 적용**한다.

1. **파일화**: 스키마·RLS·필요 시드 변경은 반드시 저장소에 파일로 남긴다(예: `supabase/migrations/` 또는 `docs/sql/`). 검증 콘솔에서만 수정하고 끝내지 않는다.
2. **STG 적용**: **STG_DB_REF** 프로젝트에만 먼저 적용한다.
3. **STG 검증**: STG 앱으로 기능·회귀를 다시 확인한다.
4. **운영 전**: **PROD_DB_REF** 백업(또는 스냅샷)을 확보하고, 롤백 방법(되돌릴 SQL 또는 복원 절차)을 짧게 메모한다.
5. **운영 적용**: 승인된 동일 스크립트를 운영 프로젝트에 적용한다.
6. **운영 검증**: 운영 앱 스모크 및 오류 로그를 확인한다.

개발 DB에서 실험한 경우에도, STG·운영으로 갈 때는 **같은 파일**을 기준으로 적용 순서를 맞춘다.

## 릴리즈 순서 (코드 + DB 동시 변경 시)

- 스키마/RLS가 새 앱 코드와 **맞물리는** 경우 권장 순서:  
  **STG DB 마이그레이션 → STG 앱 배포 → 검증 → 운영 DB 마이그레이션 → 운영 앱 배포**
- 앱 없이 데이터만 정리하는 등 **후행 작업**이면 순서는 조정 가능하나, **STG에서 전체 리허설**은 동일하게 수행한다.
- **파괴적 변경**(컬럼 삭제·타입 변경 등)은 가능하면 2단계 배포(추가 → 전환 → 제거)를 검토한다.

## 롤백 기준

- **앱**: Vercel에서 직전 정상 Production 배포로 **Redeploy** 또는 Git에서 이전 태그/커밋으로 되돌린 뒤 재배포한다.
- **DB**: 사전 백업/스냅샷이 있으면 복원 절차를 따른다. 되돌리기 SQL을 준비한 경우에만 수동 롤백한다. DB 롤백은 데이터 손실 위험이 있으므로 운영 적용 전 STG에서 반드시 검증한다.

## 핫픽스 시 역반영

운영에서 긴급 수정한 경우:

1. `hanjoo82/smartlogai` `main`에 반영한다.
2. **즉시** 동일 변경을 `hanjoo82/smartlogai-stg` `main`과 `hanjoo82/supersmartlogai` `main`(및 필요 시 `hanjoo82/smartlogai`의 `dev`/`develop`)에 맞춘다.
3. 운영 DB에만 수동으로 넣은 SQL이 있으면, 동일 내용을 **파일로 기록**한 뒤 STG·개발 DB에도 역반영 여부를 판단한다.

## 배포 전 체크(요약)

- 올바른 프로젝트/레포 연결인지 확인
- Production Current 배포의 브랜치와 SHA 확인
- 대상 Supabase 환경(DEV / **STG_DB_REF** / PROD) 매핑 확인
- Supabase 콘솔에서 **프로젝트 이름·ref**를 두 번 확인한 뒤 SQL 실행(오배포 방지)
- Git 커밋 작성자가 Vercel·GitHub 정책과 맞는지 확인(차단 배포 방지)
