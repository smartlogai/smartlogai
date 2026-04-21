-- dev_backfill_project_subcategory_from_project_code.sql
-- 목적:
--   프로젝트업무(time_entries) 과거 데이터의 work_subcategory_name 을
--   project_code_types 기준 소분류로 일괄 정정한다.
--
-- 매핑 우선순위:
--   1) time_entries.project_code 의 MAIN_CODE + SUB_CODE 파싱 매핑
--   2) registered_projects.project_code_type_id 매핑
--
-- 반영 조건:
--   - work_category_name = '프로젝트업무'
--   - project_code 가 비어있지 않음
--   - 매핑된 소분류가 존재함
--   - 기존 work_subcategory_name 과 매핑 소분류가 다름
--
-- 주의:
--   임시테이블을 쓰지 않는 버전입니다.
--   SQL Editor에서 "부분 실행"해도 relation not exist 오류가 나지 않습니다.

DO $$
BEGIN
  IF to_regclass('public.time_entries') IS NULL THEN
    RAISE EXCEPTION 'public.time_entries table not found';
  END IF;
  IF to_regclass('public.project_code_types') IS NULL THEN
    RAISE EXCEPTION 'public.project_code_types table not found';
  END IF;
  IF to_regclass('public.registered_projects') IS NULL THEN
    RAISE EXCEPTION 'public.registered_projects table not found';
  END IF;
END $$;

-- 1) 반영 대상 요약
WITH mapped AS (
  SELECT
    te.id AS entry_id,
    te.project_code,
    trim(coalesce(te.work_subcategory_name, '')) AS before_subcategory,
    trim(coalesce(
      pct_by_code.sub_category,
      pct_by_reg.sub_category,
      ''
    )) AS after_subcategory,
    CASE
      WHEN pct_by_code.sub_category IS NOT NULL THEN 'code_parse'
      WHEN pct_by_reg.sub_category IS NOT NULL THEN 'registered_project_type'
      ELSE 'unresolved'
    END AS resolved_by
  FROM public.time_entries te
  LEFT JOIN public.project_code_types pct_by_code
    ON pct_by_code.main_code = split_part(trim(coalesce(te.project_code, '')), '_', 1)
   AND pct_by_code.sub_code  = split_part(trim(coalesce(te.project_code, '')), '_', 2)
  LEFT JOIN public.registered_projects rp
    ON trim(coalesce(rp.project_code, '')) = trim(coalesce(te.project_code, ''))
  LEFT JOIN public.project_code_types pct_by_reg
    ON pct_by_reg.id = rp.project_code_type_id
  WHERE trim(coalesce(te.work_category_name, '')) = '프로젝트업무'
    AND trim(coalesce(te.project_code, '')) <> ''
),
target AS (
  SELECT *
  FROM mapped
  WHERE after_subcategory <> ''
    AND before_subcategory IS DISTINCT FROM after_subcategory
)
SELECT
  count(*) AS target_rows,
  count(*) FILTER (WHERE before_subcategory = '기타') AS before_was_gita,
  count(*) FILTER (WHERE resolved_by = 'code_parse') AS resolved_by_code_parse,
  count(*) FILTER (WHERE resolved_by = 'registered_project_type') AS resolved_by_registered_project
FROM target;

-- 2) 샘플(최대 50건) 확인
WITH mapped AS (
  SELECT
    te.id AS entry_id,
    te.project_code,
    trim(coalesce(te.work_subcategory_name, '')) AS before_subcategory,
    trim(coalesce(
      pct_by_code.sub_category,
      pct_by_reg.sub_category,
      ''
    )) AS after_subcategory,
    CASE
      WHEN pct_by_code.sub_category IS NOT NULL THEN 'code_parse'
      WHEN pct_by_reg.sub_category IS NOT NULL THEN 'registered_project_type'
      ELSE 'unresolved'
    END AS resolved_by
  FROM public.time_entries te
  LEFT JOIN public.project_code_types pct_by_code
    ON pct_by_code.main_code = split_part(trim(coalesce(te.project_code, '')), '_', 1)
   AND pct_by_code.sub_code  = split_part(trim(coalesce(te.project_code, '')), '_', 2)
  LEFT JOIN public.registered_projects rp
    ON trim(coalesce(rp.project_code, '')) = trim(coalesce(te.project_code, ''))
  LEFT JOIN public.project_code_types pct_by_reg
    ON pct_by_reg.id = rp.project_code_type_id
  WHERE trim(coalesce(te.work_category_name, '')) = '프로젝트업무'
    AND trim(coalesce(te.project_code, '')) <> ''
)
SELECT
  entry_id,
  project_code,
  before_subcategory,
  after_subcategory,
  resolved_by
FROM mapped
WHERE after_subcategory <> ''
  AND before_subcategory IS DISTINCT FROM after_subcategory
ORDER BY project_code, entry_id
LIMIT 50;

BEGIN;

-- 3) 실제 업데이트
WITH mapped AS (
  SELECT
    te.id AS entry_id,
    trim(coalesce(te.work_subcategory_name, '')) AS before_subcategory,
    trim(coalesce(
      pct_by_code.sub_category,
      pct_by_reg.sub_category,
      ''
    )) AS after_subcategory
  FROM public.time_entries te
  LEFT JOIN public.project_code_types pct_by_code
    ON pct_by_code.main_code = split_part(trim(coalesce(te.project_code, '')), '_', 1)
   AND pct_by_code.sub_code  = split_part(trim(coalesce(te.project_code, '')), '_', 2)
  LEFT JOIN public.registered_projects rp
    ON trim(coalesce(rp.project_code, '')) = trim(coalesce(te.project_code, ''))
  LEFT JOIN public.project_code_types pct_by_reg
    ON pct_by_reg.id = rp.project_code_type_id
  WHERE trim(coalesce(te.work_category_name, '')) = '프로젝트업무'
    AND trim(coalesce(te.project_code, '')) <> ''
),
target AS (
  SELECT entry_id, after_subcategory
  FROM mapped
  WHERE after_subcategory <> ''
    AND before_subcategory IS DISTINCT FROM after_subcategory
),
updated AS (
  UPDATE public.time_entries te
     SET work_subcategory_name = t.after_subcategory
    FROM target t
   WHERE te.id = t.entry_id
  RETURNING te.id
)
SELECT count(*) AS updated_rows FROM updated;

-- 4) 사후 검증 1: 여전히 '기타'로 남아있는 프로젝트업무 건수
SELECT
  count(*) AS remained_gita_rows
FROM public.time_entries te
WHERE trim(coalesce(te.work_category_name, '')) = '프로젝트업무'
  AND trim(coalesce(te.project_code, '')) <> ''
  AND trim(coalesce(te.work_subcategory_name, '')) = '기타';

-- 5) 사후 검증 2: 소분류 비어있는 프로젝트업무 건수
SELECT
  count(*) AS remained_empty_subcategory_rows
FROM public.time_entries te
WHERE trim(coalesce(te.work_category_name, '')) = '프로젝트업무'
  AND trim(coalesce(te.project_code, '')) <> ''
  AND trim(coalesce(te.work_subcategory_name, '')) = '';

COMMIT;

