-- 프로젝트 코드유형별 직급 단가 설정
-- 사용처: 제안/계약등록 기본 단가 및 실시간 손익 fallback

CREATE TABLE IF NOT EXISTS public.project_code_rate_settings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code_type_id text NOT NULL DEFAULT '',
  role_key             text NOT NULL DEFAULT '',
  unit_rate            numeric(18,2) NOT NULL DEFAULT 0,
  currency             text NOT NULL DEFAULT 'KRW',
  is_active            boolean NOT NULL DEFAULT true,
  note                 text NOT NULL DEFAULT '',
  created_by           text NOT NULL DEFAULT '',
  created_by_name      text NOT NULL DEFAULT '',
  created_at           bigint NOT NULL DEFAULT public.now_ms(),
  updated_by           text NOT NULL DEFAULT '',
  updated_by_name      text NOT NULL DEFAULT '',
  updated_at           bigint NOT NULL DEFAULT public.now_ms()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_code_rate_settings_uidx
  ON public.project_code_rate_settings (project_code_type_id, role_key);
CREATE INDEX IF NOT EXISTS project_code_rate_settings_active_idx
  ON public.project_code_rate_settings (project_code_type_id, is_active, updated_at DESC);

ALTER TABLE public.project_code_rate_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_code_rate_settings" ON public.project_code_rate_settings;
CREATE POLICY "public read project_code_rate_settings" ON public.project_code_rate_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "public insert project_code_rate_settings" ON public.project_code_rate_settings;
CREATE POLICY "public insert project_code_rate_settings" ON public.project_code_rate_settings
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_code_rate_settings" ON public.project_code_rate_settings;
CREATE POLICY "public update project_code_rate_settings" ON public.project_code_rate_settings
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "public delete project_code_rate_settings" ON public.project_code_rate_settings;
CREATE POLICY "public delete project_code_rate_settings" ON public.project_code_rate_settings
  FOR DELETE USING (true);
