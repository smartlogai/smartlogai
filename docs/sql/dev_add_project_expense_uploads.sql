-- ERP 프로젝트비용 업로드 원본 테이블
-- 목적: 비용관리 화면에서 월별 ERP 파일을 원본 그대로 적재하고
--      프로젝트코드/고객사 단위 집계 및 인보이스 연계를 수행

CREATE TABLE IF NOT EXISTS public.project_expense_uploads (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  upload_batch_id text NOT NULL DEFAULT '',
  upload_month text NOT NULL DEFAULT '',
  source_file_name text NOT NULL DEFAULT '',
  source_row_no integer NOT NULL DEFAULT 0,

  project_id text NOT NULL DEFAULT '',
  project_code text NOT NULL DEFAULT '',
  project_name text NOT NULL DEFAULT '',
  client_id text NOT NULL DEFAULT '',
  client_name text NOT NULL DEFAULT '',

  expense_date date,
  expense_type text NOT NULL DEFAULT '',
  vendor text NOT NULL DEFAULT '',
  amount numeric(18,2) NOT NULL DEFAULT 0,
  vat_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',

  is_billable boolean NOT NULL DEFAULT false,
  billing_status text NOT NULL DEFAULT 'unbilled',
  linked_invoice_id text NOT NULL DEFAULT '',

  uploaded_by text NOT NULL DEFAULT '',
  uploaded_by_name text NOT NULL DEFAULT '',
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

ALTER TABLE IF EXISTS public.project_expense_uploads
  DROP CONSTRAINT IF EXISTS project_expense_uploads_billing_status_chk;
ALTER TABLE IF EXISTS public.project_expense_uploads
  ADD CONSTRAINT project_expense_uploads_billing_status_chk
  CHECK (billing_status IN ('unbilled', 'requested', 'billed', 'paid', 'excluded'));

CREATE INDEX IF NOT EXISTS project_expense_uploads_batch_idx
  ON public.project_expense_uploads (upload_batch_id, project_code, expense_date);

CREATE INDEX IF NOT EXISTS project_expense_uploads_project_idx
  ON public.project_expense_uploads (project_code, billing_status, expense_date);

CREATE INDEX IF NOT EXISTS project_expense_uploads_client_idx
  ON public.project_expense_uploads (client_name, project_code, expense_date);

COMMENT ON TABLE public.project_expense_uploads IS 'ERP 월별 프로젝트 비용 업로드 원본';
COMMENT ON COLUMN public.project_expense_uploads.upload_batch_id IS '업로드 배치 식별자';
COMMENT ON COLUMN public.project_expense_uploads.upload_month IS '업로드 기준월(YYYY-MM)';
COMMENT ON COLUMN public.project_expense_uploads.source_file_name IS '원본 업로드 파일명';
COMMENT ON COLUMN public.project_expense_uploads.source_row_no IS '원본 파일 내 행 번호';
COMMENT ON COLUMN public.project_expense_uploads.expense_date IS '비용일자';
COMMENT ON COLUMN public.project_expense_uploads.expense_type IS '비용유형(교통비/식대/기타 등)';
COMMENT ON COLUMN public.project_expense_uploads.is_billable IS '고객 청구 대상 선택 여부';
COMMENT ON COLUMN public.project_expense_uploads.billing_status IS '청구 진행 상태(unbilled/requested/billed/paid/excluded)';
COMMENT ON COLUMN public.project_expense_uploads.linked_invoice_id IS '연결된 project_invoices.id';

