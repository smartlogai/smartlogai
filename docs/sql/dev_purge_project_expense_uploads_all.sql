-- 프로젝트비용 업로드 원본 전체 초기화
-- 목적: project_expense_uploads 전체 삭제 후 재업로드
-- 주의: 운영 실행 전 반드시 백업 여부 확인

BEGIN;

-- 0) 현재 건수 확인
SELECT COUNT(*) AS before_count
FROM public.project_expense_uploads;

-- 1) 롤백 대비 백업 테이블 생성(없으면 생성, 있으면 이번 스냅샷만 추가)
CREATE TABLE IF NOT EXISTS public.project_expense_uploads_backup (
  backup_tag text NOT NULL,
  backup_at timestamptz NOT NULL DEFAULT now(),
  LIKE public.project_expense_uploads INCLUDING ALL
);

INSERT INTO public.project_expense_uploads_backup
SELECT
  ('purge-' || to_char(now(), 'YYYYMMDD-HH24MISS'))::text AS backup_tag,
  now() AS backup_at,
  t.*
FROM public.project_expense_uploads t;

-- 2) 전체 삭제
DELETE FROM public.project_expense_uploads;

-- 3) 삭제 결과 확인
SELECT COUNT(*) AS after_count
FROM public.project_expense_uploads;

COMMIT;

