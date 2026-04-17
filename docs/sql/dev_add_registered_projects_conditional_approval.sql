-- registered_projects: 계약서 예외(근거 첨부) 조건부 승인 필드 추가
-- 적용 대상: public.registered_projects

ALTER TABLE IF EXISTS public.registered_projects
  ADD COLUMN IF NOT EXISTS contract_exception_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_exception_reason text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_evidence_file_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_evidence_file_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_evidence_uploaded_at bigint,
  ADD COLUMN IF NOT EXISTS conditional_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conditional_approved_at bigint;

COMMENT ON COLUMN public.registered_projects.contract_exception_required IS '계약서 미첨부 예외(조건부 승인) 여부';
COMMENT ON COLUMN public.registered_projects.contract_exception_reason IS '계약서 미첨부 사유';
COMMENT ON COLUMN public.registered_projects.contract_evidence_file_name IS '고객 합의 근거 파일명(메일/공문 등)';
COMMENT ON COLUMN public.registered_projects.contract_evidence_file_url IS '고객 합의 근거 파일 URL';
COMMENT ON COLUMN public.registered_projects.contract_evidence_uploaded_at IS '고객 합의 근거 파일 메타 저장 시각(ms)';
COMMENT ON COLUMN public.registered_projects.conditional_approval IS '조건부 승인 여부';
COMMENT ON COLUMN public.registered_projects.conditional_approved_at IS '조건부 승인 확정 시각(ms)';
