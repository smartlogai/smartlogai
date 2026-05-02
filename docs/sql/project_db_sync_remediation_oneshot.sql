-- Project DB Sync Remediation (One-shot)
-- 목적:
-- - 프로젝트등록 / 프로젝트관리 / 프로젝트아웃풋 관련 운영 DB 누락 스키마 일괄 보정
-- - 재실행 가능(idempotent)하도록 IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS 사용
--
-- 실행 권장:
-- 1) Supabase SQL Editor에서 postgres 권한으로 실행
-- 2) 실행 후 project_db_sync_audit_checklist.sql 재실행

begin;

-- =========================================================
-- 0) 공통 준비
-- =========================================================
create extension if not exists pgcrypto;

create or replace function public.now_ms()
returns bigint
language sql
stable
as $$
  select (extract(epoch from now()) * 1000)::bigint
$$;

-- =========================================================
-- 1) standard_rate_master (타임차지 표준단가)
-- =========================================================
create table if not exists public.standard_rate_master (
  id uuid primary key default gen_random_uuid(),
  rate_key text not null unique,
  role_key text not null default '',
  user_name text not null default '',
  unit_rate numeric(18,2) not null default 0,
  currency text not null default 'KRW',
  is_active boolean not null default true,
  note text not null default '',
  created_by text not null default '',
  created_by_name text not null default '',
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create index if not exists standard_rate_master_active_idx
  on public.standard_rate_master (is_active, updated_at desc);
create index if not exists standard_rate_master_role_idx
  on public.standard_rate_master (role_key, is_active);
create index if not exists standard_rate_master_user_name_idx
  on public.standard_rate_master (user_name, is_active);

alter table public.standard_rate_master enable row level security;

drop policy if exists "public read standard_rate_master" on public.standard_rate_master;
create policy "public read standard_rate_master"
on public.standard_rate_master
for select
to anon, authenticated
using (true);

drop policy if exists "public insert standard_rate_master" on public.standard_rate_master;
create policy "public insert standard_rate_master"
on public.standard_rate_master
for insert
to anon, authenticated
with check (true);

drop policy if exists "public update standard_rate_master" on public.standard_rate_master;
create policy "public update standard_rate_master"
on public.standard_rate_master
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public delete standard_rate_master" on public.standard_rate_master;
create policy "public delete standard_rate_master"
on public.standard_rate_master
for delete
to anon, authenticated
using (true);

insert into public.standard_rate_master (rate_key, role_key, user_name, unit_rate, is_active, note, updated_at)
values
  ('title_associate', 'associate', '', 300000, true, '직책 표준단가', public.now_ms()),
  ('title_senior', 'senior', '', 200000, true, '직책 표준단가', public.now_ms()),
  ('title_principal', 'principal', '', 500000, true, '직책 표준단가', public.now_ms()),
  ('title_team_lead', 'team_lead', '', 700000, true, '직책 표준단가', public.now_ms()),
  ('title_division_head', 'division_head', '', 800000, true, '직책 표준단가', public.now_ms()),
  ('title_bu_head', 'bu_head', '', 900000, true, '직책 표준단가', public.now_ms()),
  ('title_ceo', 'ceo', '한휘선', 1000000, true, '대표 표준단가', public.now_ms())
on conflict (rate_key) do update
set role_key = excluded.role_key,
    user_name = excluded.user_name,
    unit_rate = excluded.unit_rate,
    is_active = excluded.is_active,
    note = excluded.note,
    updated_at = public.now_ms();

-- =========================================================
-- 2) registered_projects 핵심 컬럼 보강
-- =========================================================
alter table if exists public.registered_projects
  add column if not exists cpm_user_id text not null default '',
  add column if not exists cpm_user_name text not null default '',
  add column if not exists contract_completed_at bigint,
  add column if not exists execution_started_at bigint,
  add column if not exists work_closed_at bigint,
  add column if not exists settled_at bigint,
  add column if not exists lifecycle_status_override text default '',
  add column if not exists lifecycle_override_reason text default '',
  add column if not exists lifecycle_updated_at bigint,
  add column if not exists lifecycle_updated_by text default '',
  add column if not exists lifecycle_updated_by_name text default '',
  add column if not exists order_contributors_text text default '';

comment on column public.registered_projects.cpm_user_id is '총괄 프로젝트 매니저 사용자 ID';
comment on column public.registered_projects.cpm_user_name is '총괄 프로젝트 매니저 사용자명';
comment on column public.registered_projects.execution_started_at is '진행현황 이력: 수행중 시작 시각(ms)';
comment on column public.registered_projects.work_closed_at is '진행현황 이력: 업무종료 시각(ms)';
comment on column public.registered_projects.settled_at is '진행현황 이력: 정산완료 시각(ms)';
comment on column public.registered_projects.lifecycle_status_override is '권한자 수동보정 상태(contract_completed|in_progress|work_closed|settled_done)';

create index if not exists registered_projects_cpm_user_id_idx
  on public.registered_projects (cpm_user_id);
create index if not exists registered_projects_cpm_user_name_idx
  on public.registered_projects (cpm_user_name);
create index if not exists registered_projects_lifecycle_status_override_idx
  on public.registered_projects (lifecycle_status_override, registration_status, updated_at desc);
create index if not exists registered_projects_lifecycle_dates_idx
  on public.registered_projects (contract_completed_at, execution_started_at, work_closed_at, settled_at);

-- =========================================================
-- 3) project_code_types 보강
-- =========================================================
alter table if exists public.project_code_types
  add column if not exists requires_clearance_note boolean not null default false;

comment on column public.project_code_types.requires_clearance_note
is 'true면 결과보고서 업로드 시 통관팀유의사항 + 조치완료(1명 이상) 게이트 적용';

-- =========================================================
-- 4) project_outputs (결과물)
-- =========================================================
create table if not exists public.project_outputs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null default '',
  project_code       text not null default '',
  project_name       text not null default '',
  output_type        text not null default '',
  output_title       text not null default '',
  output_file_name   text not null default '',
  output_file_url    text not null default '',
  uploaded_by        text not null default '',
  uploaded_by_name   text not null default '',
  uploaded_at        bigint,
  note               text not null default '',
  publish_status     text not null default 'pending',
  publish_requested_at bigint,
  publish_requested_by text not null default '',
  publish_requested_by_name text not null default '',
  publish_approved_at bigint,
  publish_approved_by text not null default '',
  publish_approved_by_name text not null default '',
  publish_decision_note text not null default '',
  publish_note       text not null default '',
  published_at       bigint,
  published_by       text not null default '',
  published_by_name  text not null default '',
  created_at         bigint not null default public.now_ms(),
  updated_at         bigint not null default public.now_ms()
);

alter table if exists public.project_outputs
  add column if not exists project_id text not null default '',
  add column if not exists project_code text not null default '',
  add column if not exists project_name text not null default '',
  add column if not exists output_type text not null default '',
  add column if not exists output_title text not null default '',
  add column if not exists output_file_name text not null default '',
  add column if not exists output_file_url text not null default '',
  add column if not exists uploaded_by text not null default '',
  add column if not exists uploaded_by_name text not null default '',
  add column if not exists uploaded_at bigint,
  add column if not exists note text not null default '',
  add column if not exists publish_status text not null default 'pending',
  add column if not exists publish_requested_at bigint,
  add column if not exists publish_requested_by text not null default '',
  add column if not exists publish_requested_by_name text not null default '',
  add column if not exists publish_approved_at bigint,
  add column if not exists publish_approved_by text not null default '',
  add column if not exists publish_approved_by_name text not null default '',
  add column if not exists publish_decision_note text not null default '',
  add column if not exists publish_note text not null default '',
  add column if not exists published_at bigint,
  add column if not exists published_by text not null default '',
  add column if not exists published_by_name text not null default '',
  add column if not exists created_at bigint not null default public.now_ms(),
  add column if not exists updated_at bigint not null default public.now_ms();

create index if not exists project_outputs_project_code_idx
  on public.project_outputs (project_code, uploaded_at desc, created_at desc);
create index if not exists project_outputs_publish_status_idx
  on public.project_outputs (publish_status, output_type, uploaded_at desc);

comment on table public.project_outputs is '프로젝트 결과물 업로드 이력';

alter table public.project_outputs enable row level security;

drop policy if exists "public read project_outputs" on public.project_outputs;
create policy "public read project_outputs"
on public.project_outputs
for select
to anon, authenticated
using (true);

drop policy if exists "public insert project_outputs" on public.project_outputs;
create policy "public insert project_outputs"
on public.project_outputs
for insert
to anon, authenticated
with check (true);

drop policy if exists "public update project_outputs" on public.project_outputs;
create policy "public update project_outputs"
on public.project_outputs
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public delete project_outputs" on public.project_outputs;
create policy "public delete project_outputs"
on public.project_outputs
for delete
to anon, authenticated
using (true);

-- =========================================================
-- 5) project_output_actions (통관 조치)
-- =========================================================
create table if not exists public.project_output_actions (
  id               uuid primary key default gen_random_uuid(),
  output_id        uuid not null,
  project_code     text not null default '',
  action_user_id   text not null default '',
  action_user_name text not null default '',
  action_role      text not null default '',
  action_status    text not null default 'confirmed',
  action_note      text not null default '',
  action_at        bigint,
  created_at       bigint not null default public.now_ms(),
  updated_at       bigint not null default public.now_ms()
);

alter table if exists public.project_output_actions
  add column if not exists output_id uuid not null,
  add column if not exists project_code text not null default '',
  add column if not exists action_user_id text not null default '',
  add column if not exists action_user_name text not null default '',
  add column if not exists action_role text not null default '',
  add column if not exists action_status text not null default 'confirmed',
  add column if not exists action_note text not null default '',
  add column if not exists action_at bigint,
  add column if not exists created_at bigint not null default public.now_ms(),
  add column if not exists updated_at bigint not null default public.now_ms();

create index if not exists project_output_actions_output_idx
  on public.project_output_actions (output_id, updated_at desc);
create index if not exists project_output_actions_project_code_idx
  on public.project_output_actions (project_code, updated_at desc);
create unique index if not exists project_output_actions_output_user_uidx
  on public.project_output_actions (output_id, action_user_id);

alter table public.project_output_actions enable row level security;

drop policy if exists "public read project_output_actions" on public.project_output_actions;
create policy "public read project_output_actions"
on public.project_output_actions
for select
to anon, authenticated
using (true);

drop policy if exists "public insert project_output_actions" on public.project_output_actions;
create policy "public insert project_output_actions"
on public.project_output_actions
for insert
to anon, authenticated
with check (true);

drop policy if exists "public update project_output_actions" on public.project_output_actions;
create policy "public update project_output_actions"
on public.project_output_actions
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public delete project_output_actions" on public.project_output_actions;
create policy "public delete project_output_actions"
on public.project_output_actions
for delete
to anon, authenticated
using (true);

-- =========================================================
-- 6) 접근신청/접근로그/AI큐
-- =========================================================
create table if not exists public.project_output_access_requests (
  id                  uuid primary key default gen_random_uuid(),
  output_id           uuid not null,
  project_code        text not null default '',
  output_title        text not null default '',
  request_type        text not null default 'view',
  requester_user_id   text not null default '',
  requester_user_name text not null default '',
  requester_hq_id     text not null default '',
  requester_dept_id   text not null default '',
  approver_user_id    text not null default '',
  approver_user_name  text not null default '',
  scope_main_category text not null default '',
  scope_sub_category  text not null default '',
  request_reason      text not null default '',
  status              text not null default 'pending',
  decision_note       text not null default '',
  requested_at        bigint not null default public.now_ms(),
  approved_at         bigint,
  approved_by         text not null default '',
  approved_by_name    text not null default '',
  expires_at          bigint,
  created_at          bigint not null default public.now_ms(),
  updated_at          bigint not null default public.now_ms()
);

create table if not exists public.project_output_access_logs (
  id               uuid primary key default gen_random_uuid(),
  output_id        uuid not null,
  project_code     text not null default '',
  event_type       text not null default 'view',
  actor_user_id    text not null default '',
  actor_user_name  text not null default '',
  request_id       uuid,
  ip_address       text not null default '',
  user_agent       text not null default '',
  occurred_at      bigint not null default public.now_ms(),
  created_at       bigint not null default public.now_ms(),
  updated_at       bigint not null default public.now_ms()
);

create table if not exists public.project_output_ai_queue (
  id                uuid primary key default gen_random_uuid(),
  output_id         uuid not null,
  project_code      text not null default '',
  output_title      text not null default '',
  publish_status    text not null default 'published',
  queue_status      text not null default 'queued',
  queued_at         bigint not null default public.now_ms(),
  processed_at      bigint,
  requested_by      text not null default '',
  requested_by_name text not null default '',
  error_message     text not null default '',
  created_at        bigint not null default public.now_ms(),
  updated_at        bigint not null default public.now_ms(),
  unique (output_id)
);

create index if not exists project_output_access_requests_req_idx
  on public.project_output_access_requests (requester_user_id, status, request_type, expires_at desc);
create index if not exists project_output_access_requests_appr_idx
  on public.project_output_access_requests (approver_user_id, status, requested_at desc);
create index if not exists project_output_access_logs_actor_day_idx
  on public.project_output_access_logs (actor_user_id, occurred_at desc);
create index if not exists project_output_access_logs_output_idx
  on public.project_output_access_logs (output_id, event_type, occurred_at desc);
create index if not exists project_output_ai_queue_status_idx
  on public.project_output_ai_queue (queue_status, queued_at desc);

alter table public.project_output_access_requests enable row level security;
alter table public.project_output_access_logs enable row level security;
alter table public.project_output_ai_queue enable row level security;

drop policy if exists "public read project_output_access_requests" on public.project_output_access_requests;
create policy "public read project_output_access_requests"
on public.project_output_access_requests
for select
to anon, authenticated
using (true);

drop policy if exists "public insert project_output_access_requests" on public.project_output_access_requests;
create policy "public insert project_output_access_requests"
on public.project_output_access_requests
for insert
to anon, authenticated
with check (true);

drop policy if exists "public update project_output_access_requests" on public.project_output_access_requests;
create policy "public update project_output_access_requests"
on public.project_output_access_requests
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public delete project_output_access_requests" on public.project_output_access_requests;
create policy "public delete project_output_access_requests"
on public.project_output_access_requests
for delete
to anon, authenticated
using (true);

drop policy if exists "public read project_output_access_logs" on public.project_output_access_logs;
create policy "public read project_output_access_logs"
on public.project_output_access_logs
for select
to anon, authenticated
using (true);

drop policy if exists "public insert project_output_access_logs" on public.project_output_access_logs;
create policy "public insert project_output_access_logs"
on public.project_output_access_logs
for insert
to anon, authenticated
with check (true);

drop policy if exists "public update project_output_access_logs" on public.project_output_access_logs;
create policy "public update project_output_access_logs"
on public.project_output_access_logs
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public delete project_output_access_logs" on public.project_output_access_logs;
create policy "public delete project_output_access_logs"
on public.project_output_access_logs
for delete
to anon, authenticated
using (true);

drop policy if exists "public read project_output_ai_queue" on public.project_output_ai_queue;
create policy "public read project_output_ai_queue"
on public.project_output_ai_queue
for select
to anon, authenticated
using (true);

drop policy if exists "public insert project_output_ai_queue" on public.project_output_ai_queue;
create policy "public insert project_output_ai_queue"
on public.project_output_ai_queue
for insert
to anon, authenticated
with check (true);

drop policy if exists "public update project_output_ai_queue" on public.project_output_ai_queue;
create policy "public update project_output_ai_queue"
on public.project_output_ai_queue
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public delete project_output_ai_queue" on public.project_output_ai_queue;
create policy "public delete project_output_ai_queue"
on public.project_output_ai_queue
for delete
to anon, authenticated
using (true);

-- =========================================================
-- 7) 스토리지 버킷: project-outputs
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-outputs',
  'project-outputs',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/zip'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read project outputs docs" on storage.objects;

drop policy if exists "public insert project outputs docs" on storage.objects;
create policy "public insert project outputs docs"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'project-outputs');

drop policy if exists "public update project outputs docs" on storage.objects;
create policy "public update project outputs docs"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'project-outputs')
with check (bucket_id = 'project-outputs');

drop policy if exists "public delete project outputs docs" on storage.objects;
create policy "public delete project outputs docs"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'project-outputs');

commit;

-- PostgREST schema cache refresh
select pg_notify('pgrst', 'reload schema');

