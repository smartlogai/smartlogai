-- NTS 자동발행 운영기반
-- 목적:
-- 1) 자동발행 설정 저장
-- 2) 전송 이력/오류 로그 저장
-- 3) 국세청 실전송 RPC 인터페이스 고정(현재는 mock)

ALTER TABLE IF EXISTS public.project_invoices
  ADD COLUMN IF NOT EXISTS nts_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nts_last_error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nts_tx_id text NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS public.project_invoices
  DROP CONSTRAINT IF EXISTS project_invoices_buyer_bizno_format_chk;
ALTER TABLE IF EXISTS public.project_invoices
  ADD CONSTRAINT project_invoices_buyer_bizno_format_chk
  CHECK (
    buyer_business_no = '' OR
    buyer_business_no ~ '^[0-9]{3}-[0-9]{2}-[0-9]{5}$'
  );

ALTER TABLE IF EXISTS public.project_invoices
  DROP CONSTRAINT IF EXISTS project_invoices_recipient_email_format_chk;
ALTER TABLE IF EXISTS public.project_invoices
  ADD CONSTRAINT project_invoices_recipient_email_format_chk
  CHECK (
    recipient_email = '' OR
    recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

CREATE TABLE IF NOT EXISTS public.nts_integration_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name         text NOT NULL DEFAULT 'nts',
  issue_mode            text NOT NULL DEFAULT 'queue',
  auto_issue_enabled    boolean NOT NULL DEFAULT true,
  auto_issue_cron       text NOT NULL DEFAULT '*/10 * * * *',
  request_timeout_ms    integer NOT NULL DEFAULT 15000,
  max_retry_count       integer NOT NULL DEFAULT 3,
  endpoint_hint         text NOT NULL DEFAULT '',
  note                  text NOT NULL DEFAULT '',
  updated_by            text NOT NULL DEFAULT '',
  updated_by_name       text NOT NULL DEFAULT '',
  created_at            bigint NOT NULL DEFAULT public.now_ms(),
  updated_at            bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT nts_integration_settings_mode_chk
    CHECK (issue_mode IN ('queue','nts-live'))
);

CREATE UNIQUE INDEX IF NOT EXISTS nts_integration_settings_provider_uidx
  ON public.nts_integration_settings (provider_name);

INSERT INTO public.nts_integration_settings (
  provider_name,
  issue_mode,
  auto_issue_enabled,
  auto_issue_cron,
  request_timeout_ms,
  max_retry_count,
  endpoint_hint,
  note
)
VALUES (
  'nts',
  'queue',
  true,
  '*/10 * * * *',
  15000,
  3,
  '향후 Edge Function / 외부 연계 엔드포인트 입력',
  '초기값: queue 모드'
)
ON CONFLICT (provider_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nts_issue_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        text NOT NULL DEFAULT '',
  project_code      text NOT NULL DEFAULT '',
  issue_mode        text NOT NULL DEFAULT 'queue',
  issue_status      text NOT NULL DEFAULT 'requested',
  attempt_no        integer NOT NULL DEFAULT 1,
  request_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code        text NOT NULL DEFAULT '',
  error_message     text NOT NULL DEFAULT '',
  requested_by      text NOT NULL DEFAULT '',
  requested_by_name text NOT NULL DEFAULT '',
  requested_at      bigint,
  processed_at      bigint,
  created_at        bigint NOT NULL DEFAULT public.now_ms(),
  updated_at        bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT nts_issue_logs_mode_chk
    CHECK (issue_mode IN ('queue','nts-live')),
  CONSTRAINT nts_issue_logs_status_chk
    CHECK (issue_status IN ('requested','issued','failed','skipped'))
);

CREATE INDEX IF NOT EXISTS nts_issue_logs_invoice_idx
  ON public.nts_issue_logs (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nts_issue_logs_status_idx
  ON public.nts_issue_logs (issue_status, created_at DESC);

CREATE OR REPLACE VIEW public.v_project_invoice_quality AS
SELECT
  i.id,
  i.project_code,
  i.project_name,
  i.billing_month,
  i.payment_status,
  i.nts_issue_status,
  i.invoice_no,
  i.issue_date,
  i.planned_issue_date,
  i.expected_payment_date,
  i.invoice_amount,
  i.paid_amount,
  i.outstanding_amount,
  i.recipient_email,
  i.buyer_business_no,
  (
    CASE WHEN coalesce(i.buyer_company_name, '') = '' THEN 1 ELSE 0 END +
    CASE WHEN coalesce(i.buyer_business_no, '') = '' THEN 1 ELSE 0 END +
    CASE WHEN coalesce(i.recipient_email, '') = '' THEN 1 ELSE 0 END +
    CASE WHEN coalesce(i.item_name, '') = '' THEN 1 ELSE 0 END +
    CASE WHEN i.planned_issue_date IS NULL THEN 1 ELSE 0 END +
    CASE WHEN i.expected_payment_date IS NULL THEN 1 ELSE 0 END +
    CASE WHEN coalesce(i.invoice_amount, 0) <= 0 THEN 1 ELSE 0 END +
    CASE WHEN i.payment_status IN ('issued','partially_paid','paid') AND coalesce(i.invoice_no, '') = '' THEN 1 ELSE 0 END +
    CASE WHEN i.payment_status IN ('issued','partially_paid','paid') AND i.issue_date IS NULL THEN 1 ELSE 0 END +
    CASE WHEN i.payment_status = 'paid' AND coalesce(i.outstanding_amount, 0) > 0 THEN 1 ELSE 0 END
  ) AS issue_count
FROM public.project_invoices i;

COMMENT ON VIEW public.v_project_invoice_quality IS '세금계산서 발행 데이터 정합성 점검 뷰';

COMMENT ON TABLE public.nts_integration_settings IS '국세청 연동/자동발행 설정';
COMMENT ON TABLE public.nts_issue_logs IS '국세청 전송 요청/응답/오류 로그';

ALTER TABLE public.nts_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nts_issue_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read nts settings" ON public.nts_integration_settings;
CREATE POLICY "public read nts settings" ON public.nts_integration_settings
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public write nts settings" ON public.nts_integration_settings;
CREATE POLICY "public write nts settings" ON public.nts_integration_settings
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public read nts logs" ON public.nts_issue_logs;
CREATE POLICY "public read nts logs" ON public.nts_issue_logs
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public write nts logs" ON public.nts_issue_logs;
CREATE POLICY "public write nts logs" ON public.nts_issue_logs
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 국세청 실전송 연동 함수 인터페이스 고정 (현재 mock)
-- 실제 연동 시 본 함수의 내부 구현만 교체하면 프론트 수정 없이 전환 가능.
CREATE OR REPLACE FUNCTION public.fn_nts_issue_invoice(
  p_invoice_id text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
AS $$
WITH cfg AS (
  SELECT COALESCE(
    (
      SELECT issue_mode
      FROM public.nts_integration_settings
      WHERE provider_name = 'nts'
      ORDER BY updated_at DESC
      LIMIT 1
    ),
    'queue'
  ) AS issue_mode
)
SELECT
  CASE
    WHEN cfg.issue_mode = 'queue' THEN jsonb_build_object(
      'ok', true,
      'success', true,
      'tx_id', '',
      'mode', 'queue',
      'message', 'queue mode: 전송요청 등록'
    )
    ELSE jsonb_build_object(
      'ok', false,
      'success', false,
      'mode', 'nts-live',
      'error', '실전송 연동 미구현',
      'message', 'fn_nts_issue_invoice 내부에 실제 국세청 연동 로직을 구현하세요.'
    )
  END
FROM cfg;
$$;
