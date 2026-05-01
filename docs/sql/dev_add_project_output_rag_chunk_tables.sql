-- 프로젝트 결과물/참고자료 RAG 인덱싱 결과 저장 테이블
-- 목적:
-- 1) seed/queue 처리 후 chunk 단위 텍스트를 저장
-- 2) 향후 임베딩 벡터(float8[]) 및 검색 점수 확장 기반 제공

CREATE TABLE IF NOT EXISTS public.project_output_rag_chunks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id          text NOT NULL DEFAULT '',
  seed_id            text NOT NULL DEFAULT '',
  chunk_index        integer NOT NULL DEFAULT 0,
  chunk_text         text NOT NULL DEFAULT '',
  token_estimate     integer NOT NULL DEFAULT 0,
  embedding_model    text NOT NULL DEFAULT '',
  embedding_values   double precision[],
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         bigint NOT NULL DEFAULT public.now_ms(),
  updated_at         bigint NOT NULL DEFAULT public.now_ms()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_output_rag_chunks_output_idx_uidx
  ON public.project_output_rag_chunks (output_id, chunk_index);

CREATE INDEX IF NOT EXISTS project_output_rag_chunks_seed_idx
  ON public.project_output_rag_chunks (seed_id, chunk_index);

ALTER TABLE public.project_output_rag_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read project_output_rag_chunks" ON public.project_output_rag_chunks;
CREATE POLICY "public read project_output_rag_chunks"
ON public.project_output_rag_chunks
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert project_output_rag_chunks" ON public.project_output_rag_chunks;
CREATE POLICY "public insert project_output_rag_chunks"
ON public.project_output_rag_chunks
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update project_output_rag_chunks" ON public.project_output_rag_chunks;
CREATE POLICY "public update project_output_rag_chunks"
ON public.project_output_rag_chunks
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public delete project_output_rag_chunks" ON public.project_output_rag_chunks;
CREATE POLICY "public delete project_output_rag_chunks"
ON public.project_output_rag_chunks
FOR DELETE
TO anon, authenticated
USING (true);
