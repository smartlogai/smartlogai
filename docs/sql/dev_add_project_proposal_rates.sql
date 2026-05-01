-- 프로젝트 제안 최종확정 단가 저장 테이블
-- 우선순위: proposal_final > project_rate_cards > project_code_rate_settings

CREATE TABLE IF NOT EXISTS public.project_proposal_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code    text NOT NULL DEFAULT '',
  user_id         text NOT NULL DEFAULT '',
  role_key        text NOT NULL DEFAULT '',
  unit_rate       numeric(18,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'KRW',
  effective_from  date,
  effective_to    date,
  is_final        boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  source_type     text NOT NULL DEFAULT 'proposal_final',
  note            text NOT NULL DEFAULT '',
  created_by      text NOT NULL DEFAULT '',
  created_by_name text NOT NULL DEFAULT '',
  created_at      bigint NOT NULL DEFAULT public.now_ms(),
  updated_by      text NOT NULL DEFAULT '',
  updated_by_name text NOT NULL DEFAULT '',
  updated_at      bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_proposal_rates_project_idx
  ON public.project_proposal_rates (project_code, is_final, is_active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS project_proposal_rates_user_idx
  ON public.project_proposal_rates (project_code, user_id, is_active);
CREATE INDEX IF NOT EXISTS project_proposal_rates_role_idx
  ON public.project_proposal_rates (project_code, role_key, is_active);

ALTER TABLE public.project_proposal_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_proposal_rates" ON public.project_proposal_rates;
CREATE POLICY "public read project_proposal_rates" ON public.project_proposal_rates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public insert project_proposal_rates" ON public.project_proposal_rates;
CREATE POLICY "public insert project_proposal_rates" ON public.project_proposal_rates
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_proposal_rates" ON public.project_proposal_rates;
CREATE POLICY "public update project_proposal_rates" ON public.project_proposal_rates
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "public delete project_proposal_rates" ON public.project_proposal_rates;
CREATE POLICY "public delete project_proposal_rates" ON public.project_proposal_rates
  FOR DELETE USING (true);
