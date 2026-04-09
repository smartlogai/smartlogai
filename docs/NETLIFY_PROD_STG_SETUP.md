# Netlify 운영/스테이징 분리 가이드 (Smartlog AI)

## 목표
- **운영(Netlify Production)**은 **운영 Supabase**만 사용
- **스테이징/프리뷰(Netlify Deploy Preview/Branch Deploy)**는 **개발 Supabase**만 사용
- Supabase URL/anon 키를 **레포에 커밋하지 않음**

## 사전 조건
- `netlify.toml`이 존재해야 합니다.
- `scripts/netlify-inject-supabase-env.cjs`가 빌드 단계에서 `js/supabase-env.js`의 플레이스홀더를 치환합니다.

## Netlify 사이트 구성(권장)

### 옵션 A (가장 단순): Netlify 사이트 2개
- **Site 1: smartlog-prod**
  - Production branch: `main`
  - Environment variables:
    - `SUPABASE_URL` = 운영 Supabase URL
    - `SUPABASE_ANON_KEY` = 운영 Supabase anon key
    - `SMARTLOG_ENV_LABEL` = `PROD`
- **Site 2: smartlog-stg**
  - Production branch: `dev`
  - Environment variables:
    - `SUPABASE_URL` = 개발 Supabase URL
    - `SUPABASE_ANON_KEY` = 개발 Supabase anon key
    - `SMARTLOG_ENV_LABEL` = `STG`

### 옵션 B: 사이트 1개 + Deploy Preview 활용
- Production(운영): 운영 키
- Deploy Preview/Branch Deploy(프리뷰): 개발 키
- Netlify UI에서 **컨텍스트별(Environment variables by deploy context)**로 분리 설정합니다.

## 검증 방법(필수)
- 운영 URL에서 접속 후 브라우저 콘솔에서 확인:
  - `window.SmartLogSupabase.url`이 **운영 Supabase**인지
  - `window.__SMARTLOG_ENV_LABEL__`이 `PROD`인지
- 스테이징/프리뷰 URL에서 동일하게 확인:
  - `window.SmartLogSupabase.url`이 **개발 Supabase**인지
  - `window.__SMARTLOG_ENV_LABEL__`이 `STG`인지

## 주의
- `SUPABASE_ANON_KEY`는 공개 키이긴 하지만, **레포에 하드코딩하지 말고** Netlify 환경변수로만 관리하세요.
- 운영 Supabase는 RLS/권한 정책을 운영 기준으로 점검하고, 백업/복구 절차를 확보하세요.

