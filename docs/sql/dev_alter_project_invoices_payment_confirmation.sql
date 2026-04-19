-- project_invoices 입금확인 컬럼 추가
-- 실행 순서: dev_alter_project_invoices_nts_ready.sql 이후

ALTER TABLE IF EXISTS public.project_invoices
  ADD COLUMN IF NOT EXISTS paid_date date,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_confirmed_by_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_confirmed_at bigint;

CREATE INDEX IF NOT EXISTS project_invoices_paid_date_idx
  ON public.project_invoices (paid_date, payment_status, updated_at DESC);

COMMENT ON COLUMN public.project_invoices.paid_date IS '입금일자';
COMMENT ON COLUMN public.project_invoices.payment_confirmed_by IS '입금확인자 ID';
COMMENT ON COLUMN public.project_invoices.payment_confirmed_by_name IS '입금확인자명';
COMMENT ON COLUMN public.project_invoices.payment_confirmed_at IS '입금확인 처리시각(ms)';
