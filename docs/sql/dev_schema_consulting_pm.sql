-- Smart Log AI — Consulting PM Step1 schema (DEV only)
-- Run after dev_schema_minimal.sql and dev_schema_app_extensions.sql.

CREATE OR REPLACE FUNCTION public.now_ms()
RETURNS bigint
LANGUAGE sql
AS $$
  SELECT (EXTRACT(epoch FROM now()) * 1000)::bigint
$$;

-- Step1-1) 프로젝트 코드 마스터
CREATE TABLE IF NOT EXISTS public.consulting_project_master (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  main_category             text NOT NULL DEFAULT '',
  main_code                 text NOT NULL DEFAULT '',
  sub_category              text NOT NULL DEFAULT '',
  sub_code                  text NOT NULL DEFAULT '',
  project_code              text NOT NULL UNIQUE,
  project_name              text NOT NULL DEFAULT '',
  clearance_note_required   boolean NOT NULL DEFAULT false, -- 통관유의사항='해당'
  created_at                bigint NOT NULL DEFAULT public.now_ms(),
  updated_at                bigint NOT NULL DEFAULT public.now_ms()
);

-- Step1-2) 컨설팅 프로젝트
CREATE TABLE IF NOT EXISTS public.consulting_projects (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code               text NOT NULL,
  project_name               text NOT NULL DEFAULT '',
  client_id                  text DEFAULT '',
  client_name                text DEFAULT '',
  status                     text NOT NULL DEFAULT 'contract_completed',
  requires_clearance_note    boolean NOT NULL DEFAULT false,
  contract_uploaded_at       bigint,
  first_timesheet_at         bigint,
  created_by                 text DEFAULT '',
  created_by_name            text DEFAULT '',
  updated_by                 text DEFAULT '',
  updated_by_name            text DEFAULT '',
  created_at                 bigint NOT NULL DEFAULT public.now_ms(),
  updated_at                 bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT consulting_projects_status_chk
    CHECK (status IN ('contract_completed', 'in_progress', 'closing', 'closed'))
);

CREATE INDEX IF NOT EXISTS consulting_projects_project_code_idx
  ON public.consulting_projects (project_code);

-- Step1-3) 계약 정보/업로드 메타
CREATE TABLE IF NOT EXISTS public.project_contracts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.consulting_projects(id) ON DELETE CASCADE,
  contract_no           text DEFAULT '',
  contract_status       text NOT NULL DEFAULT 'contract_completed',
  contract_file_name    text DEFAULT '',
  contract_file_url     text DEFAULT '',
  contract_file_content text,
  signed_at             bigint,
  created_by            text DEFAULT '',
  created_by_name       text DEFAULT '',
  created_at            bigint NOT NULL DEFAULT public.now_ms(),
  updated_at            bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_contracts_project_id_idx
  ON public.project_contracts (project_id);

-- Step1-4) 상태 변경 이력
CREATE TABLE IF NOT EXISTS public.project_status_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.consulting_projects(id) ON DELETE CASCADE,
  from_status     text DEFAULT '',
  to_status       text NOT NULL,
  reason          text DEFAULT '',
  changed_by      text DEFAULT '',
  changed_by_name text DEFAULT '',
  changed_at      bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_status_logs_project_id_idx
  ON public.project_status_logs (project_id, changed_at DESC);

-- Step1-5) 상태 변경 공통 함수
CREATE OR REPLACE FUNCTION public.fn_log_project_status_change(
  p_project_id uuid,
  p_from text,
  p_to text,
  p_reason text,
  p_actor_id text,
  p_actor_name text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.project_status_logs (
    project_id, from_status, to_status, reason, changed_by, changed_by_name, changed_at
  ) VALUES (
    p_project_id, COALESCE(p_from, ''), p_to, COALESCE(p_reason, ''),
    COALESCE(p_actor_id, ''), COALESCE(p_actor_name, ''), public.now_ms()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_project_status(
  p_project_id uuid,
  p_next_status text,
  p_reason text,
  p_actor_id text,
  p_actor_name text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text;
BEGIN
  SELECT status INTO v_prev
    FROM public.consulting_projects
   WHERE id = p_project_id;

  IF v_prev IS NULL OR v_prev = p_next_status THEN
    RETURN;
  END IF;

  UPDATE public.consulting_projects
     SET status = p_next_status,
         updated_by = COALESCE(p_actor_id, updated_by),
         updated_by_name = COALESCE(p_actor_name, updated_by_name),
         updated_at = public.now_ms()
   WHERE id = p_project_id;

  PERFORM public.fn_log_project_status_change(
    p_project_id, v_prev, p_next_status, p_reason, p_actor_id, p_actor_name
  );
END;
$$;

-- Step1-6) 계약 업로드 시 계약완료 자동 고정
CREATE OR REPLACE FUNCTION public.fn_contract_to_project_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.consulting_projects
     SET contract_uploaded_at = COALESCE(contract_uploaded_at, public.now_ms()),
         updated_at = public.now_ms()
   WHERE id = NEW.project_id;

  IF NEW.contract_status = 'contract_completed' THEN
    PERFORM public.fn_update_project_status(
      NEW.project_id, 'contract_completed', '계약서 업로드/계약완료', NEW.created_by, NEW.created_by_name
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_to_project_status ON public.project_contracts;
CREATE TRIGGER trg_contract_to_project_status
AFTER INSERT OR UPDATE OF contract_status ON public.project_contracts
FOR EACH ROW
EXECUTE FUNCTION public.fn_contract_to_project_status();

-- Step1-7) 타임시트 기록 시 수행중 전환용 함수(실제 타임시트 연계는 Step2)
CREATE OR REPLACE FUNCTION public.fn_mark_project_in_progress_by_code(
  p_project_code text,
  p_actor_id text,
  p_actor_name text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT id INTO v_project_id
    FROM public.consulting_projects
   WHERE project_code = p_project_code
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_project_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.consulting_projects
     SET first_timesheet_at = COALESCE(first_timesheet_at, public.now_ms()),
         updated_at = public.now_ms()
   WHERE id = v_project_id;

  PERFORM public.fn_update_project_status(
    v_project_id, 'in_progress', '프로젝트코드 타임시트 기록', p_actor_id, p_actor_name
  );
END;
$$;

-- Step1-8) updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := public.now_ms();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_consulting_project_master ON public.consulting_project_master;
CREATE TRIGGER trg_touch_consulting_project_master
BEFORE UPDATE ON public.consulting_project_master
FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_consulting_projects ON public.consulting_projects;
CREATE TRIGGER trg_touch_consulting_projects
BEFORE UPDATE ON public.consulting_projects
FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_project_contracts ON public.project_contracts;
CREATE TRIGGER trg_touch_project_contracts
BEFORE UPDATE ON public.project_contracts
FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();
