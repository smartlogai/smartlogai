-- project_invoices 확장: 발행요청 상세 + 경영지원 발행처리 + 향후 국세청 연동 준비
-- 실행 순서: dev_add_project_management_timecharge.sql 이후

ALTER TABLE IF EXISTS public.project_invoices
  ADD COLUMN IF NOT EXISTS planned_issue_date date,
  ADD COLUMN IF NOT EXISTS expected_payment_date date,
  ADD COLUMN IF NOT EXISTS recipient_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recipient_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recipient_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_company_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_business_no text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS item_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS legal_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS nts_issue_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS nts_issue_requested_at bigint,
  ADD COLUMN IF NOT EXISTS nts_issue_requested_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nts_issue_requested_by_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nts_issue_processed_at bigint,
  ADD COLUMN IF NOT EXISTS nts_issue_processed_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nts_issue_processed_by_name text NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS public.project_invoices
  DROP CONSTRAINT IF EXISTS project_invoices_nts_issue_status_chk;
ALTER TABLE IF EXISTS public.project_invoices
  ADD CONSTRAINT project_invoices_nts_issue_status_chk
  CHECK (nts_issue_status IN ('pending','requested','issued','failed'));

CREATE INDEX IF NOT EXISTS project_invoices_planned_issue_idx
  ON public.project_invoices (planned_issue_date, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS project_invoices_expected_payment_idx
  ON public.project_invoices (expected_payment_date, payment_status, outstanding_amount);

CREATE INDEX IF NOT EXISTS project_invoices_nts_status_idx
  ON public.project_invoices (nts_issue_status, updated_at DESC);

COMMENT ON COLUMN public.project_invoices.planned_issue_date IS 'PM 예상 청구일정';
COMMENT ON COLUMN public.project_invoices.expected_payment_date IS '예상 입금일정';
COMMENT ON COLUMN public.project_invoices.request_payload IS '향후 국세청(전자세금계산서) 연동용 요청 payload';
COMMENT ON COLUMN public.project_invoices.nts_issue_status IS '국세청 연동 발행상태(pending/requested/issued/failed)';
