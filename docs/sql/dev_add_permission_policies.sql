-- 권한 정책 테이블 (메뉴/액션 권한 매트릭스)
-- scope_type:
--   role     : 역할 단위 기본 정책
--   dept_job : 사업부+직책 단위 정책(경영지원 예외 포함)

create table if not exists public.permission_policies (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null default 'role',
  role_key text not null default '',
  dept_id text not null default '',
  dept_name text not null default '',
  job_title text not null default '',
  menu_key text not null default '',
  action_key text not null default '',
  allow boolean not null default false,
  note text not null default '',
  created_by text not null default '',
  created_by_name text not null default '',
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create unique index if not exists permission_policies_scope_unique
  on public.permission_policies (scope_type, role_key, dept_id, dept_name, job_title, menu_key, action_key);

create index if not exists permission_policies_lookup_idx
  on public.permission_policies (scope_type, role_key, dept_id, job_title, menu_key, action_key);

alter table public.permission_policies enable row level security;

drop policy if exists "public read permission_policies" on public.permission_policies;
create policy "public read permission_policies" on public.permission_policies
for select to anon, authenticated using (true);

drop policy if exists "public insert permission_policies" on public.permission_policies;
create policy "public insert permission_policies" on public.permission_policies
for insert to anon, authenticated with check (true);

drop policy if exists "public update permission_policies" on public.permission_policies;
create policy "public update permission_policies" on public.permission_policies
for update to anon, authenticated using (true) with check (true);

drop policy if exists "public delete permission_policies" on public.permission_policies;
create policy "public delete permission_policies" on public.permission_policies
for delete to anon, authenticated using (true);

comment on table public.permission_policies is '권한관리 화면에서 사용하는 메뉴/액션 권한 정책';

-- 기본 시드: 경영지원팀장 전체열람, 경영지원 담당(Staff) 프로젝트현황 열람
insert into public.permission_policies
  (scope_type, role_key, dept_id, dept_name, job_title, menu_key, action_key, allow, note, updated_at)
values
  ('dept_job', '', '', '경영지원', 'mgmt_support', '*', 'read', true, '경영지원팀장 전체열람', public.now_ms()),
  ('dept_job', '', '', '경영지원', 'staff_consultant', 'project-dashboard', 'read', true, '경영지원 담당(선임/전임/책임 통합) 현황조회', public.now_ms())
on conflict (scope_type, role_key, dept_id, dept_name, job_title, menu_key, action_key)
do update set
  allow = excluded.allow,
  note = excluded.note,
  updated_at = public.now_ms();
