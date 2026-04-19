-- registered_projects: 프로젝트 3단계 승인(1차/2차/3차 최종) 필드 추가
-- 적용 대상: public.registered_projects
-- 목적: 프로젝트 승인 흐름을 manager -> director -> top_mgr 3차 승인으로 확장

ALTER TABLE IF EXISTS public.registered_projects
  ADD COLUMN IF NOT EXISTS reg_pa3_id text DEFAULT '',
  ADD COLUMN IF NOT EXISTS reg_pa3_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS second_approved_at bigint,
  ADD COLUMN IF NOT EXISTS second_approved_by text DEFAULT '',
  ADD COLUMN IF NOT EXISTS second_approved_by_name text DEFAULT '';

COMMENT ON COLUMN public.registered_projects.reg_pa3_id IS '프로젝트 3차(최종) 승인자 ID';
COMMENT ON COLUMN public.registered_projects.reg_pa3_name IS '프로젝트 3차(최종) 승인자명';
COMMENT ON COLUMN public.registered_projects.second_approved_at IS '프로젝트 2차 승인 시각(ms)';
COMMENT ON COLUMN public.registered_projects.second_approved_by IS '프로젝트 2차 승인자 ID';
COMMENT ON COLUMN public.registered_projects.second_approved_by_name IS '프로젝트 2차 승인자명';
