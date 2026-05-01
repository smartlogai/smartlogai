-- Time Charge 청구서 스냅샷 저장 테이블
create table if not exists public.project_timecharge_documents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.project_timecharge_batches(id) on delete cascade,
  project_code text not null,
  project_name text not null default '',
  client_name text not null default '',
  billing_month text not null,
  doc_no text not null,
  version_no integer not null default 1,
  subtotal_amount numeric(14,2) not null default 0,
  cap_amount numeric(14,2) not null default 0,
  claim_amount numeric(14,2) not null default 0,
  created_by uuid,
  created_by_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_project_timecharge_documents_batch
  on public.project_timecharge_documents(batch_id);

create index if not exists idx_project_timecharge_documents_project_month
  on public.project_timecharge_documents(project_code, billing_month);

alter table public.project_timecharge_documents enable row level security;

drop policy if exists "pm_timecharge_documents_select" on public.project_timecharge_documents;
create policy "pm_timecharge_documents_select"
  on public.project_timecharge_documents for select
  using (true);

drop policy if exists "pm_timecharge_documents_insert" on public.project_timecharge_documents;
create policy "pm_timecharge_documents_insert"
  on public.project_timecharge_documents for insert
  with check (true);

drop policy if exists "pm_timecharge_documents_update" on public.project_timecharge_documents;
create policy "pm_timecharge_documents_update"
  on public.project_timecharge_documents for update
  using (true)
  with check (true);
