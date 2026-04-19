-- 고객사 등록 요청(Staff -> Manager+ 승인) 테이블 추가
-- 목적:
-- 1) staff는 고객사 "등록 요청"만 생성
-- 2) manager/director/top_mgr/admin이 승인 시 clients에 정식 반영

CREATE TABLE IF NOT EXISTS public.client_registration_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        text NOT NULL DEFAULT '',
  normalized_name     text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'pending',
  approver1_id        text NOT NULL DEFAULT '',
  approver1_name      text NOT NULL DEFAULT '',
  requested_by        text NOT NULL DEFAULT '',
  requested_by_name   text NOT NULL DEFAULT '',
  requested_role      text NOT NULL DEFAULT '',
  requested_at        bigint,
  reviewed_by         text NOT NULL DEFAULT '',
  reviewed_by_name    text NOT NULL DEFAULT '',
  reviewed_at         bigint,
  review_note         text NOT NULL DEFAULT '',
  approved_client_id  text NOT NULL DEFAULT '',
  approved_client_name text NOT NULL DEFAULT '',
  created_at          bigint NOT NULL DEFAULT public.now_ms(),
  updated_at          bigint NOT NULL DEFAULT public.now_ms(),
  CONSTRAINT client_registration_requests_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- 기존 테이블에 컬럼이 없는 경우 보강
ALTER TABLE IF EXISTS public.client_registration_requests
  ADD COLUMN IF NOT EXISTS approver1_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approver1_name text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS client_registration_requests_status_idx
  ON public.client_registration_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS client_registration_requests_requested_by_idx
  ON public.client_registration_requests (requested_by, created_at DESC);

CREATE INDEX IF NOT EXISTS client_registration_requests_approver1_idx
  ON public.client_registration_requests (approver1_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS client_registration_requests_normalized_name_idx
  ON public.client_registration_requests (normalized_name);

COMMENT ON TABLE public.client_registration_requests IS '고객사 등록 요청(Staff 요청 -> 승인자 승인/반려)';
COMMENT ON COLUMN public.client_registration_requests.company_name IS '요청 고객사명';
COMMENT ON COLUMN public.client_registration_requests.normalized_name IS '중복 체크용 정규화 이름';
COMMENT ON COLUMN public.client_registration_requests.status IS '요청 상태: pending/approved/rejected';
COMMENT ON COLUMN public.client_registration_requests.approver1_id IS '고객사 등록요청 1차 승인자 ID';
COMMENT ON COLUMN public.client_registration_requests.approver1_name IS '고객사 등록요청 1차 승인자명';

-- RLS 활성화 및 정책
-- 본 프로젝트는 anon key 기반 앱 레벨 권한 제어를 사용하므로,
-- DB RLS는 이 테이블에 대해 anon/authenticated 접근을 허용하고
-- 실제 role별 제어는 JS(Auth)에서 수행한다.
ALTER TABLE public.client_registration_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read client registration requests" ON public.client_registration_requests;
CREATE POLICY "public read client registration requests"
ON public.client_registration_requests
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public insert client registration requests" ON public.client_registration_requests;
CREATE POLICY "public insert client registration requests"
ON public.client_registration_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "public update client registration requests" ON public.client_registration_requests;
CREATE POLICY "public update client registration requests"
ON public.client_registration_requests
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "public delete client registration requests" ON public.client_registration_requests;
CREATE POLICY "public delete client registration requests"
ON public.client_registration_requests
FOR DELETE
TO anon, authenticated
USING (true);
