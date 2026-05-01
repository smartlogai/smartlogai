-- 목적:
-- 기존 사용자 전체에 표준단가 기본값을 일괄 적용합니다.
-- - staff    : 200,000
-- - manager  : 300,000
-- - director : 500,000
-- - top_mgr  : 700,000
-- - 한휘선    : 1,000,000 (이름 우선)
--
-- 적용 정책:
-- 1) 사용자별 active 레코드가 여러 개면 최신 1건만 남기고 나머지는 비활성화
-- 2) 최신 active 1건이 있으면 해당 행을 기본값으로 업데이트
-- 3) active 레코드가 없으면 신규 1건 생성
--
-- 재실행 가능(idempotent) 스크립트입니다.

begin;

-- 기준 대상 사용자 집합(단가가 정의되는 사용자만)
with target_users as (
  select
    cast(u.id as text) as user_id,
    coalesce(u.name, '') as user_name,
    lower(coalesce(u.role, '')) as role_key,
    case
      when coalesce(u.name, '') = '한휘선' then 1000000
      when lower(coalesce(u.role, '')) = 'staff' then 200000
      when lower(coalesce(u.role, '')) = 'manager' then 300000
      when lower(coalesce(u.role, '')) = 'director' then 500000
      when lower(coalesce(u.role, '')) = 'top_mgr' then 700000
      else null
    end as unit_rate
  from public.users u
),
targets as (
  select *
  from target_users
  where unit_rate is not null
),
ranked_active as (
  select
    ur.id,
    ur.user_id,
    row_number() over (
      partition by ur.user_id
      order by ur.updated_at desc nulls last, ur.created_at desc nulls last, ur.id desc
    ) as rn
  from public.user_rate_cards ur
  join targets t on t.user_id = ur.user_id
  where ur.is_active = true
)
update public.user_rate_cards ur
set
  is_active = false,
  updated_at = (extract(epoch from now()) * 1000)::bigint
from ranked_active r
where ur.id = r.id
  and r.rn > 1;

-- 최신 active 1건 업데이트
with target_users as (
  select
    cast(u.id as text) as user_id,
    coalesce(u.name, '') as user_name,
    lower(coalesce(u.role, '')) as role_key,
    case
      when coalesce(u.name, '') = '한휘선' then 1000000
      when lower(coalesce(u.role, '')) = 'staff' then 200000
      when lower(coalesce(u.role, '')) = 'manager' then 300000
      when lower(coalesce(u.role, '')) = 'director' then 500000
      when lower(coalesce(u.role, '')) = 'top_mgr' then 700000
      else null
    end as unit_rate
  from public.users u
),
targets as (
  select *
  from target_users
  where unit_rate is not null
),
latest_active as (
  select distinct on (ur.user_id)
    ur.id,
    ur.user_id
  from public.user_rate_cards ur
  join targets t on t.user_id = ur.user_id
  where ur.is_active = true
  order by ur.user_id, ur.updated_at desc nulls last, ur.created_at desc nulls last, ur.id desc
)
update public.user_rate_cards ur
set
  user_name = t.user_name,
  unit_rate = t.unit_rate,
  currency = 'KRW',
  effective_from = null,
  effective_to = null,
  is_active = true,
  note = '기본 표준단가 자동세팅(역할기준/한휘선 예외)',
  updated_at = (extract(epoch from now()) * 1000)::bigint
from latest_active la
join targets t on t.user_id = la.user_id
where ur.id = la.id;

-- active 레코드가 없는 사용자 신규 생성
with target_users as (
  select
    cast(u.id as text) as user_id,
    coalesce(u.name, '') as user_name,
    lower(coalesce(u.role, '')) as role_key,
    case
      when coalesce(u.name, '') = '한휘선' then 1000000
      when lower(coalesce(u.role, '')) = 'staff' then 200000
      when lower(coalesce(u.role, '')) = 'manager' then 300000
      when lower(coalesce(u.role, '')) = 'director' then 500000
      when lower(coalesce(u.role, '')) = 'top_mgr' then 700000
      else null
    end as unit_rate
  from public.users u
),
targets as (
  select *
  from target_users
  where unit_rate is not null
),
has_active as (
  select distinct ur.user_id
  from public.user_rate_cards ur
  join targets t on t.user_id = ur.user_id
  where ur.is_active = true
)
insert into public.user_rate_cards (
  user_id,
  user_name,
  unit_rate,
  currency,
  effective_from,
  effective_to,
  is_active,
  note,
  created_by,
  created_by_name,
  created_at,
  updated_at
)
select
  t.user_id,
  t.user_name,
  t.unit_rate,
  'KRW',
  null,
  null,
  true,
  '기본 표준단가 자동세팅(역할기준/한휘선 예외)',
  'system',
  'system',
  (extract(epoch from now()) * 1000)::bigint,
  (extract(epoch from now()) * 1000)::bigint
from targets t
left join has_active h on h.user_id = t.user_id
where h.user_id is null;

commit;

-- 검증 1) 사용자별 active 표준단가 1건씩 확인
-- select user_id, user_name, unit_rate, is_active, updated_at
-- from public.user_rate_cards
-- where is_active = true
-- order by user_name;

-- 검증 2) 역할별 분포 확인
-- select u.role, count(*) as cnt, min(ur.unit_rate) as min_rate, max(ur.unit_rate) as max_rate
-- from public.users u
-- join public.user_rate_cards ur on ur.user_id = cast(u.id as text) and ur.is_active = true
-- group by u.role
-- order by u.role;
