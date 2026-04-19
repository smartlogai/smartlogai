-- 프로젝트관리 통합 MVP: Time Charge / 세금계산서 / 비용관리
-- 적용 대상: public
-- 주의: 본 프로젝트는 anon key 기반 앱 레벨 권한 제어를 사용하므로
--       RLS는 anon/authenticated 허용, 실제 역할 제어는 JS(Auth)에서 수행.

-- 1) 프로젝트 단가표 (프로젝트 우선 단가)
CREATE TABLE IF NOT EXISTS public.project_rate_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL DEFAULT '',
  project_code  text NOT NULL DEFAULT '',
  user_id       text NOT NULL DEFAULT '',
  role_key      text NOT NULL DEFAULT '',
  unit_rate     numeric(18,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'KRW',
  effective_from date,
  effective_to   date,
  is_active     boolean NOT NULL DEFAULT true,
  note          text NOT NULL DEFAULT '',
  created_by    text NOT NULL DEFAULT '',
  created_by_name text NOT NULL DEFAULT '',
  created_at    bigint NOT NULL DEFAULT public.now_ms(),
  updated_at    bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_rate_cards_project_idx
  ON public.project_rate_cards (project_code, is_active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS project_rate_cards_user_idx
  ON public.project_rate_cards (project_code, user_id, is_active);
CREATE INDEX IF NOT EXISTS project_rate_cards_role_idx
  ON public.project_rate_cards (project_code, role_key, is_active);

-- 2) 사용자 기준단가 (프로젝트 단가 미정의 fallback)
CREATE TABLE IF NOT EXISTS public.user_rate_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL DEFAULT '',
  user_name     text NOT NULL DEFAULT '',
  unit_rate     numeric(18,2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'KRW',
  effective_from date,
  effective_to   date,
  is_active     boolean NOT NULL DEFAULT true,
  note          text NOT NULL DEFAULT '',
  created_by    text NOT NULL DEFAULT '',
  created_by_name text NOT NULL DEFAULT '',
  created_at    bigint NOT NULL DEFAULT public.now_ms(),
  updated_at    bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS user_rate_cards_user_idx
  ON public.user_rate_cards (user_id, is_active, effective_from, effective_to);

-- 3) Time Charge 배치(헤더)
CREATE TABLE IF NOT EXISTS public.project_timecharge_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         text NOT NULL DEFAULT '',
  project_code       text NOT NULL DEFAULT '',
  project_name       text NOT NULL DEFAULT '',
  client_id          text NOT NULL DEFAULT '',
  client_name        text NOT NULL DEFAULT '',
  billing_month      text NOT NULL DEFAULT '', -- YYYY-MM
  status             text NOT NULL DEFAULT 'draft',
  requested_at       bigint,
  requested_by       text NOT NULL DEFAULT '',
  requested_by_name  text NOT NULL DEFAULT '',
  issued_at          bigint,
  issued_by          text NOT NULL DEFAULT '',
  issued_by_name     text NOT NULL DEFAULT '',
  issue_due_date     date,
  paid_at            bigint,
  paid_amount        numeric(18,2) NOT NULL DEFAULT 0,
  subtotal_amount    numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount         numeric(18,2) NOT NULL DEFAULT 0,
  total_amount       numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_amount numeric(18,2) NOT NULL DEFAULT 0,
  note               text NOT NULL DEFAULT '',
  created_by         text NOT NULL DEFAULT '',
  created_by_name    text NOT NULL DEFAULT '',
  created_at         bigint NOT NULL DEFAULT public.now_ms(),
  updated_at         bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT project_timecharge_batches_status_chk
    CHECK (status IN ('draft','requested','issued','partially_paid','paid','overdue'))
);

CREATE UNIQUE INDEX IF NOT EXISTS project_timecharge_batches_project_month_uidx
  ON public.project_timecharge_batches (project_code, billing_month);
CREATE INDEX IF NOT EXISTS project_timecharge_batches_status_idx
  ON public.project_timecharge_batches (status, billing_month, created_at DESC);
CREATE INDEX IF NOT EXISTS project_timecharge_batches_client_idx
  ON public.project_timecharge_batches (client_name, billing_month);

-- 4) Time Charge 라인(세부)
CREATE TABLE IF NOT EXISTS public.project_timecharge_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        text NOT NULL DEFAULT '',
  source_key      text NOT NULL DEFAULT '', -- user_id|work_date|category 등 집계키
  entry_id        text NOT NULL DEFAULT '', -- 원본 time_entries 링크
  project_code    text NOT NULL DEFAULT '',
  project_name    text NOT NULL DEFAULT '',
  client_name     text NOT NULL DEFAULT '',
  user_id         text NOT NULL DEFAULT '',
  user_name       text NOT NULL DEFAULT '',
  role_key        text NOT NULL DEFAULT '',
  work_date       date,
  work_category_name text NOT NULL DEFAULT '',
  work_subcategory_name text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  base_minutes    integer NOT NULL DEFAULT 0,
  adjusted_minutes integer NOT NULL DEFAULT 0,
  final_minutes   integer NOT NULL DEFAULT 0,
  rate_source     text NOT NULL DEFAULT 'user_base', -- project_role|user_base|manual
  unit_rate       numeric(18,2) NOT NULL DEFAULT 0,
  base_amount     numeric(18,2) NOT NULL DEFAULT 0,
  adjusted_amount numeric(18,2) NOT NULL DEFAULT 0,
  final_amount    numeric(18,2) NOT NULL DEFAULT 0,
  adjust_reason   text NOT NULL DEFAULT '',
  is_billable     boolean NOT NULL DEFAULT true,
  created_by      text NOT NULL DEFAULT '',
  created_by_name text NOT NULL DEFAULT '',
  created_at      bigint NOT NULL DEFAULT public.now_ms(),
  updated_at      bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT project_timecharge_lines_rate_source_chk
    CHECK (rate_source IN ('project_role','user_base','manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS project_timecharge_lines_batch_source_uidx
  ON public.project_timecharge_lines (batch_id, source_key);
CREATE INDEX IF NOT EXISTS project_timecharge_lines_batch_idx
  ON public.project_timecharge_lines (batch_id, work_date, user_name);
CREATE INDEX IF NOT EXISTS project_timecharge_lines_entry_idx
  ON public.project_timecharge_lines (entry_id);

-- 5) 세금계산서/입금 추적
CREATE TABLE IF NOT EXISTS public.project_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           text NOT NULL DEFAULT '',
  project_id         text NOT NULL DEFAULT '',
  project_code       text NOT NULL DEFAULT '',
  project_name       text NOT NULL DEFAULT '',
  client_id          text NOT NULL DEFAULT '',
  client_name        text NOT NULL DEFAULT '',
  billing_month      text NOT NULL DEFAULT '',
  invoice_no         text NOT NULL DEFAULT '',
  issue_requested_at bigint,
  issue_requested_by text NOT NULL DEFAULT '',
  issue_requested_by_name text NOT NULL DEFAULT '',
  issue_date         date,
  due_date           date,
  payment_status     text NOT NULL DEFAULT 'requested',
  invoice_amount     numeric(18,2) NOT NULL DEFAULT 0,
  paid_amount        numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_amount numeric(18,2) NOT NULL DEFAULT 0,
  paid_at            bigint,
  payment_note       text NOT NULL DEFAULT '',
  created_at         bigint NOT NULL DEFAULT public.now_ms(),
  updated_at         bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT project_invoices_payment_status_chk
    CHECK (payment_status IN ('requested','issued','partially_paid','paid','overdue','cancelled'))
);

CREATE INDEX IF NOT EXISTS project_invoices_batch_idx
  ON public.project_invoices (batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_invoices_status_due_idx
  ON public.project_invoices (payment_status, due_date, created_at DESC);
CREATE INDEX IF NOT EXISTS project_invoices_project_month_idx
  ON public.project_invoices (project_code, billing_month);

-- 6) 프로젝트 비용관리
CREATE TABLE IF NOT EXISTS public.project_cost_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL DEFAULT '',
  project_code    text NOT NULL DEFAULT '',
  project_name    text NOT NULL DEFAULT '',
  client_id       text NOT NULL DEFAULT '',
  client_name     text NOT NULL DEFAULT '',
  cost_date       date,
  cost_type       text NOT NULL DEFAULT '',
  vendor          text NOT NULL DEFAULT '',
  amount          numeric(18,2) NOT NULL DEFAULT 0,
  vat             numeric(18,2) NOT NULL DEFAULT 0,
  total_amount    numeric(18,2) NOT NULL DEFAULT 0,
  note            text NOT NULL DEFAULT '',
  created_by      text NOT NULL DEFAULT '',
  created_by_name text NOT NULL DEFAULT '',
  created_at      bigint NOT NULL DEFAULT public.now_ms(),
  updated_at      bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_cost_items_project_idx
  ON public.project_cost_items (project_code, cost_date, created_at DESC);
CREATE INDEX IF NOT EXISTS project_cost_items_client_idx
  ON public.project_cost_items (client_name, cost_date);

COMMENT ON TABLE public.project_rate_cards IS '프로젝트별(역할/개인) 단가표';
COMMENT ON TABLE public.user_rate_cards IS '사용자 기준단가표(프로젝트 단가 미정의 fallback)';
COMMENT ON TABLE public.project_timecharge_batches IS 'Time Charge 청구 배치 헤더';
COMMENT ON TABLE public.project_timecharge_lines IS 'Time Charge 청구 라인(원본 time_entries 연결 + 조정 이력)';
COMMENT ON TABLE public.project_invoices IS '세금계산서 발행/입금 추적';
COMMENT ON TABLE public.project_cost_items IS '프로젝트 비용 항목';

-- RLS
ALTER TABLE public.project_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_timecharge_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_timecharge_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_cost_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_rate_cards" ON public.project_rate_cards;
CREATE POLICY "public read project_rate_cards" ON public.project_rate_cards
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public insert project_rate_cards" ON public.project_rate_cards;
CREATE POLICY "public insert project_rate_cards" ON public.project_rate_cards
FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public update project_rate_cards" ON public.project_rate_cards;
CREATE POLICY "public update project_rate_cards" ON public.project_rate_cards
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public delete project_rate_cards" ON public.project_rate_cards;
CREATE POLICY "public delete project_rate_cards" ON public.project_rate_cards
FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public read user_rate_cards" ON public.user_rate_cards;
CREATE POLICY "public read user_rate_cards" ON public.user_rate_cards
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public insert user_rate_cards" ON public.user_rate_cards;
CREATE POLICY "public insert user_rate_cards" ON public.user_rate_cards
FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public update user_rate_cards" ON public.user_rate_cards;
CREATE POLICY "public update user_rate_cards" ON public.user_rate_cards
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public delete user_rate_cards" ON public.user_rate_cards;
CREATE POLICY "public delete user_rate_cards" ON public.user_rate_cards
FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public read project_timecharge_batches" ON public.project_timecharge_batches;
CREATE POLICY "public read project_timecharge_batches" ON public.project_timecharge_batches
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public insert project_timecharge_batches" ON public.project_timecharge_batches;
CREATE POLICY "public insert project_timecharge_batches" ON public.project_timecharge_batches
FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public update project_timecharge_batches" ON public.project_timecharge_batches;
CREATE POLICY "public update project_timecharge_batches" ON public.project_timecharge_batches
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public delete project_timecharge_batches" ON public.project_timecharge_batches;
CREATE POLICY "public delete project_timecharge_batches" ON public.project_timecharge_batches
FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public read project_timecharge_lines" ON public.project_timecharge_lines;
CREATE POLICY "public read project_timecharge_lines" ON public.project_timecharge_lines
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public insert project_timecharge_lines" ON public.project_timecharge_lines;
CREATE POLICY "public insert project_timecharge_lines" ON public.project_timecharge_lines
FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public update project_timecharge_lines" ON public.project_timecharge_lines;
CREATE POLICY "public update project_timecharge_lines" ON public.project_timecharge_lines
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public delete project_timecharge_lines" ON public.project_timecharge_lines;
CREATE POLICY "public delete project_timecharge_lines" ON public.project_timecharge_lines
FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public read project_invoices" ON public.project_invoices;
CREATE POLICY "public read project_invoices" ON public.project_invoices
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public insert project_invoices" ON public.project_invoices;
CREATE POLICY "public insert project_invoices" ON public.project_invoices
FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public update project_invoices" ON public.project_invoices;
CREATE POLICY "public update project_invoices" ON public.project_invoices
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public delete project_invoices" ON public.project_invoices;
CREATE POLICY "public delete project_invoices" ON public.project_invoices
FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public read project_cost_items" ON public.project_cost_items;
CREATE POLICY "public read project_cost_items" ON public.project_cost_items
FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public insert project_cost_items" ON public.project_cost_items;
CREATE POLICY "public insert project_cost_items" ON public.project_cost_items
FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public update project_cost_items" ON public.project_cost_items;
CREATE POLICY "public update project_cost_items" ON public.project_cost_items
FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public delete project_cost_items" ON public.project_cost_items;
CREATE POLICY "public delete project_cost_items" ON public.project_cost_items
FOR DELETE TO anon, authenticated USING (true);
