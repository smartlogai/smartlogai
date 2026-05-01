-- 프로젝트 결과물/참고자료 RAG 적재용 Seed + Queue 테이블
-- 목적:
-- 1) 자료 등록 시 즉시 RAG 대상 메타를 DB화
-- 2) 별도 워커/엣지함수에서 비동기 청킹/임베딩 수행 가능하도록 Queue 제공

CREATE TABLE IF NOT EXISTS public.project_output_rag_seeds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id         text NOT NULL DEFAULT '',
  source_kind       text NOT NULL DEFAULT '', -- result_report | reference | other
  output_type       text NOT NULL DEFAULT '',
  title             text NOT NULL DEFAULT '',
  summary           text NOT NULL DEFAULT '',
  project_code      text NOT NULL DEFAULT '',
  project_name      text NOT NULL DEFAULT '',
  main_category     text NOT NULL DEFAULT '',
  sub_category      text NOT NULL DEFAULT '',
  file_name         text NOT NULL DEFAULT '',
  file_url          text NOT NULL DEFAULT '',
  file_path         text NOT NULL DEFAULT '',
  uploaded_by       text NOT NULL DEFAULT '',
  uploaded_by_name  text NOT NULL DEFAULT '',
  uploaded_at       bigint,
  rag_status        text NOT NULL DEFAULT 'queued', -- queued | indexed | failed
  created_at        bigint NOT NULL DEFAULT public.now_ms(),
  updated_at        bigint NOT NULL DEFAULT public.now_ms()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_output_rag_seeds_output_uidx
  ON public.project_output_rag_seeds (output_id);

CREATE INDEX IF NOT EXISTS project_output_rag_seeds_status_idx
  ON public.project_output_rag_seeds (rag_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.project_output_rag_index_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id            text NOT NULL DEFAULT '',
  output_id          text NOT NULL DEFAULT '',
  job_type           text NOT NULL DEFAULT 'index',
  status             text NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  requested_by       text NOT NULL DEFAULT '',
  requested_by_name  text NOT NULL DEFAULT '',
  error_message      text NOT NULL DEFAULT '',
  created_at         bigint NOT NULL DEFAULT public.now_ms(),
  updated_at         bigint NOT NULL DEFAULT public.now_ms()
);

CREATE INDEX IF NOT EXISTS project_output_rag_index_queue_status_idx
  ON public.project_output_rag_index_queue (status, created_at);

CREATE INDEX IF NOT EXISTS project_output_rag_index_queue_output_idx
  ON public.project_output_rag_index_queue (output_id, created_at DESC);

ALTER TABLE public.project_output_rag_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_output_rag_index_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_output_rag_seeds" ON public.project_output_rag_seeds;
CREATE POLICY "public read project_output_rag_seeds"
ON public.project_output_rag_seeds
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_output_rag_seeds" ON public.project_output_rag_seeds;
CREATE POLICY "public insert project_output_rag_seeds"
ON public.project_output_rag_seeds
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_output_rag_seeds" ON public.project_output_rag_seeds;
CREATE POLICY "public update project_output_rag_seeds"
ON public.project_output_rag_seeds
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public read project_output_rag_index_queue" ON public.project_output_rag_index_queue;
CREATE POLICY "public read project_output_rag_index_queue"
ON public.project_output_rag_index_queue
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_output_rag_index_queue" ON public.project_output_rag_index_queue;
CREATE POLICY "public insert project_output_rag_index_queue"
ON public.project_output_rag_index_queue
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_output_rag_index_queue" ON public.project_output_rag_index_queue;
CREATE POLICY "public update project_output_rag_index_queue"
ON public.project_output_rag_index_queue
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);
