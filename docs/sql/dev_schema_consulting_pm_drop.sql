-- Smart Log AI — Consulting PM Step1 객체 제거 (DEV에서 검증 후 실행)
-- dev_schema_consulting_pm.sql 로 생성된 트리거·함수·테이블을 역순으로 DROP 합니다.
-- 운영 DB에는 백업·영향 범위 확인 후 적용하세요.
-- now_ms() 는 다른 테이블에서 쓰고 있으면 DROP 하지 마세요(주석 처리).

-- 트리거
DROP TRIGGER IF EXISTS trg_contract_to_project_status ON public.project_contracts;
DROP TRIGGER IF EXISTS trg_touch_consulting_project_master ON public.consulting_project_master;
DROP TRIGGER IF EXISTS trg_touch_consulting_projects ON public.consulting_projects;
DROP TRIGGER IF EXISTS trg_touch_project_contracts ON public.project_contracts;

-- 트리거/비즈니스 함수 (테이블보다 먼저)
DROP FUNCTION IF EXISTS public.fn_contract_to_project_status();
DROP FUNCTION IF EXISTS public.fn_mark_project_in_progress_by_code(text, text, text);
DROP FUNCTION IF EXISTS public.fn_update_project_status(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.fn_log_project_status_change(uuid, text, text, text, text, text);

-- 테이블 (FK 순서)
DROP TABLE IF EXISTS public.project_status_logs;
DROP TABLE IF EXISTS public.project_contracts;
DROP TABLE IF EXISTS public.consulting_projects;
DROP TABLE IF EXISTS public.consulting_project_master;

-- consulting 전용 트리거에서만 사용한 경우에만 제거
DROP FUNCTION IF EXISTS public.fn_touch_updated_at();

-- 이 프로젝트에서만 정의·사용 중인 경우에만 실행 (다른 스키마가 now_ms 를 쓰면 생략)
-- DROP FUNCTION IF EXISTS public.now_ms();
