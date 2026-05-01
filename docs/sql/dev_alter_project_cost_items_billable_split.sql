-- project_cost_items: 원가관리 / 고객청구 분리 확장

ALTER TABLE IF EXISTS public.project_cost_items
  ADD COLUMN IF NOT EXISTS cost_purpose text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS billable_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billable_currency text NOT NULL DEFAULT 'KRW',
  ADD COLUMN IF NOT EXISTS billable_fx_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled',
  ADD COLUMN IF NOT EXISTS linked_invoice_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_note text NOT NULL DEFAULT '';

-- 기존 데이터 백필
UPDATE public.project_cost_items
SET
  cost_purpose = COALESCE(NULLIF(cost_purpose, ''), 'internal'),
  billable_amount = COALESCE(billable_amount, 0),
  billable_currency = COALESCE(NULLIF(billable_currency, ''), 'KRW'),
  billable_fx_amount = COALESCE(billable_fx_amount, 0),
  billing_status = COALESCE(NULLIF(billing_status, ''), CASE WHEN COALESCE(cost_purpose, 'internal') = 'internal' THEN 'excluded' ELSE 'unbilled' END),
  linked_invoice_id = COALESCE(linked_invoice_id, ''),
  billing_note = COALESCE(billing_note, '');

ALTER TABLE IF EXISTS public.project_cost_items
  DROP CONSTRAINT IF EXISTS project_cost_items_cost_purpose_chk;
ALTER TABLE IF EXISTS public.project_cost_items
  ADD CONSTRAINT project_cost_items_cost_purpose_chk
  CHECK (cost_purpose IN ('internal', 'billable', 'both'));

ALTER TABLE IF EXISTS public.project_cost_items
  DROP CONSTRAINT IF EXISTS project_cost_items_billing_status_chk;
ALTER TABLE IF EXISTS public.project_cost_items
  ADD CONSTRAINT project_cost_items_billing_status_chk
  CHECK (billing_status IN ('unbilled', 'requested', 'billed', 'paid', 'excluded'));

CREATE INDEX IF NOT EXISTS project_cost_items_purpose_status_idx
  ON public.project_cost_items (project_code, cost_purpose, billing_status, cost_date);

COMMENT ON COLUMN public.project_cost_items.cost_purpose IS '비용 관리 목적(internal/billable/both)';
COMMENT ON COLUMN public.project_cost_items.billable_amount IS '고객사 청구 대상 원화 금액';
COMMENT ON COLUMN public.project_cost_items.billable_currency IS '외화 청구 통화코드(KRW/USD/EUR/JPY/...)';
COMMENT ON COLUMN public.project_cost_items.billable_fx_amount IS '고객사 청구 대상 외화 금액';
COMMENT ON COLUMN public.project_cost_items.billing_status IS '청구 진행 상태(unbilled/requested/billed/paid/excluded)';
COMMENT ON COLUMN public.project_cost_items.linked_invoice_id IS '연결된 청구/인보이스 ID';
COMMENT ON COLUMN public.project_cost_items.billing_note IS '청구 관리 메모';
