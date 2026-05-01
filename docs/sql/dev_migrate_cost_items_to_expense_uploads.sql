-- project_cost_items -> project_expense_uploads 초기 이행(선택 실행)
-- 주의:
-- - 인건비성/자동배부 데이터는 제외
-- - 이미 동일 조건으로 적재된 경우 중복 삽입 방지를 위해 ON CONFLICT는 사용하지 않음
-- - 운영 적용 전 반드시 SELECT로 건수 확인 권장

-- 사전 점검
-- SELECT COUNT(*) AS candidate_rows
-- FROM public.project_cost_items c
-- WHERE NOT (
--   lower(coalesce(c.cost_type, '')) LIKE '%직접인건%'
--   OR lower(coalesce(c.cost_type, '')) LIKE '%인건비%'
--   OR lower(coalesce(c.cost_type, '')) LIKE '%labor%'
-- )
-- AND coalesce(c.note, '') NOT LIKE '[AUTO_COST_ALLOC:%';

INSERT INTO public.project_expense_uploads (
  upload_batch_id,
  upload_month,
  source_file_name,
  source_row_no,
  project_id,
  project_code,
  project_name,
  client_id,
  client_name,
  expense_date,
  expense_type,
  vendor,
  amount,
  vat_amount,
  total_amount,
  note,
  is_billable,
  billing_status,
  linked_invoice_id,
  uploaded_by,
  uploaded_by_name,
  created_at,
  updated_at
)
SELECT
  'MIGRATED_COST_ITEMS' AS upload_batch_id,
  to_char(coalesce(c.cost_date::date, to_timestamp(coalesce(c.created_at, 0) / 1000)::date), 'YYYY-MM') AS upload_month,
  'migrated-from-project_cost_items' AS source_file_name,
  row_number() OVER (
    PARTITION BY c.project_code
    ORDER BY coalesce(c.cost_date::date, to_timestamp(coalesce(c.created_at, 0) / 1000)::date), c.id
  ) AS source_row_no,
  coalesce(c.project_id, '') AS project_id,
  coalesce(c.project_code, '') AS project_code,
  coalesce(c.project_name, '') AS project_name,
  coalesce(c.client_id, '') AS client_id,
  coalesce(c.client_name, '') AS client_name,
  c.cost_date::date AS expense_date,
  coalesce(c.cost_type, '') AS expense_type,
  coalesce(c.vendor, '') AS vendor,
  coalesce(c.amount, 0) AS amount,
  coalesce(c.vat, 0) AS vat_amount,
  coalesce(c.total_amount, coalesce(c.amount, 0) + coalesce(c.vat, 0)) AS total_amount,
  coalesce(c.note, '') AS note,
  (
    coalesce(c.cost_purpose, 'internal') IN ('billable', 'both')
    AND coalesce(c.billable_amount, 0) > 0
  ) AS is_billable,
  coalesce(nullif(c.billing_status, ''), CASE WHEN coalesce(c.cost_purpose, 'internal') = 'internal' THEN 'excluded' ELSE 'unbilled' END) AS billing_status,
  coalesce(c.linked_invoice_id, '') AS linked_invoice_id,
  coalesce(c.created_by, '') AS uploaded_by,
  coalesce(c.created_by_name, '') AS uploaded_by_name,
  coalesce(c.created_at, (extract(epoch from now()) * 1000)::bigint) AS created_at,
  coalesce(c.updated_at, c.created_at, (extract(epoch from now()) * 1000)::bigint) AS updated_at
FROM public.project_cost_items c
WHERE coalesce(c.project_code, '') <> ''
  AND NOT (
    lower(coalesce(c.cost_type, '')) LIKE '%직접인건%'
    OR lower(coalesce(c.cost_type, '')) LIKE '%인건비%'
    OR lower(coalesce(c.cost_type, '')) LIKE '%labor%'
  )
  AND coalesce(c.note, '') NOT LIKE '[AUTO_COST_ALLOC:%';

