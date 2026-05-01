-- 표준단가 마스터 테이블
-- 목적: 직책/특정인 예외 단가를 1개 테이블에서 중앙관리

create table if not exists public.standard_rate_master (
  id uuid primary key default gen_random_uuid(),
  rate_key text not null unique, -- 예: title_senior, title_team_lead, title_ceo
  role_key text not null default '', -- senior/associate/principal/team_lead/division_head/bu_head/ceo
  user_name text not null default '', -- 특정인 예외단가인 경우 사용
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
create policy "public read standard_rate_master" on public.standard_rate_master
for select to anon, authenticated using (true);

drop policy if exists "public insert standard_rate_master" on public.standard_rate_master;
create policy "public insert standard_rate_master" on public.standard_rate_master
for insert to anon, authenticated with check (true);

drop policy if exists "public update standard_rate_master" on public.standard_rate_master;
create policy "public update standard_rate_master" on public.standard_rate_master
for update to anon, authenticated using (true) with check (true);

drop policy if exists "public delete standard_rate_master" on public.standard_rate_master;
create policy "public delete standard_rate_master" on public.standard_rate_master
for delete to anon, authenticated using (true);

comment on table public.standard_rate_master is '타임차지 표준단가(직책/특정인 예외) 중앙관리';

-- 기본값 시드 (재실행 가능)
insert into public.standard_rate_master (rate_key, role_key, user_name, unit_rate, is_active, note, updated_at)
values
  ('title_senior', 'senior', '', 200000, true, '직책 표준단가', public.now_ms()),
  ('title_associate', 'associate', '', 300000, true, '직책 표준단가', public.now_ms()),
  ('title_principal', 'principal', '', 500000, true, '직책 표준단가', public.now_ms()),
  ('title_team_lead', 'team_lead', '', 700000, true, '직책 표준단가', public.now_ms()),
  ('title_division_head', 'division_head', '', 800000, true, '직책 표준단가', public.now_ms()),
  ('title_bu_head', 'bu_head', '', 900000, true, '직책 표준단가', public.now_ms()),
  ('title_ceo', 'ceo', '한휘선', 1000000, true, '대표 표준단가', public.now_ms())
on conflict (rate_key)
do update set
  role_key = excluded.role_key,
  user_name = excluded.user_name,
  unit_rate = excluded.unit_rate,
  is_active = excluded.is_active,
  note = excluded.note,
  updated_at = public.now_ms();
