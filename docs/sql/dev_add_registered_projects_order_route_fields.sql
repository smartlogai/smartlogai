-- registered_projects: 수주경로 상세/참여자/증빙 필드 추가
-- 적용 대상: public.registered_projects

ALTER TABLE IF EXISTS public.registered_projects
  ADD COLUMN IF NOT EXISTS acquisition_route_detail text DEFAULT '',
  ADD COLUMN IF NOT EXISTS order_contributors_text text DEFAULT '',
  ADD COLUMN IF NOT EXISTS order_evidence_file_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS order_evidence_file_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS order_evidence_uploaded_at bigint;

COMMENT ON COLUMN public.registered_projects.acquisition_route_detail IS '수주경로 세부내역';
COMMENT ON COLUMN public.registered_projects.order_contributors_text IS '수주 참여자 목록(JSON 문자열: 이름/역할/기여도)';
COMMENT ON COLUMN public.registered_projects.order_evidence_file_name IS '수주경로 증빙 파일명';
COMMENT ON COLUMN public.registered_projects.order_evidence_file_url IS '수주경로 증빙 파일 URL';
COMMENT ON COLUMN public.registered_projects.order_evidence_uploaded_at IS '수주경로 증빙 파일 메타 저장 시각(ms)';
