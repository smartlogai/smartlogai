-- Archive table HTML recovery (mail_references <-> time_entries)
-- 목적:
-- 1) entry_id 로 연결된 두 테이블의 work_description 중 더 온전한 HTML을 선택
-- 2) 특히 <table> 포함 HTML을 우선 보존
-- 3) 업데이트 전 백업 테이블에 원본 저장
--
-- 사용 순서:
--   A. [PREVIEW] 구간으로 대상/결과를 먼저 확인
--   B. 문제 없으면 [BACKUP + UPDATE] 구간 실행
--   C. [VERIFY] 구간으로 반영 결과 확인
--
-- 주의:
-- - Supabase SQL Editor 에서 실행 가능
-- - 운영 반영 전, 반드시 PREVIEW 결과를 샘플 점검하세요.

-- =========================================================
-- [PREVIEW] 어떤 값이 선택될지 미리 보기
-- =========================================================
WITH linked AS (
  SELECT
    mr.id AS ref_id,
    mr.entry_id,
    COALESCE(mr.work_description, '') AS mr_desc,
    COALESCE(te.work_description, '') AS te_desc
  FROM public.mail_references mr
  JOIN public.time_entries te ON te.id = mr.entry_id
  WHERE mr.entry_id IS NOT NULL
),
picked AS (
  SELECT
    ref_id,
    entry_id,
    mr_desc,
    te_desc,
    CASE
      WHEN mr_desc ~* '<table[\s>]' AND NOT (te_desc ~* '<table[\s>]') THEN mr_desc
      WHEN te_desc ~* '<table[\s>]' AND NOT (mr_desc ~* '<table[\s>]') THEN te_desc
      WHEN mr_desc ~* '<table[\s>]' AND te_desc ~* '<table[\s>]' THEN
        CASE WHEN length(mr_desc) >= length(te_desc) THEN mr_desc ELSE te_desc END
      ELSE
        CASE WHEN length(mr_desc) >= length(te_desc) THEN mr_desc ELSE te_desc END
    END AS chosen_desc
  FROM linked
)
SELECT
  ref_id,
  entry_id,
  length(mr_desc) AS mr_len,
  length(te_desc) AS te_len,
  length(chosen_desc) AS chosen_len,
  (mr_desc ~* '<table[\s>]') AS mr_has_table,
  (te_desc ~* '<table[\s>]') AS te_has_table,
  left(chosen_desc, 200) AS chosen_preview
FROM picked
WHERE mr_desc IS DISTINCT FROM te_desc
ORDER BY GREATEST(length(mr_desc), length(te_desc)) DESC
LIMIT 200;

-- =========================================================
-- [BACKUP + UPDATE] 실제 복구 적용
-- =========================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_archive_table_html_20260415 (
  backup_at bigint NOT NULL,
  ref_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  old_mr_desc text,
  old_te_desc text,
  chosen_desc text
);

WITH linked AS (
  SELECT
    mr.id AS ref_id,
    mr.entry_id,
    COALESCE(mr.work_description, '') AS mr_desc,
    COALESCE(te.work_description, '') AS te_desc
  FROM public.mail_references mr
  JOIN public.time_entries te ON te.id = mr.entry_id
  WHERE mr.entry_id IS NOT NULL
),
picked AS (
  SELECT
    ref_id,
    entry_id,
    mr_desc,
    te_desc,
    CASE
      WHEN mr_desc ~* '<table[\s>]' AND NOT (te_desc ~* '<table[\s>]') THEN mr_desc
      WHEN te_desc ~* '<table[\s>]' AND NOT (mr_desc ~* '<table[\s>]') THEN te_desc
      WHEN mr_desc ~* '<table[\s>]' AND te_desc ~* '<table[\s>]' THEN
        CASE WHEN length(mr_desc) >= length(te_desc) THEN mr_desc ELSE te_desc END
      ELSE
        CASE WHEN length(mr_desc) >= length(te_desc) THEN mr_desc ELSE te_desc END
    END AS chosen_desc
  FROM linked
),
targets AS (
  SELECT *
  FROM picked
  WHERE (mr_desc IS DISTINCT FROM chosen_desc OR te_desc IS DISTINCT FROM chosen_desc)
    AND chosen_desc <> ''
),
backup_insert AS (
  INSERT INTO public.backup_archive_table_html_20260415 (
    backup_at, ref_id, entry_id, old_mr_desc, old_te_desc, chosen_desc
  )
  SELECT
    (EXTRACT(epoch FROM now()) * 1000)::bigint,
    ref_id,
    entry_id,
    mr_desc,
    te_desc,
    chosen_desc
  FROM targets
  RETURNING ref_id, entry_id, chosen_desc
),
update_ref AS (
  UPDATE public.mail_references mr
  SET
    work_description = bi.chosen_desc,
    updated_at = (EXTRACT(epoch FROM now()) * 1000)::bigint
  FROM backup_insert bi
  WHERE mr.id = bi.ref_id
  RETURNING mr.id
),
update_entry AS (
  UPDATE public.time_entries te
  SET
    work_description = bi.chosen_desc,
    updated_at = (EXTRACT(epoch FROM now()) * 1000)::bigint
  FROM backup_insert bi
  WHERE te.id = bi.entry_id
  RETURNING te.id
)
SELECT
  (SELECT count(*) FROM backup_insert) AS backed_up_rows,
  (SELECT count(*) FROM update_ref) AS updated_mail_references,
  (SELECT count(*) FROM update_entry) AS updated_time_entries;

COMMIT;

-- =========================================================
-- [VERIFY] 복구 후 table 포함 HTML이 양쪽 동기화되었는지 확인
-- =========================================================
SELECT
  mr.id AS ref_id,
  mr.entry_id,
  (mr.work_description ~* '<table[\s>]') AS mr_has_table,
  (te.work_description ~* '<table[\s>]') AS te_has_table,
  (mr.work_description IS NOT DISTINCT FROM te.work_description) AS desc_synced,
  length(COALESCE(mr.work_description, '')) AS mr_len,
  length(COALESCE(te.work_description, '')) AS te_len
FROM public.mail_references mr
JOIN public.time_entries te ON te.id = mr.entry_id
WHERE mr.entry_id IS NOT NULL
ORDER BY mr.updated_at DESC NULLS LAST
LIMIT 200;

