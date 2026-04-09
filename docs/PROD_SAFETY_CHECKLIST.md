# 운영 전환 안전 체크리스트 (Supabase/Netlify)

## 1) Netlify → Supabase 연결 안전
- [ ] 운영 Netlify에서 `SUPABASE_URL`, `SUPABASE_ANON_KEY`가 **운영 Supabase**로 설정됨
- [ ] 스테이징/프리뷰 Netlify에서 `SUPABASE_URL`, `SUPABASE_ANON_KEY`가 **개발 Supabase**로 설정됨
- [ ] 운영/스테이징에서 콘솔로 확인
  - [ ] `window.SmartLogSupabase.url`
  - [ ] `window.__SMARTLOG_ENV_LABEL__` (헤더에 ENV 배지도 표시됨)
- [ ] 운영 키/URL이 레포에 하드코딩되어 있지 않음

## 2) Supabase 운영 정책(RLS/권한)
- [ ] `anon`으로 허용해야 하는 API만 열려 있음
- [ ] `users`, `time_entries`, `attachments`, `mail_references` 등 주요 테이블 RLS 점검
- [ ] 운영 계정 생성/초기 비밀번호 정책 확인
- [ ] 관리자 계정(최소 1명) 복구 절차 문서화

## 3) 백업/복구
- [ ] 운영 DB 백업 방식 결정(스냅샷/덤프/자동 백업 주기)
- [ ] “복구 리허설”을 최소 1회 수행(테스트 프로젝트에서)
- [ ] 장애 시 롤백/복구 담당자 지정

## 4) 릴리즈 운영
- [ ] 운영 배포는 `main`만
- [ ] 스테이징은 `dev` 또는 PR Preview
- [ ] 배포 전후 핵심 기능 점검(로그인/업무기록/승인/자료실)

