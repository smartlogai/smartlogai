-- Restore target case to earliest available snapshot
-- 대상: 문서번호 ID2404140041
-- 목적: 테스트 과정에서 훼손된 자문 본문(work_description)을
--      백업 테이블의 "가장 이른 시점(old_*)" 값으로 복구
--
-- 사용 순서:
-- 1) [PREVIEW] 실행: 대상 ref_id/entry_id와 복구 후보 미리 확인
-- 2) [RESTORE] 실행: mail_references + time_entries 동시 복구
-- 3) [VERIFY] 실행: 최종 반영 확인
--
-- 주의:
-- - 이 스크립트는 백업 테이블이 있을 때만 복구 가능
-- - 백업이 없으면 rows=0 으로 나오며 UPDATE가 수행되지 않음

-- =========================================================
-- [SAFE GUARD] 백업 테이블이 없어도 쿼리 실패하지 않게 보장
-- =========================================================
CREATE TABLE IF NOT EXISTS public.backup_archive_table_html_targeted_20260415 (
  backup_at bigint NOT NULL,
  ref_id uuid NOT NULL,
  entry_id uuid,
  old_mr_desc text,
  old_te_desc text,
  chosen_desc text
);

CREATE TABLE IF NOT EXISTS public.backup_archive_table_html_20260415 (
  backup_at bigint NOT NULL,
  ref_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  old_mr_desc text,
  old_te_desc text,
  chosen_desc text
);

-- =========================================================
-- [PREVIEW] 대상/후보 확인
-- =========================================================
WITH target AS (
  SELECT
    mr.id AS ref_id,
    mr.entry_id,
    te.doc_no
  FROM public.mail_references mr
  JOIN public.time_entries te ON te.id = mr.entry_id
  WHERE te.doc_no = 'ID2404140041'
  ORDER BY mr.created_at ASC
  LIMIT 1
),
candidates AS (
  SELECT
    'backup_targeted' AS src,
    b.backup_at,
    b.ref_id,
    b.entry_id,
    COALESCE(NULLIF(b.old_mr_desc, ''), NULLIF(b.old_te_desc, '')) AS restored_desc
  FROM public.backup_archive_table_html_targeted_20260415 b
  JOIN target t ON t.ref_id = b.ref_id
  UNION ALL
  SELECT
    'backup_full' AS src,
    b.backup_at,
    b.ref_id,
    b.entry_id,
    COALESCE(NULLIF(b.old_mr_desc, ''), NULLIF(b.old_te_desc, '')) AS restored_desc
  FROM public.backup_archive_table_html_20260415 b
  JOIN target t ON t.ref_id = b.ref_id
),
picked AS (
  SELECT *
  FROM candidates
  WHERE restored_desc IS NOT NULL
  ORDER BY backup_at ASC, length(restored_desc) DESC
  LIMIT 1
)
SELECT
  t.doc_no,
  t.ref_id,
  t.entry_id,
  p.src AS picked_source,
  p.backup_at AS picked_backup_at,
  length(p.restored_desc) AS picked_len,
  (p.restored_desc ~* '<table[\s>]') AS picked_has_table,
  left(p.restored_desc, 300) AS picked_preview
FROM target t
LEFT JOIN picked p ON true;


-- =========================================================
-- [RESTORE] 실제 복구 적용
-- =========================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_restore_ID2404140041_before_apply (
  backup_at bigint NOT NULL,
  doc_no text NOT NULL,
  ref_id uuid NOT NULL,
  entry_id uuid,
  old_mr_desc text,
  old_te_desc text,
  applied_desc text
);

WITH target AS (
  SELECT
    mr.id AS ref_id,
    mr.entry_id,
    te.doc_no
  FROM public.mail_references mr
  JOIN public.time_entries te ON te.id = mr.entry_id
  WHERE te.doc_no = 'ID2404140041'
  ORDER BY mr.created_at ASC
  LIMIT 1
),
candidates AS (
  SELECT
    b.backup_at,
    b.ref_id,
    b.entry_id,
    COALESCE(NULLIF(b.old_mr_desc, ''), NULLIF(b.old_te_desc, '')) AS restored_desc
  FROM public.backup_archive_table_html_targeted_20260415 b
  JOIN target t ON t.ref_id = b.ref_id
  UNION ALL
  SELECT
    b.backup_at,
    b.ref_id,
    b.entry_id,
    COALESCE(NULLIF(b.old_mr_desc, ''), NULLIF(b.old_te_desc, '')) AS restored_desc
  FROM public.backup_archive_table_html_20260415 b
  JOIN target t ON t.ref_id = b.ref_id
),
picked AS (
  SELECT *
  FROM candidates
  WHERE restored_desc IS NOT NULL
  ORDER BY backup_at ASC, length(restored_desc) DESC
  LIMIT 1
),
current_rows AS (
  SELECT
    t.doc_no,
    t.ref_id,
    t.entry_id,
    mr.work_description AS old_mr_desc,
    te.work_description AS old_te_desc,
    p.restored_desc     AS applied_desc
  FROM target t
  JOIN public.mail_references mr ON mr.id = t.ref_id
  LEFT JOIN public.time_entries te ON te.id = t.entry_id
  JOIN picked p ON p.ref_id = t.ref_id
),
backup_insert AS (
  INSERT INTO public.backup_restore_ID2404140041_before_apply (
    backup_at, doc_no, ref_id, entry_id, old_mr_desc, old_te_desc, applied_desc
  )
  SELECT
    (EXTRACT(epoch FROM now()) * 1000)::bigint,
    doc_no, ref_id, entry_id, old_mr_desc, old_te_desc, applied_desc
  FROM current_rows
  RETURNING ref_id, entry_id, applied_desc
),
update_ref AS (
  UPDATE public.mail_references mr
  SET
    work_description = b.applied_desc,
    body_text = b.applied_desc,
    updated_at = (EXTRACT(epoch FROM now()) * 1000)::bigint
  FROM backup_insert b
  WHERE mr.id = b.ref_id
  RETURNING mr.id
),
update_entry AS (
  UPDATE public.time_entries te
  SET
    work_description = b.applied_desc,
    updated_at = (EXTRACT(epoch FROM now()) * 1000)::bigint
  FROM backup_insert b
  WHERE te.id = b.entry_id
  RETURNING te.id
)
SELECT
  (SELECT count(*) FROM backup_insert) AS backed_up_rows,
  (SELECT count(*) FROM update_ref) AS updated_mail_references,
  (SELECT count(*) FROM update_entry) AS updated_time_entries;

COMMIT;


-- =========================================================
-- [VERIFY] 반영 확인
-- =========================================================
WITH target AS (
  SELECT
    mr.id AS ref_id,
    mr.entry_id,
    te.doc_no
  FROM public.mail_references mr
  JOIN public.time_entries te ON te.id = mr.entry_id
  WHERE te.doc_no = 'ID2404140041'
  ORDER BY mr.created_at ASC
  LIMIT 1
)
SELECT
  t.doc_no,
  t.ref_id,
  t.entry_id,
  length(COALESCE(mr.work_description, '')) AS mr_len,
  length(COALESCE(te.work_description, '')) AS te_len,
  (mr.work_description ~* '<table[\s>]') AS mr_has_table,
  (te.work_description ~* '<table[\s>]') AS te_has_table,
  (mr.work_description IS NOT DISTINCT FROM te.work_description) AS desc_synced,
  left(COALESCE(mr.work_description, ''), 300) AS mr_preview
FROM target t
JOIN public.mail_references mr ON mr.id = t.ref_id
LEFT JOIN public.time_entries te ON te.id = t.entry_id;

