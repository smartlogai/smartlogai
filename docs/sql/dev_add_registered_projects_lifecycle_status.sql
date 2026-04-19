-- registered_projects: 프로젝트 진행현황 이력/수동보정 컬럼 추가
-- 목적:
-- 1) 진행현황 상태(계약완료/수행중/업무종료/정산완료) 이력 관리
-- 2) 자동 판정 + 권한자 수동 보정 병행

ALTER TABLE IF EXISTS public.registered_projects
  ADD COLUMN IF NOT EXISTS contract_completed_at bigint,
  ADD COLUMN IF NOT EXISTS execution_started_at bigint,
  ADD COLUMN IF NOT EXISTS work_closed_at bigint,
  ADD COLUMN IF NOT EXISTS settled_at bigint,
  ADD COLUMN IF NOT EXISTS lifecycle_status_override text DEFAULT '',
  ADD COLUMN IF NOT EXISTS lifecycle_override_reason text DEFAULT '',
  ADD COLUMN IF NOT EXISTS lifecycle_updated_at bigint,
  ADD COLUMN IF NOT EXISTS lifecycle_updated_by text DEFAULT '',
  ADD COLUMN IF NOT EXISTS lifecycle_updated_by_name text DEFAULT '';

COMMENT ON COLUMN public.registered_projects.contract_completed_at IS '진행현황 이력: 계약완료 시각(ms)';
COMMENT ON COLUMN public.registered_projects.execution_started_at IS '진행현황 이력: 수행중 시작 시각(ms)';
COMMENT ON COLUMN public.registered_projects.work_closed_at IS '진행현황 이력: 업무종료 시각(ms)';
COMMENT ON COLUMN public.registered_projects.settled_at IS '진행현황 이력: 정산완료 시각(ms)';
COMMENT ON COLUMN public.registered_projects.lifecycle_status_override IS '권한자 수동보정 상태(contract_completed|in_progress|work_closed|settled_done)';
COMMENT ON COLUMN public.registered_projects.lifecycle_override_reason IS '수동보정 사유';
COMMENT ON COLUMN public.registered_projects.lifecycle_updated_at IS '수동보정 시각(ms)';
COMMENT ON COLUMN public.registered_projects.lifecycle_updated_by IS '수동보정자 ID';
COMMENT ON COLUMN public.registered_projects.lifecycle_updated_by_name IS '수동보정자명';

-- 검색 성능
CREATE INDEX IF NOT EXISTS registered_projects_lifecycle_status_override_idx
  ON public.registered_projects (lifecycle_status_override, registration_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS registered_projects_lifecycle_dates_idx
  ON public.registered_projects (contract_completed_at, execution_started_at, work_closed_at, settled_at);

-- PM 결과물 업로드 이력(업무종료 자동 판정 소스)
CREATE TABLE IF NOT EXISTS public.project_outputs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       text NOT NULL DEFAULT '',
  project_code     text NOT NULL DEFAULT '',
  project_name     text NOT NULL DEFAULT '',
  output_type      text NOT NULL DEFAULT '',
  output_title     text NOT NULL DEFAULT '',
  output_file_name text NOT NULL DEFAULT '',
  output_file_url  text NOT NULL DEFAULT '',
  uploaded_by      text NOT NULL DEFAULT '',
  uploaded_by_name text NOT NULL DEFAULT '',
  uploaded_at      bigint,
  note             text NOT NULL DEFAULT '',
  created_at       bigint NOT NULL DEFAULT public.now_ms(),
  updated_at       bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_outputs_project_code_idx
  ON public.project_outputs (project_code, uploaded_at DESC, created_at DESC);

COMMENT ON TABLE public.project_outputs IS '프로젝트 결과물 업로드 이력(업무종료 자동 판정)';

ALTER TABLE public.project_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_outputs" ON public.project_outputs;
CREATE POLICY "public read project_outputs"
ON public.project_outputs
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_outputs" ON public.project_outputs;
CREATE POLICY "public insert project_outputs"
ON public.project_outputs
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_outputs" ON public.project_outputs;
CREATE POLICY "public update project_outputs"
ON public.project_outputs
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public delete project_outputs" ON public.project_outputs;
CREATE POLICY "public delete project_outputs"
ON public.project_outputs
FOR DELETE
TO anon, authenticated
USING (true);
