-- Project Output 게시승인 워크플로 컬럼 추가
-- 목적:
-- 1) 프로젝트 결과보고서의 게시 승인/비공개 상태 관리
-- 2) CCB 사업부장 최종 승인 이력 저장

ALTER TABLE IF EXISTS public.project_outputs
  ADD COLUMN IF NOT EXISTS publish_status text NOT NULL DEFAULT 'hold',
  ADD COLUMN IF NOT EXISTS publish_requested_at bigint,
  ADD COLUMN IF NOT EXISTS publish_requested_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS publish_requested_by_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS publish_approved_at bigint,
  ADD COLUMN IF NOT EXISTS publish_approved_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS publish_approved_by_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS publish_decision_note text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.project_outputs.publish_status
IS '게시 상태(published|hold|blocked)';

CREATE INDEX IF NOT EXISTS project_outputs_publish_status_idx
  ON public.project_outputs (publish_status, output_type, uploaded_at DESC);

-- 과거 값 호환
UPDATE public.project_outputs
   SET publish_status = 'hold'
 WHERE publish_status IN ('', 'pending_publish')
   AND output_type = '결과보고서';

UPDATE public.project_outputs
   SET publish_status = 'blocked'
 WHERE publish_status = 'private';
