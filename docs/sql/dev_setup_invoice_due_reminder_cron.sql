-- 예상청구일정 도래/경과 PM 자동 리마인드 (완전 자동 배치)
-- 실행 순서:
-- 1) 기존 프로젝트 관리/인보이스 스키마 적용 이후
-- 2) 본 스크립트 실행
--
-- 동작:
-- - 매일 1회(기본: UTC 00:00 = KST 09:00) 실행
-- - planned_issue_date <= 오늘 이고 payment_status in ('requested','overdue') 인 건을 PM에게 알림
-- - 같은 invoice_id + PM + 날짜 기준 1회만 발송 (중복 방지)

CREATE TABLE IF NOT EXISTS public.invoice_due_reminder_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      text NOT NULL,
  project_code    text NOT NULL DEFAULT '',
  to_user_id      text NOT NULL,
  remind_date     date NOT NULL,
  notify_type     text NOT NULL DEFAULT 'invoice_due_remind',
  created_at      bigint NOT NULL DEFAULT public.now_ms(),
  updated_at      bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT invoice_due_reminder_logs_daily_uniq
    UNIQUE (invoice_id, to_user_id, remind_date, notify_type)
);

CREATE INDEX IF NOT EXISTS invoice_due_reminder_logs_date_idx
  ON public.invoice_due_reminder_logs (remind_date DESC, to_user_id);

COMMENT ON TABLE public.invoice_due_reminder_logs IS '세금계산서 예상청구일정 도래/경과 리마인드 발송 로그(중복 방지용)';

ALTER TABLE public.invoice_due_reminder_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read invoice due reminder logs" ON public.invoice_due_reminder_logs;
CREATE POLICY "public read invoice due reminder logs" ON public.invoice_due_reminder_logs
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public write invoice due reminder logs" ON public.invoice_due_reminder_logs;
CREATE POLICY "public write invoice due reminder logs" ON public.invoice_due_reminder_logs
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_send_invoice_due_reminders(
  p_today date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_now bigint := public.now_ms();
  v_count integer := 0;
BEGIN
  WITH candidates AS (
    SELECT
      i.id::text AS invoice_id,
      COALESCE(i.project_code, '') AS project_code,
      COALESCE(i.billing_month, '') AS billing_month,
      i.planned_issue_date,
      COALESCE(r.cpm_user_id, '') AS pm_user_id,
      COALESCE(r.cpm_user_name, '') AS pm_user_name
    FROM public.project_invoices i
    JOIN public.registered_projects r
      ON r.project_code = i.project_code
    WHERE i.planned_issue_date IS NOT NULL
      AND i.planned_issue_date <= p_today
      AND COALESCE(i.payment_status, '') IN ('requested', 'overdue')
      AND COALESCE(r.cpm_user_id, '') <> ''
      AND COALESCE(r.registration_status, 'approved') = 'approved'
  ),
  logged AS (
    INSERT INTO public.invoice_due_reminder_logs (
      invoice_id, project_code, to_user_id, remind_date, notify_type, created_at, updated_at
    )
    SELECT
      c.invoice_id,
      c.project_code,
      c.pm_user_id,
      p_today,
      'invoice_due_remind',
      v_now,
      v_now
    FROM candidates c
    ON CONFLICT (invoice_id, to_user_id, remind_date, notify_type) DO NOTHING
    RETURNING invoice_id, project_code, to_user_id
  ),
  inserted_notifications AS (
    INSERT INTO public.notifications (
      to_user_id,
      to_user_name,
      from_user_id,
      from_user_name,
      type,
      entry_id,
      entry_summary,
      message,
      is_read,
      target_menu
    )
    SELECT
      c.pm_user_id,
      c.pm_user_name,
      'system',
      'SYSTEM',
      'invoice_due_remind',
      c.invoice_id,
      c.project_code || ' · ' || COALESCE(NULLIF(c.billing_month, ''), '-'),
      c.project_code || ' 예상청구일정(' || to_char(c.planned_issue_date, 'YYYY-MM-DD') || ')이 도래/경과되었습니다. 프로젝트관리 > 세금계산서에서 발행요청 또는 일정수정을 진행해주세요.',
      false,
      'project-management:invoice'
    FROM candidates c
    JOIN logged l
      ON l.invoice_id = c.invoice_id
     AND l.to_user_id = c.pm_user_id
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_count FROM inserted_notifications;

  RETURN jsonb_build_object(
    'ok', true,
    'today', to_char(p_today, 'YYYY-MM-DD'),
    'sent_count', v_count
  );
END;
$$;

COMMENT ON FUNCTION public.fn_send_invoice_due_reminders(date) IS '예상청구일정 도래/경과 PM 리마인드 알림 발송(중복 방지 포함)';

-- 수동 테스트 예시:
-- SELECT public.fn_send_invoice_due_reminders(CURRENT_DATE);

-- pg_cron 스케줄 등록 (Supabase 기준 cron schema)
-- 기본 스케줄: UTC 00:00 (= KST 09:00)
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM pg_extension WHERE extname = 'pg_cron';
    IF NOT FOUND THEN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron extension create skipped: %', SQLERRM;
  END;

  BEGIN
    -- 기존 잡이 있으면 이름 기준으로 해제 (없으면 예외 무시)
    BEGIN
      PERFORM cron.unschedule('invoice_due_reminder_daily');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'invoice_due_reminder_daily',
      '0 0 * * *',
      'SELECT public.fn_send_invoice_due_reminders(CURRENT_DATE);'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'cron schedule skipped: %', SQLERRM;
  END;
END
$$;
