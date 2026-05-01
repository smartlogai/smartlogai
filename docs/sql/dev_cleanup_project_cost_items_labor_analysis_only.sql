-- project_cost_items: 인건비성 데이터 정리(Analysis 전용)
-- 목적:
-- 1) 과거 인건비 행을 고객청구 대상에서 제외
-- 2) 인건비 행은 project_profit / labor 분석에서는 유지
-- 3) 비용관리(Expense)와 인건비(Analysis) 운영 경계를 데이터로 고정

BEGIN;

-- [사전 확인] 인건비성 행 개수 확인
-- 필요 시 먼저 단독 실행해 확인하세요.
-- SELECT COUNT(*) AS labor_like_rows
-- FROM public.project_cost_items
-- WHERE lower(coalesce(cost_type, '')) LIKE '%직접인건%'
--    OR lower(coalesce(cost_type, '')) LIKE '%인건비%'
--    OR lower(coalesce(cost_type, '')) LIKE '%labor%';

UPDATE public.project_cost_items
SET
  cost_purpose = 'internal',
  billable_amount = 0,
  billable_currency = 'KRW',
  billable_fx_amount = 0,
  billing_status = 'excluded',
  linked_invoice_id = '',
  billing_note = CASE
    WHEN coalesce(billing_note, '') = '' THEN '[LABOR_ANALYSIS_ONLY] 인건비는 Analysis 탭에서만 관리'
    WHEN position('[LABOR_ANALYSIS_ONLY]' in billing_note) > 0 THEN billing_note
    ELSE billing_note || ' [LABOR_ANALYSIS_ONLY]'
  END
WHERE lower(coalesce(cost_type, '')) LIKE '%직접인건%'
   OR lower(coalesce(cost_type, '')) LIKE '%인건비%'
   OR lower(coalesce(cost_type, '')) LIKE '%labor%';

-- [사후 확인] 청구 대상 인건비 잔존 여부 확인 (0건 기대)
-- SELECT COUNT(*) AS labor_billable_rows
-- FROM public.project_cost_items
-- WHERE (
--   lower(coalesce(cost_type, '')) LIKE '%직접인건%'
--   OR lower(coalesce(cost_type, '')) LIKE '%인건비%'
--   OR lower(coalesce(cost_type, '')) LIKE '%labor%'
-- )
-- AND (
--   coalesce(cost_purpose, 'internal') <> 'internal'
--   OR coalesce(billable_amount, 0) > 0
--   OR coalesce(billable_fx_amount, 0) > 0
--   OR coalesce(billing_status, 'excluded') <> 'excluded'
-- );

COMMIT;

