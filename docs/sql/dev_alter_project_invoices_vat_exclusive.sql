-- project_invoices VAT 별도(공급가액 기준) 확장
-- 정책:
-- - invoice_amount: 공급가액(세전)
-- - vat_amount: 부가세
-- - total_amount: 합계(공급가액 + 부가세)
-- - tax_type: taxable/zero_rated/exempt

ALTER TABLE IF EXISTS public.project_invoices
  ADD COLUMN IF NOT EXISTS tax_type text NOT NULL DEFAULT 'taxable',
  ADD COLUMN IF NOT EXISTS vat_rate numeric(6,4) NOT NULL DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS vat_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount numeric(18,2) NOT NULL DEFAULT 0;

-- 기존 데이터 백필 (기본 10%)
UPDATE public.project_invoices
SET
  vat_rate = CASE
    WHEN COALESCE(tax_type, 'taxable') IN ('zero_rated', 'exempt') THEN 0
    ELSE COALESCE(NULLIF(vat_rate, 0), 0.1)
  END,
  vat_amount = CASE
    WHEN COALESCE(tax_type, 'taxable') IN ('zero_rated', 'exempt') THEN 0
    ELSE ROUND(COALESCE(invoice_amount, 0) * COALESCE(NULLIF(vat_rate, 0), 0.1), 2)
  END,
  total_amount = CASE
    WHEN COALESCE(tax_type, 'taxable') IN ('zero_rated', 'exempt') THEN COALESCE(invoice_amount, 0)
    ELSE ROUND(
      COALESCE(invoice_amount, 0)
      + (COALESCE(invoice_amount, 0) * COALESCE(NULLIF(vat_rate, 0), 0.1)),
      2
    )
  END;

ALTER TABLE IF EXISTS public.project_invoices
  DROP CONSTRAINT IF EXISTS project_invoices_tax_type_chk;
ALTER TABLE IF EXISTS public.project_invoices
  ADD CONSTRAINT project_invoices_tax_type_chk
  CHECK (tax_type IN ('taxable', 'zero_rated', 'exempt'));

COMMENT ON COLUMN public.project_invoices.invoice_amount IS '공급가액(세전, VAT 별도)';
COMMENT ON COLUMN public.project_invoices.vat_rate IS '부가세율(기본 0.1)';
COMMENT ON COLUMN public.project_invoices.vat_amount IS '부가세 금액';
COMMENT ON COLUMN public.project_invoices.total_amount IS '합계금액(공급가액+부가세)';
COMMENT ON COLUMN public.project_invoices.tax_type IS '과세유형(taxable/zero_rated/exempt)';
