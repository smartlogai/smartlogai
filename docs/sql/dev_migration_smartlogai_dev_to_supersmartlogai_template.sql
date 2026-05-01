-- smartlogai-dev -> supersmartlogai 이관 템플릿 (안정형)
-- 목적:
-- 1) 구앱 CSV를 staging으로 먼저 적재
-- 2) 정제/검증 SQL로 품질 확인
-- 3) 검증 통과 시 본 테이블 upsert
--
-- 사용 순서:
-- A. 아래 staging 테이블 생성
-- B. Supabase Table Editor Import 또는 \copy로 CSV 적재
-- C. "검증 쿼리" 섹션 실행
-- D. "본 테이블 반영" 섹션 실행
-- E. 반영 후 재검증
--
-- 주의:
-- - legacy_id(구앱 원본키) 반드시 유지
-- - 본 스크립트는 컬럼 최소세트 기준이며, 운영 컬럼은 환경에 맞게 확장
-- - 1회성 컷오버 용도 (상시 ETL 아님)

begin;

create schema if not exists migration_stg;

-- 1) 사용자 staging
create table if not exists migration_stg.users_raw (
  legacy_id              text primary key,
  email                  text not null default '',
  name                   text not null default '',
  role                   text not null default '',
  dept_name              text not null default '',
  hq_name                text not null default '',
  cs_team_name           text not null default '',
  approver_1st_user_id   text not null default '',
  approver_final_user_id text not null default '',
  is_active              boolean,
  raw                    jsonb not null default '{}'::jsonb,
  loaded_at              bigint not null default public.now_ms()
);

-- 2) 프로젝트 staging
create table if not exists migration_stg.registered_projects_raw (
  legacy_id            text primary key,
  project_code         text not null default '',
  project_name         text not null default '',
  client_name          text not null default '',
  registration_status  text not null default '',
  project_status       text not null default '',
  main_category        text not null default '',
  sub_category         text not null default '',
  dept_name            text not null default '',
  created_by_legacy_id text not null default '',
  cpm_legacy_id        text not null default '',
  start_date           date,
  end_date             date,
  raw                  jsonb not null default '{}'::jsonb,
  loaded_at            bigint not null default public.now_ms()
);
create index if not exists registered_projects_raw_code_idx on migration_stg.registered_projects_raw (project_code);

-- 3) 세금계산서 staging
create table if not exists migration_stg.project_invoices_raw (
  legacy_id           text primary key,
  project_code        text not null default '',
  invoice_number      text not null default '',
  issue_date          date,
  due_date            date,
  amount_supply       numeric(18,2),
  amount_vat          numeric(18,2),
  amount_total        numeric(18,2),
  payment_status      text not null default '',
  raw                 jsonb not null default '{}'::jsonb,
  loaded_at           bigint not null default public.now_ms()
);
create index if not exists project_invoices_raw_code_idx on migration_stg.project_invoices_raw (project_code);

-- 4) 타임엔트리 staging
create table if not exists migration_stg.time_entries_raw (
  legacy_id            text primary key,
  user_legacy_id       text not null default '',
  project_code         text not null default '',
  work_date            date,
  status               text not null default '',
  minutes              integer,
  memo                 text not null default '',
  raw                  jsonb not null default '{}'::jsonb,
  loaded_at            bigint not null default public.now_ms()
);
create index if not exists time_entries_raw_user_idx on migration_stg.time_entries_raw (user_legacy_id, work_date);

-- 5) 결과물/참고자료 staging
create table if not exists migration_stg.project_outputs_raw (
  legacy_id              text primary key,
  project_code           text not null default '',
  title                  text not null default '',
  output_type            text not null default '',
  output_main_category   text not null default '',
  output_sub_category    text not null default '',
  file_name              text not null default '',
  file_url               text not null default '',
  file_path              text not null default '',
  uploaded_by_legacy_id  text not null default '',
  note                   text not null default '',
  raw                    jsonb not null default '{}'::jsonb,
  loaded_at              bigint not null default public.now_ms()
);
create index if not exists project_outputs_raw_code_idx on migration_stg.project_outputs_raw (project_code);

commit;


-- =========================================================
-- 검증 쿼리 (CSV 적재 후 실행)
-- =========================================================

-- 0) 기본 건수
select 'users_raw' as tbl, count(*) as cnt from migration_stg.users_raw
union all
select 'registered_projects_raw', count(*) from migration_stg.registered_projects_raw
union all
select 'project_invoices_raw', count(*) from migration_stg.project_invoices_raw
union all
select 'time_entries_raw', count(*) from migration_stg.time_entries_raw
union all
select 'project_outputs_raw', count(*) from migration_stg.project_outputs_raw;

-- 1) 사용자 이메일 중복
select email, count(*) as cnt
from migration_stg.users_raw
where trim(email) <> ''
group by email
having count(*) > 1
order by cnt desc;

-- 2) 프로젝트코드 중복
select project_code, count(*) as cnt
from migration_stg.registered_projects_raw
where trim(project_code) <> ''
group by project_code
having count(*) > 1
order by cnt desc;

-- 3) 세금계산서 합계 불일치
select legacy_id, amount_supply, amount_vat, amount_total
from migration_stg.project_invoices_raw
where coalesce(amount_supply,0) + coalesce(amount_vat,0) <> coalesce(amount_total,0);

-- 4) 참조 무결성: 타임엔트리 사용자 미매핑
select t.legacy_id, t.user_legacy_id
from migration_stg.time_entries_raw t
left join migration_stg.users_raw u on u.legacy_id = t.user_legacy_id
where trim(t.user_legacy_id) <> '' and u.legacy_id is null
limit 200;

-- 5) 참조 무결성: 문서 업로더 미매핑
select o.legacy_id, o.uploaded_by_legacy_id
from migration_stg.project_outputs_raw o
left join migration_stg.users_raw u on u.legacy_id = o.uploaded_by_legacy_id
where trim(o.uploaded_by_legacy_id) <> '' and u.legacy_id is null
limit 200;

-- 6) 프로젝트 상태 분포
select project_status, count(*) as cnt
from migration_stg.registered_projects_raw
group by project_status
order by cnt desc;


-- =========================================================
-- 정제 예시 (환경에 맞게 실행)
-- =========================================================

-- role 표준화
update migration_stg.users_raw
set role = case lower(trim(role))
  when 'administrator' then 'admin'
  when 'chief' then 'director'
  when 'head' then 'top_mgr'
  when 'leader' then 'manager'
  when 'member' then 'staff'
  else lower(trim(role))
end;

-- 필수값 없는 프로젝트 제거 후보
-- (실삭제 전 먼저 select로 확인)
select * from migration_stg.registered_projects_raw
where trim(project_code) = '' or trim(project_name) = '';


-- =========================================================
-- 본 테이블 반영 (안전한 최소세트)
-- ※ 아래는 "동일 이메일 사용자 매칭" 기준
-- =========================================================

-- 1) 사용자 upsert
insert into public.users (
  email, name, role, dept_name, hq_name, cs_team_name, is_active, updated_at
)
select
  nullif(trim(email), ''),
  coalesce(nullif(trim(name), ''), '이름미상'),
  coalesce(nullif(trim(role), ''), 'staff'),
  coalesce(trim(dept_name), ''),
  coalesce(trim(hq_name), ''),
  coalesce(trim(cs_team_name), ''),
  coalesce(is_active, true),
  public.now_ms()
from migration_stg.users_raw
where nullif(trim(email), '') is not null
on conflict (email) do update
set
  name = excluded.name,
  role = excluded.role,
  dept_name = excluded.dept_name,
  hq_name = excluded.hq_name,
  cs_team_name = excluded.cs_team_name,
  is_active = excluded.is_active,
  updated_at = public.now_ms();

-- 2) 프로젝트 upsert (project_code 기준)
insert into public.registered_projects (
  project_code, project_name, client_name, registration_status, project_status,
  main_category, sub_category, dept_name, updated_at
)
select
  trim(project_code),
  coalesce(nullif(trim(project_name), ''), '제목미상'),
  coalesce(trim(client_name), ''),
  coalesce(nullif(trim(registration_status), ''), 'approved'),
  coalesce(nullif(trim(project_status), ''), 'in_progress'),
  coalesce(trim(main_category), ''),
  coalesce(trim(sub_category), ''),
  coalesce(trim(dept_name), ''),
  public.now_ms()
from migration_stg.registered_projects_raw
where trim(project_code) <> ''
on conflict (project_code) do update
set
  project_name = excluded.project_name,
  client_name = excluded.client_name,
  registration_status = excluded.registration_status,
  project_status = excluded.project_status,
  main_category = excluded.main_category,
  sub_category = excluded.sub_category,
  dept_name = excluded.dept_name,
  updated_at = public.now_ms();

-- 3) 세금계산서 upsert (invoice_number 기준 가정)
-- 환경에 유니크키가 다르면 조건 변경 필요
insert into public.project_invoices (
  project_code, invoice_number, issue_date, due_date,
  amount_supply, amount_vat, amount_total, payment_status, updated_at
)
select
  trim(project_code),
  trim(invoice_number),
  issue_date,
  due_date,
  coalesce(amount_supply, 0),
  coalesce(amount_vat, 0),
  coalesce(amount_total, coalesce(amount_supply,0) + coalesce(amount_vat,0)),
  coalesce(nullif(trim(payment_status), ''), 'pending'),
  public.now_ms()
from migration_stg.project_invoices_raw
where trim(project_code) <> '' and trim(invoice_number) <> ''
on conflict (invoice_number) do update
set
  project_code = excluded.project_code,
  issue_date = excluded.issue_date,
  due_date = excluded.due_date,
  amount_supply = excluded.amount_supply,
  amount_vat = excluded.amount_vat,
  amount_total = excluded.amount_total,
  payment_status = excluded.payment_status,
  updated_at = public.now_ms();

-- 4) 결과물/참고자료 반영 (중복방지 키는 환경별 조정)
insert into public.project_outputs (
  project_code, title, output_type, output_main_category, output_sub_category,
  file_name, file_url, file_path, note, updated_at
)
select
  trim(project_code),
  coalesce(nullif(trim(title), ''), '제목미상'),
  coalesce(nullif(trim(output_type), ''), '참고자료'),
  coalesce(trim(output_main_category), ''),
  coalesce(trim(output_sub_category), ''),
  coalesce(trim(file_name), ''),
  coalesce(trim(file_url), ''),
  coalesce(trim(file_path), ''),
  coalesce(note, ''),
  public.now_ms()
from migration_stg.project_outputs_raw
where trim(title) <> '';

-- 5) RAG seed/queue 재적재 (결과물 적재 후)
insert into public.project_output_rag_seeds (
  output_id, source_kind, output_type, title, summary, project_code,
  main_category, sub_category, file_name, file_url, file_path, rag_status,
  created_at, updated_at
)
select
  o.id::text as output_id,
  case when o.output_type = '참고자료' then 'reference' else 'result_report' end as source_kind,
  coalesce(o.output_type, ''),
  coalesce(o.title, ''),
  coalesce(o.note, ''),
  coalesce(o.project_code, ''),
  coalesce(o.output_main_category, ''),
  coalesce(o.output_sub_category, ''),
  coalesce(o.file_name, ''),
  coalesce(o.file_url, ''),
  coalesce(o.file_path, ''),
  'queued',
  public.now_ms(),
  public.now_ms()
from public.project_outputs o
left join public.project_output_rag_seeds s on s.output_id = o.id::text
where s.id is null;

insert into public.project_output_rag_index_queue (
  seed_id, output_id, job_type, status, requested_by, requested_by_name, created_at, updated_at
)
select
  s.id::text,
  s.output_id,
  'index',
  'pending',
  '',
  'migration',
  public.now_ms(),
  public.now_ms()
from public.project_output_rag_seeds s
left join public.project_output_rag_index_queue q
  on q.seed_id = s.id::text and q.status in ('pending','processing')
where s.rag_status = 'queued'
  and q.id is null;


-- =========================================================
-- 반영 후 검증
-- =========================================================

select 'users' as tbl, count(*) as cnt from public.users
union all
select 'registered_projects', count(*) from public.registered_projects
union all
select 'project_invoices', count(*) from public.project_invoices
union all
select 'project_outputs', count(*) from public.project_outputs
union all
select 'project_output_rag_seeds', count(*) from public.project_output_rag_seeds
union all
select 'project_output_rag_index_queue_pending', count(*) from public.project_output_rag_index_queue where status = 'pending';

-- 샘플 점검: 미매핑 프로젝트코드(계산서)
select i.id, i.project_code
from public.project_invoices i
left join public.registered_projects p on p.project_code = i.project_code
where coalesce(i.project_code, '') <> '' and p.id is null
limit 200;
