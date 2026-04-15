-- Archive table HTML targeted recovery (specific ref_id only)
-- 목적:
-- - 제보된 건(ref_id 목록)만 선택적으로 복구
-- - 전체 일괄 UPDATE 없이 안전하게 소량 반영
--
-- 사용 방법:
-- 1) 아래 target_ids CTE의 VALUES에 ref_id를 입력
-- 2) [PREVIEW] 실행 후 선택 결과 검토
-- 3) [BACKUP + UPDATE] 실행
-- 4) [VERIFY] 실행

-- =========================================================
-- 0) 대상 ref_id 입력 (여기만 수정)
-- =========================================================
WITH target_ids(ref_id) AS (
  VALUES
    ('00000000-0000-0000-0000-000000000000'::uuid)
    -- ,('11111111-1111-1111-1111-111111111111'::uuid)
)
SELECT ref_id FROM target_ids;

-- =========================================================
-- [PREVIEW] 대상 건만 선택 결과 확인
-- =========================================================
WITH target_ids(ref_id) AS (
  VALUES
    ('00000000-0000-0000-0000-000000000000'::uuid)
),
linked AS (
  SELECT
    mr.id AS ref_id,
    mr.entry_id,
    COALESCE(mr.work_description, '') AS mr_desc,
    COALESCE(te.work_description, '') AS te_desc
  FROM public.mail_references mr
  LEFT JOIN public.time_entries te ON te.id = mr.entry_id
  JOIN target_ids t ON t.ref_id = mr.id
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
ORDER BY ref_id;

-- =========================================================
-- [BACKUP + UPDATE] 대상 건만 복구 적용
-- =========================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_archive_table_html_targeted_20260415 (
  backup_at bigint NOT NULL,
  ref_id uuid NOT NULL,
  entry_id uuid,
  old_mr_desc text,
  old_te_desc text,
  chosen_desc text
);

WITH target_ids(ref_id) AS (
  VALUES
    ('00000000-0000-0000-0000-000000000000'::uuid)
),
linked AS (
  SELECT
    mr.id AS ref_id,
    mr.entry_id,
    COALESCE(mr.work_description, '') AS mr_desc,
    COALESCE(te.work_description, '') AS te_desc
  FROM public.mail_references mr
  LEFT JOIN public.time_entries te ON te.id = mr.entry_id
  JOIN target_ids t ON t.ref_id = mr.id
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
  WHERE chosen_desc <> ''
),
backup_insert AS (
  INSERT INTO public.backup_archive_table_html_targeted_20260415 (
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
-- [VERIFY] 대상 건 반영 확인
-- =========================================================
WITH target_ids(ref_id) AS (
  VALUES
    ('00000000-0000-0000-0000-000000000000'::uuid)
)
SELECT
  mr.id AS ref_id,
  mr.entry_id,
  (mr.work_description ~* '<table[\s>]') AS mr_has_table,
  (te.work_description ~* '<table[\s>]') AS te_has_table,
  (mr.work_description IS NOT DISTINCT FROM te.work_description) AS desc_synced,
  length(COALESCE(mr.work_description, '')) AS mr_len,
  length(COALESCE(te.work_description, '')) AS te_len
FROM public.mail_references mr
LEFT JOIN public.time_entries te ON te.id = mr.entry_id
JOIN target_ids t ON t.ref_id = mr.id
ORDER BY mr.updated_at DESC NULLS LAST;

