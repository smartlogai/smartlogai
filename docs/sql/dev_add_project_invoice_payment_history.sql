-- project_invoices 입금 이력 분리
-- - project_invoice_payments: 회차별 입금(일자/금액/메모)
-- - project_invoices.paid_amount: 누적 입금액(표시/정합성용)

CREATE TABLE IF NOT EXISTS public.project_invoice_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          text NOT NULL DEFAULT '',
  project_code        text NOT NULL DEFAULT '',
  paid_date           date NOT NULL,
  paid_amount         numeric(18,2) NOT NULL DEFAULT 0,
  note                text NOT NULL DEFAULT '',
  created_by          text NOT NULL DEFAULT '',
  created_by_name     text NOT NULL DEFAULT '',
  created_at          bigint NOT NULL DEFAULT public.now_ms(),
  updated_at          bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS idx_project_invoice_payments_invoice_id
  ON public.project_invoice_payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_project_invoice_payments_project_code
  ON public.project_invoice_payments(project_code);

CREATE INDEX IF NOT EXISTS idx_project_invoice_payments_paid_date
  ON public.project_invoice_payments(paid_date);

-- 기존 누적입금 데이터 백필(이미 이력이 없는 건만 1건 생성)
INSERT INTO public.project_invoice_payments (
  invoice_id, project_code, paid_date, paid_amount, note,
  created_by, created_by_name, created_at, updated_at
)
SELECT
  i.id::text,
  COALESCE(i.project_code, ''),
  COALESCE(NULLIF(i.paid_date::text, ''), to_char(to_timestamp(COALESCE(i.paid_at, i.updated_at, i.created_at, public.now_ms()) / 1000.0), 'YYYY-MM-DD'))::date,
  COALESCE(i.paid_amount, 0),
  '[MIGRATION] 기존 누적입금 백필',
  COALESCE(i.payment_confirmed_by, ''),
  COALESCE(i.payment_confirmed_by_name, ''),
  COALESCE(i.payment_confirmed_at, i.updated_at, i.created_at, public.now_ms()),
  COALESCE(i.payment_confirmed_at, i.updated_at, i.created_at, public.now_ms())
FROM public.project_invoices i
LEFT JOIN (
  SELECT invoice_id, COUNT(*) cnt
  FROM public.project_invoice_payments
  GROUP BY invoice_id
) p ON p.invoice_id = i.id::text
WHERE COALESCE(i.paid_amount, 0) > 0
  AND COALESCE(p.cnt, 0) = 0;

COMMENT ON TABLE public.project_invoice_payments IS '세금계산서 회차별 입금 이력';
COMMENT ON COLUMN public.project_invoice_payments.invoice_id IS 'project_invoices.id';
COMMENT ON COLUMN public.project_invoice_payments.paid_date IS '실입금일';
COMMENT ON COLUMN public.project_invoice_payments.paid_amount IS '회차별 입금금액';
COMMENT ON COLUMN public.project_invoice_payments.note IS '입금 메모';
