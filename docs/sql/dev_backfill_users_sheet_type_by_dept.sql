-- Smart Log AI (DEV) — users.sheet_type 소속 기준 재정렬
-- 기준:
--   CCB  -> daily
--   CRB/COB -> hourly
--   그 외 -> 기존값 유지, 없으면 hourly

BEGIN;

UPDATE public.users
   SET sheet_type = CASE
     WHEN upper(coalesce(dept_name, '')) LIKE '%CCB%' THEN 'daily'
     WHEN upper(coalesce(dept_name, '')) LIKE '%CRB%' THEN 'hourly'
     WHEN upper(coalesce(dept_name, '')) LIKE '%COB%' THEN 'hourly'
     WHEN sheet_type IN ('daily', 'hourly') THEN sheet_type
     ELSE 'hourly'
   END;

COMMIT;
