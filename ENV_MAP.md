# Environment Map

- **DEV_DB_REF** (개발 DB 식별): `supersmartlogai` — Supabase 프로젝트명·`js/supabase.dev.js`가 가리킬 개발 인스턴스
- Vercel PROD: `smartlogai` -> Supabase: `smartlogai-dev`
- Vercel DEV/STG: `supersmartlogai` -> Supabase: `supersmartlogai`
- Paused Supabase (legacy): `smartlogai`

## Notes

- `smartlogai-dev` is the current production database in use.
- `supersmartlogai` is reserved for ongoing development/testing.
- Do not delete paused `smartlogai` until all legacy dependencies are confirmed removed.
