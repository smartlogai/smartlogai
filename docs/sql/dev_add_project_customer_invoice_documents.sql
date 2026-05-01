-- 고객청구서(고객 안내용) 문서 스냅샷 저장 테이블
-- 적용 환경: Supabase Postgres

create table if not exists public.project_customer_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  project_code text not null default '',
  project_name text not null default '',
  client_name text not null default '',
  billing_month text not null default '',
  document_no text not null default '',
  document_date date,
  status text not null default 'saved',
  note text not null default '',
  total_amount numeric(18,2) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_by text not null default '',
  created_by_name text not null default '',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_pcid_project_code on public.project_customer_invoice_documents (project_code);
create index if not exists idx_pcid_billing_month on public.project_customer_invoice_documents (billing_month);
create index if not exists idx_pcid_document_no on public.project_customer_invoice_documents (document_no);

comment on table public.project_customer_invoice_documents is '고객에게 송부하는 고객청구서 문서 스냅샷';
comment on column public.project_customer_invoice_documents.payload is '청구 목록 rows 및 렌더 html 스냅샷';
