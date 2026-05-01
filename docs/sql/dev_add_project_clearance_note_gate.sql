-- 프로젝트 통관유의사항 강제/조치 게이트 스키마
-- 적용 목적
-- 1) project_code_types에 통관유의사항 필수 여부 플래그 추가
-- 2) project_output_actions 테이블로 본부장/사업부장 조치사항 기록

ALTER TABLE IF EXISTS public.project_code_types
  ADD COLUMN IF NOT EXISTS requires_clearance_note boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_code_types.requires_clearance_note
IS 'true면 결과보고서 업로드 시 통관팀유의사항 + 조치완료(1명 이상) 게이트 적용';

CREATE TABLE IF NOT EXISTS public.project_output_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id        uuid NOT NULL,
  project_code     text NOT NULL DEFAULT '',
  action_user_id   text NOT NULL DEFAULT '',
  action_user_name text NOT NULL DEFAULT '',
  action_role      text NOT NULL DEFAULT '',
  action_status    text NOT NULL DEFAULT 'confirmed',
  action_note      text NOT NULL DEFAULT '',
  action_at        bigint,
  created_at       bigint NOT NULL DEFAULT public.now_ms(),
  updated_at       bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_output_actions_output_idx
  ON public.project_output_actions (output_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS project_output_actions_project_code_idx
  ON public.project_output_actions (project_code, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS project_output_actions_output_user_uidx
  ON public.project_output_actions (output_id, action_user_id);

COMMENT ON TABLE public.project_output_actions IS '통관팀유의사항에 대한 본부장/사업부장 조치 이력';

ALTER TABLE public.project_output_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_output_actions" ON public.project_output_actions;
CREATE POLICY "public read project_output_actions"
ON public.project_output_actions
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_output_actions" ON public.project_output_actions;
CREATE POLICY "public insert project_output_actions"
ON public.project_output_actions
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_output_actions" ON public.project_output_actions;
CREATE POLICY "public update project_output_actions"
ON public.project_output_actions
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public delete project_output_actions" ON public.project_output_actions;
CREATE POLICY "public delete project_output_actions"
ON public.project_output_actions
FOR DELETE
TO anon, authenticated
USING (true);
