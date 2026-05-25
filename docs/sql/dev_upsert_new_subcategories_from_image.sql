-- 목적:
-- - 기존 소분류 데이터는 삭제하지 않고 유지
-- - 이미지의 신규 소분류 목록을 DB에 반영(없으면 insert, 있으면 유지)
-- - 신규 입력 화면 제어를 위해 is_active_for_entry 플래그 사용
-- - 대상 대분류(기본): '일반통관업무'
--
-- 사용 방법:
-- 1) BEGIN ~ COMMIT 전체를 한 번에 실행
-- 2) 실행 후 하단 검증 쿼리 결과 확인
--
-- 주의:
-- - 본 스크립트는 work_subcategories 테이블에 is_active_for_entry 컬럼을 추가합니다.
-- - 기존 이력(time_entries/time_entry_details)은 변경하지 않습니다.

begin;

-- 0) 입력 노출 제어 컬럼 추가(없을 때만)
alter table public.work_subcategories
  add column if not exists is_active_for_entry boolean not null default true;

-- 1) 신규 소분류 목록(이미지 기준)
drop table if exists tmp_new_subcategories;
create temporary table tmp_new_subcategories (
  sub_category_name text primary key,
  sort_order int not null
) on commit drop;

insert into tmp_new_subcategories (sub_category_name, sort_order) values
  ('고객정기레포트', 10),
  ('Master data 관리', 20),
  ('가격신고 및 과세자료 검토', 30),
  ('과세가격 검토', 40),
  ('관세감면 검토', 50),
  ('확정가격신고', 60),
  ('품목 · 세율 검토', 70),
  ('규제 · 요건 검토', 80),
  ('신고정정(보정, 수정, 경정청구)', 90),
  ('FTA 검토', 100),
  ('특혜 원산지 증명서 검토', 110),
  ('원산지 표시(대외무역법)', 120),
  ('관세환급 검토', 130),
  ('보세화물 검토', 140),
  ('신규거래 검토', 150),
  ('기타', 160);

-- 2) 대상 대분류(category_id) 확인
--    기본값: 일반통관업무
do $$
declare
  v_cnt int;
begin
  select count(*) into v_cnt
  from public.work_categories
  where trim(coalesce(category_name, '')) = '일반통관업무';

  if v_cnt = 0 then
    raise exception 'work_categories에서 ''일반통관업무''를 찾을 수 없습니다. category_name을 확인하세요.';
  end if;
end $$;

-- 3) 신규 목록 upsert
-- 3-1) 없는 항목 insert
insert into public.work_subcategories (
  id,
  category_id,
  sub_category_name,
  sort_order,
  is_active_for_entry
)
select
  gen_random_uuid(),
  c.id,
  n.sub_category_name,
  n.sort_order,
  true
from tmp_new_subcategories n
cross join (
  select id
  from public.work_categories
  where trim(coalesce(category_name, '')) = '일반통관업무'
  order by created_at asc nulls last, id
  limit 1
) c
where not exists (
  select 1
  from public.work_subcategories s
  where s.category_id = c.id
    and trim(coalesce(s.sub_category_name, '')) = trim(n.sub_category_name)
);

-- 3-2) 이미 있는 항목은 정렬순서/활성값 갱신
update public.work_subcategories s
set
  sort_order = n.sort_order,
  is_active_for_entry = true
from tmp_new_subcategories n
join (
  select id
  from public.work_categories
  where trim(coalesce(category_name, '')) = '일반통관업무'
  order by created_at asc nulls last, id
  limit 1
) c on true
where s.category_id = c.id
  and trim(coalesce(s.sub_category_name, '')) = trim(n.sub_category_name);

-- 4) 대상 대분류 내에서 신규 목록 외 항목은 입력 비활성화
--    (기존 데이터 보존, 신규 입력 드롭다운에서만 숨기기 용도)
update public.work_subcategories s
set is_active_for_entry = false
where s.category_id = (
    select id
    from public.work_categories
    where trim(coalesce(category_name, '')) = '일반통관업무'
    order by created_at asc nulls last, id
    limit 1
  )
  and not exists (
    select 1
    from tmp_new_subcategories n
    where trim(n.sub_category_name) = trim(coalesce(s.sub_category_name, ''))
  );

-- 5) 검증: 대상 대분류의 소분류 상태 확인
--    - is_active_for_entry = true 인 항목이 이미지 목록과 일치해야 함
select
  c.category_name,
  s.id,
  s.sub_category_name,
  s.sort_order,
  s.is_active_for_entry
from public.work_subcategories s
join public.work_categories c on c.id = s.category_id
where trim(coalesce(c.category_name, '')) = '일반통관업무'
order by s.is_active_for_entry desc, s.sort_order asc, s.sub_category_name asc;

commit;

