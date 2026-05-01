-- Project Output 접근신청/접근로그/AI학습 큐
-- 확정 정책:
-- 1) 접근 승인 유효기간: 1일 (앱에서 expires_at = now + 1day 적용)
-- 2) 대량 접근 알림 기준: 1일 5건 이상 (view + download)
-- 3) publish_status='published' 시 AI 학습 큐 적재

CREATE TABLE IF NOT EXISTS public.project_output_access_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id           uuid NOT NULL,
  project_code        text NOT NULL DEFAULT '',
  output_title        text NOT NULL DEFAULT '',
  request_type        text NOT NULL DEFAULT 'view', -- view|download
  requester_user_id   text NOT NULL DEFAULT '',
  requester_user_name text NOT NULL DEFAULT '',
  requester_hq_id     text NOT NULL DEFAULT '',
  requester_dept_id   text NOT NULL DEFAULT '',
  approver_user_id    text NOT NULL DEFAULT '',
  approver_user_name  text NOT NULL DEFAULT '',
  scope_main_category text NOT NULL DEFAULT '',
  scope_sub_category  text NOT NULL DEFAULT '',
  request_reason      text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired
  decision_note       text NOT NULL DEFAULT '',
  requested_at        bigint NOT NULL DEFAULT public.now_ms(),
  approved_at         bigint,
  approved_by         text NOT NULL DEFAULT '',
  approved_by_name    text NOT NULL DEFAULT '',
  expires_at          bigint,
  created_at          bigint NOT NULL DEFAULT public.now_ms(),
  updated_at          bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_output_access_requests_req_idx
  ON public.project_output_access_requests (requester_user_id, status, request_type, expires_at DESC);

CREATE INDEX IF NOT EXISTS project_output_access_requests_appr_idx
  ON public.project_output_access_requests (approver_user_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.project_output_access_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id        uuid NOT NULL,
  project_code     text NOT NULL DEFAULT '',
  event_type       text NOT NULL DEFAULT 'view', -- view|download
  actor_user_id    text NOT NULL DEFAULT '',
  actor_user_name  text NOT NULL DEFAULT '',
  request_id       uuid,
  ip_address       text NOT NULL DEFAULT '',
  user_agent       text NOT NULL DEFAULT '',
  occurred_at      bigint NOT NULL DEFAULT public.now_ms(),
  created_at       bigint NOT NULL DEFAULT public.now_ms(),
  updated_at       bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_output_access_logs_actor_day_idx
  ON public.project_output_access_logs (actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS project_output_access_logs_output_idx
  ON public.project_output_access_logs (output_id, event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.project_output_ai_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id         uuid NOT NULL,
  project_code      text NOT NULL DEFAULT '',
  output_title      text NOT NULL DEFAULT '',
  publish_status    text NOT NULL DEFAULT 'published',
  queue_status      text NOT NULL DEFAULT 'queued', -- queued|processing|done|failed
  queued_at         bigint NOT NULL DEFAULT public.now_ms(),
  processed_at      bigint,
  requested_by      text NOT NULL DEFAULT '',
  requested_by_name text NOT NULL DEFAULT '',
  error_message     text NOT NULL DEFAULT '',
  created_at        bigint NOT NULL DEFAULT public.now_ms(),
  updated_at        bigint NOT NULL DEFAULT public.now_ms(),
  UNIQUE (output_id)
);

CREATE INDEX IF NOT EXISTS project_output_ai_queue_status_idx
  ON public.project_output_ai_queue (queue_status, queued_at DESC);

ALTER TABLE public.project_output_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_output_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_output_ai_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_output_access_requests" ON public.project_output_access_requests;
CREATE POLICY "public read project_output_access_requests"
ON public.project_output_access_requests
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_output_access_requests" ON public.project_output_access_requests;
CREATE POLICY "public insert project_output_access_requests"
ON public.project_output_access_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_output_access_requests" ON public.project_output_access_requests;
CREATE POLICY "public update project_output_access_requests"
ON public.project_output_access_requests
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public delete project_output_access_requests" ON public.project_output_access_requests;
CREATE POLICY "public delete project_output_access_requests"
ON public.project_output_access_requests
FOR DELETE
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public read project_output_access_logs" ON public.project_output_access_logs;
CREATE POLICY "public read project_output_access_logs"
ON public.project_output_access_logs
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_output_access_logs" ON public.project_output_access_logs;
CREATE POLICY "public insert project_output_access_logs"
ON public.project_output_access_logs
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_output_access_logs" ON public.project_output_access_logs;
CREATE POLICY "public update project_output_access_logs"
ON public.project_output_access_logs
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public delete project_output_access_logs" ON public.project_output_access_logs;
CREATE POLICY "public delete project_output_access_logs"
ON public.project_output_access_logs
FOR DELETE
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public read project_output_ai_queue" ON public.project_output_ai_queue;
CREATE POLICY "public read project_output_ai_queue"
ON public.project_output_ai_queue
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_output_ai_queue" ON public.project_output_ai_queue;
CREATE POLICY "public insert project_output_ai_queue"
ON public.project_output_ai_queue
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_output_ai_queue" ON public.project_output_ai_queue;
CREATE POLICY "public update project_output_ai_queue"
ON public.project_output_ai_queue
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public delete project_output_ai_queue" ON public.project_output_ai_queue;
CREATE POLICY "public delete project_output_ai_queue"
ON public.project_output_ai_queue
FOR DELETE
TO anon, authenticated
USING (true);
