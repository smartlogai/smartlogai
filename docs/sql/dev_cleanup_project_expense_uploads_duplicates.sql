-- project_expense_uploads 중복 정리 (운영 전 백업 권장)
-- 기준: project_code + expense_date + expense_type + amount + vendor(비용내역) + note 동일 행
-- 정책: linked_invoice_id 가 있는 행 우선 보존, 그 다음 updated_at/created_at 최신 행 보존

BEGIN;

-- 1) 삭제 대상 미리보기
WITH ranked AS (
  SELECT
    id,
    upload_batch_id,
    project_code,
    expense_date,
    expense_type,
    amount,
    vendor,
    note,
    linked_invoice_id,
    billing_status,
    updated_at,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE(project_code, ''),
        COALESCE(expense_date::text, ''),
        COALESCE(expense_type, ''),
        ROUND(COALESCE(amount, 0)::numeric, 2),
        COALESCE(vendor, ''),
        COALESCE(note, '')
      ORDER BY
        CASE WHEN COALESCE(linked_invoice_id, '') <> '' THEN 0 ELSE 1 END,
        COALESCE(updated_at, 0) DESC,
        COALESCE(created_at, 0) DESC,
        id DESC
    ) AS rn
  FROM public.project_expense_uploads
),
to_delete AS (
  SELECT * FROM ranked WHERE rn > 1
)
SELECT
  COUNT(*) AS duplicate_rows,
  COUNT(DISTINCT project_code) AS affected_project_count
FROM to_delete;

-- 2) 실제 삭제
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE(project_code, ''),
        COALESCE(expense_date::text, ''),
        COALESCE(expense_type, ''),
        ROUND(COALESCE(amount, 0)::numeric, 2),
        COALESCE(vendor, ''),
        COALESCE(note, '')
      ORDER BY
        CASE WHEN COALESCE(linked_invoice_id, '') <> '' THEN 0 ELSE 1 END,
        COALESCE(updated_at, 0) DESC,
        COALESCE(created_at, 0) DESC,
        id DESC
    ) AS rn
  FROM public.project_expense_uploads
),
del AS (
  DELETE FROM public.project_expense_uploads p
  USING ranked r
  WHERE p.id = r.id
    AND r.rn > 1
  RETURNING p.id
)
SELECT COUNT(*) AS deleted_rows FROM del;

-- 결과 확인 후 COMMIT / ROLLBACK 선택
COMMIT;

