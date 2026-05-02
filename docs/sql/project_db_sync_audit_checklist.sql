-- Project DB Sync Audit Checklist
-- 목적:
-- 1) 프로젝트등록/프로젝트관리/프로젝트아웃풋 관련 필수 스키마 존재 여부 점검
-- 2) 운영/개발 DB에서 동일 스크립트를 실행해 결과 비교
--
-- 사용 방법:
-- - 개발 DB, 운영 DB 각각에서 본 스크립트를 실행
-- - 각 섹션 결과에서 missing_* 값이 있으면 해당 객체 미동기화 상태
-- - 마지막 summary 섹션에서 missing_count = 0 이면 해당 DB 기준 필수 항목 충족

-- =========================================================
-- A) 필수 테이블 점검
-- =========================================================
with expected_tables as (
  select * from (values
    ('public','registered_projects'),
    ('public','project_code_types'),
    ('public','standard_rate_master'),
    ('public','project_outputs'),
    ('public','project_output_actions'),
    ('public','project_output_access_requests'),
    ('public','project_output_access_logs'),
    ('public','project_output_ai_queue')
  ) as t(schema_name, table_name)
)
select
  e.schema_name,
  e.table_name as missing_table
from expected_tables e
left join information_schema.tables i
  on i.table_schema = e.schema_name
 and i.table_name = e.table_name
where i.table_name is null
order by e.schema_name, e.table_name;

-- =========================================================
-- B) 핵심 컬럼 점검
-- =========================================================
with expected_columns as (
  select * from (values
    -- registered_projects
    ('public','registered_projects','cpm_user_id'),
    ('public','registered_projects','cpm_user_name'),
    ('public','registered_projects','execution_started_at'),
    ('public','registered_projects','work_closed_at'),
    ('public','registered_projects','settled_at'),
    ('public','registered_projects','lifecycle_status_override'),
    ('public','registered_projects','lifecycle_updated_at'),
    ('public','registered_projects','order_contributors_text'),
    ('public','registered_projects','billing_schedule'),
    ('public','registered_projects','registration_status'),
    -- project_code_types
    ('public','project_code_types','requires_clearance_note'),
    -- standard_rate_master
    ('public','standard_rate_master','rate_key'),
    ('public','standard_rate_master','role_key'),
    ('public','standard_rate_master','user_name'),
    ('public','standard_rate_master','unit_rate'),
    ('public','standard_rate_master','is_active'),
    -- project_outputs
    ('public','project_outputs','project_code'),
    ('public','project_outputs','output_type'),
    ('public','project_outputs','output_title'),
    ('public','project_outputs','output_file_url'),
    ('public','project_outputs','uploaded_by'),
    ('public','project_outputs','uploaded_at'),
    ('public','project_outputs','publish_status'),
    ('public','project_outputs','publish_requested_at'),
    ('public','project_outputs','publish_requested_by'),
    ('public','project_outputs','publish_requested_by_name'),
    ('public','project_outputs','publish_approved_at'),
    ('public','project_outputs','publish_approved_by'),
    ('public','project_outputs','publish_approved_by_name'),
    ('public','project_outputs','publish_decision_note'),
    ('public','project_outputs','publish_note'),
    ('public','project_outputs','published_at'),
    ('public','project_outputs','published_by'),
    -- project_output_actions
    ('public','project_output_actions','output_id'),
    ('public','project_output_actions','action_user_id'),
    ('public','project_output_actions','action_status'),
    ('public','project_output_actions','action_note'),
    -- project_output_access_requests
    ('public','project_output_access_requests','output_id'),
    ('public','project_output_access_requests','request_type'),
    ('public','project_output_access_requests','requester_user_id'),
    ('public','project_output_access_requests','status'),
    ('public','project_output_access_requests','expires_at'),
    -- project_output_access_logs
    ('public','project_output_access_logs','output_id'),
    ('public','project_output_access_logs','event_type'),
    ('public','project_output_access_logs','actor_user_id'),
    ('public','project_output_access_logs','request_id'),
    -- project_output_ai_queue
    ('public','project_output_ai_queue','output_id'),
    ('public','project_output_ai_queue','queue_status'),
    ('public','project_output_ai_queue','queued_at')
  ) as c(schema_name, table_name, column_name)
)
select
  e.schema_name,
  e.table_name,
  e.column_name as missing_column
from expected_columns e
left join information_schema.columns i
  on i.table_schema = e.schema_name
 and i.table_name = e.table_name
 and i.column_name = e.column_name
where i.column_name is null
order by e.schema_name, e.table_name, e.column_name;

-- =========================================================
-- C) 스토리지 버킷 점검 (프로젝트 아웃풋)
-- =========================================================
select
  'project-outputs' as expected_bucket,
  case when exists (
    select 1
    from storage.buckets b
    where b.id = 'project-outputs'
  ) then 'ok' else 'missing' end as bucket_status;

-- =========================================================
-- D) RLS 활성화 점검 (핵심 테이블)
-- =========================================================
with expected_rls as (
  select * from (values
    ('public','project_outputs'),
    ('public','project_output_actions'),
    ('public','project_output_access_requests'),
    ('public','project_output_access_logs'),
    ('public','project_output_ai_queue'),
    ('public','standard_rate_master')
  ) as t(schema_name, table_name)
)
select
  e.schema_name,
  e.table_name,
  coalesce(c.relrowsecurity, false) as rls_enabled
from expected_rls e
left join pg_class c
  on c.relname = e.table_name
left join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = e.schema_name
order by e.schema_name, e.table_name;

-- =========================================================
-- E) 간단 요약 (missing_count = 0 권장)
-- =========================================================
with missing_tables as (
  with expected_tables as (
    select * from (values
      ('public','registered_projects'),
      ('public','project_code_types'),
      ('public','standard_rate_master'),
      ('public','project_outputs'),
      ('public','project_output_actions'),
      ('public','project_output_access_requests'),
      ('public','project_output_access_logs'),
      ('public','project_output_ai_queue')
    ) as t(schema_name, table_name)
  )
  select count(*)::int as cnt
  from expected_tables e
  left join information_schema.tables i
    on i.table_schema = e.schema_name
   and i.table_name = e.table_name
  where i.table_name is null
),
missing_columns as (
  with expected_columns as (
    select * from (values
      ('public','registered_projects','cpm_user_id'),
      ('public','registered_projects','cpm_user_name'),
      ('public','registered_projects','execution_started_at'),
      ('public','registered_projects','work_closed_at'),
      ('public','registered_projects','settled_at'),
      ('public','registered_projects','lifecycle_status_override'),
      ('public','registered_projects','lifecycle_updated_at'),
      ('public','registered_projects','order_contributors_text'),
      ('public','registered_projects','billing_schedule'),
      ('public','registered_projects','registration_status'),
      ('public','project_code_types','requires_clearance_note'),
      ('public','standard_rate_master','rate_key'),
      ('public','standard_rate_master','role_key'),
      ('public','standard_rate_master','user_name'),
      ('public','standard_rate_master','unit_rate'),
      ('public','standard_rate_master','is_active'),
      ('public','project_outputs','project_code'),
      ('public','project_outputs','output_type'),
      ('public','project_outputs','output_title'),
      ('public','project_outputs','output_file_url'),
      ('public','project_outputs','uploaded_by'),
      ('public','project_outputs','uploaded_at'),
      ('public','project_outputs','publish_status'),
      ('public','project_outputs','publish_requested_at'),
      ('public','project_outputs','publish_requested_by'),
      ('public','project_outputs','publish_requested_by_name'),
      ('public','project_outputs','publish_approved_at'),
      ('public','project_outputs','publish_approved_by'),
      ('public','project_outputs','publish_approved_by_name'),
      ('public','project_outputs','publish_decision_note'),
      ('public','project_outputs','publish_note'),
      ('public','project_outputs','published_at'),
      ('public','project_outputs','published_by'),
      ('public','project_output_actions','output_id'),
      ('public','project_output_actions','action_user_id'),
      ('public','project_output_actions','action_status'),
      ('public','project_output_actions','action_note'),
      ('public','project_output_access_requests','output_id'),
      ('public','project_output_access_requests','request_type'),
      ('public','project_output_access_requests','requester_user_id'),
      ('public','project_output_access_requests','status'),
      ('public','project_output_access_requests','expires_at'),
      ('public','project_output_access_logs','output_id'),
      ('public','project_output_access_logs','event_type'),
      ('public','project_output_access_logs','actor_user_id'),
      ('public','project_output_access_logs','request_id'),
      ('public','project_output_ai_queue','output_id'),
      ('public','project_output_ai_queue','queue_status'),
      ('public','project_output_ai_queue','queued_at')
    ) as c(schema_name, table_name, column_name)
  )
  select count(*)::int as cnt
  from expected_columns e
  left join information_schema.columns i
    on i.table_schema = e.schema_name
   and i.table_name = e.table_name
   and i.column_name = e.column_name
  where i.column_name is null
),
missing_bucket as (
  select
    case when exists (
      select 1 from storage.buckets b where b.id = 'project-outputs'
    ) then 0 else 1 end as cnt
)
select
  (select cnt from missing_tables) as missing_tables_count,
  (select cnt from missing_columns) as missing_columns_count,
  (select cnt from missing_bucket) as missing_storage_bucket_count,
  ((select cnt from missing_tables)
   + (select cnt from missing_columns)
   + (select cnt from missing_bucket)) as missing_count;

