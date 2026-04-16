-- Smart Log AI (DEV) — users.sheet_type 추가
-- 목적:
-- 1) 사용자별 기본 타임시트 모듈(hourly/daily) 지정
-- 2) 기존 timesheet_hourly/timesheet_daily 플래그와 병행 운영

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sheet_type text;

-- 기존 데이터 백필:
-- daily만 활성인 사용자는 daily, 그 외는 hourly
UPDATE public.users
   SET sheet_type = CASE
     WHEN timesheet_daily = true AND COALESCE(timesheet_hourly, true) = false THEN 'daily'
     ELSE 'hourly'
   END
 WHERE sheet_type IS NULL
    OR sheet_type = '';

ALTER TABLE public.users
  ALTER COLUMN sheet_type SET DEFAULT 'hourly';

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_sheet_type_chk;

ALTER TABLE public.users
  ADD CONSTRAINT users_sheet_type_chk
  CHECK (sheet_type IN ('hourly', 'daily'));

COMMIT;
