-- Time Entry 테스트 데이터 삭제 (안전 버전)
-- 대상 문서번호: ID042001
-- PostgreSQL / Supabase SQL Editor 기준
-- 특징:
--  - doc_no 공백/대소문자 차이 보정
--  - 연계 테이블이 없어도 오류 없이 진행
--  - 삭제 건수 NOTICE 출력

begin;

-- 1) 삭제 대상 엔트리 추출
-- exact/포함 + 영숫자 정규화 비교(보이지 않는 특수문자 대응)
drop table if exists _tmp_te_purge_targets;
create temporary table _tmp_te_purge_targets as
select
  te.id,
  te.id::text as entry_id_text,
  te.doc_no,
  case
    when upper(trim(coalesce(te.doc_no, ''))) ~ '^ID[0-9]{10}$' then
      'ID'
      || substring(upper(trim(te.doc_no)) from 5 for 2) -- MM
      || substring(upper(trim(te.doc_no)) from 7 for 2) -- DD
      || to_char(coalesce(substring(upper(trim(te.doc_no)) from 9 for 4)::int, 0), 'FM00') -- #### -> 최소 2자리
    else upper(trim(coalesce(te.doc_no, '')))
  end as doc_no_short_like,
  te.user_id,
  te.user_name,
  te.created_at
from public.time_entries te
where
  upper(trim(coalesce(te.doc_no, ''))) = 'ID042001'
  or upper(regexp_replace(coalesce(te.doc_no, ''), '\s+', '', 'g')) like '%ID042001%'
  or regexp_replace(upper(coalesce(te.doc_no, '')), '[^A-Z0-9]', '', 'g') = 'ID042001'
  or (
    upper(trim(coalesce(te.doc_no, ''))) ~ '^ID[0-9]{10}$'
    and (
      'ID'
      || substring(upper(trim(te.doc_no)) from 5 for 2)
      || substring(upper(trim(te.doc_no)) from 7 for 2)
      || to_char(coalesce(substring(upper(trim(te.doc_no)) from 9 for 4)::int, 0), 'FM00')
    ) = 'ID042001'
  );

-- 2) 대상 확인
select
  id,
  doc_no,
  doc_no_short_like,
  regexp_replace(upper(coalesce(doc_no, '')), '[^A-Z0-9]', '', 'g') as doc_no_normalized,
  user_id,
  user_name,
  to_timestamp((coalesce(created_at, 0)::numeric) / 1000) as created_at_ts
from _tmp_te_purge_targets
order by created_at;

-- 대상 건수 확인
select count(*) as target_rows from _tmp_te_purge_targets;

-- 3) 자식/연계 데이터 삭제 (테이블 존재 시에만)
do $$
declare
  v_cnt integer := 0;
begin
  if to_regclass('public.attachments') is not null then
    execute $q$
      delete from public.attachments a
      using _tmp_te_purge_targets t
      where a.entry_id::text = t.entry_id_text
    $q$;
    get diagnostics v_cnt = row_count;
    raise notice 'attachments deleted: %', v_cnt;
  end if;

  if to_regclass('public.mail_references') is not null then
    execute $q$
      delete from public.mail_references mr
      using _tmp_te_purge_targets t
      where mr.entry_id = t.id
    $q$;
    get diagnostics v_cnt = row_count;
    raise notice 'mail_references deleted: %', v_cnt;
  end if;

  if to_regclass('public.notifications') is not null then
    execute $q$
      delete from public.notifications n
      using _tmp_te_purge_targets t
      where n.entry_id = t.entry_id_text
    $q$;
    get diagnostics v_cnt = row_count;
    raise notice 'notifications deleted: %', v_cnt;
  end if;

  if to_regclass('public.project_timecharge_lines') is not null then
    execute $q$
      delete from public.project_timecharge_lines l
      using _tmp_te_purge_targets t
      where l.entry_id = t.entry_id_text
    $q$;
    get diagnostics v_cnt = row_count;
    raise notice 'project_timecharge_lines deleted: %', v_cnt;
  end if;
end
$$;

-- 4) 본문 삭제
delete from public.time_entries te
using _tmp_te_purge_targets t
where te.id = t.id
returning
  te.id,
  te.doc_no,
  te.user_id,
  te.user_name;

commit;

-- 5) 사후 확인
select count(*) as remained_rows
from public.time_entries te
where upper(trim(coalesce(te.doc_no, ''))) = 'ID042001';

-- 6) 유사 문서번호 잔존 확인
select
  te.id,
  te.doc_no,
  case
    when upper(trim(coalesce(te.doc_no, ''))) ~ '^ID[0-9]{10}$' then
      'ID'
      || substring(upper(trim(te.doc_no)) from 5 for 2)
      || substring(upper(trim(te.doc_no)) from 7 for 2)
      || to_char(coalesce(substring(upper(trim(te.doc_no)) from 9 for 4)::int, 0), 'FM00')
    else upper(trim(coalesce(te.doc_no, '')))
  end as doc_no_short_like,
  regexp_replace(upper(coalesce(te.doc_no, '')), '[^A-Z0-9]', '', 'g') as doc_no_normalized
from public.time_entries te
where
  regexp_replace(upper(coalesce(te.doc_no, '')), '[^A-Z0-9]', '', 'g') like '%ID042001%'
  or (
    upper(trim(coalesce(te.doc_no, ''))) ~ '^ID[0-9]{10}$'
    and (
      'ID'
      || substring(upper(trim(te.doc_no)) from 5 for 2)
      || substring(upper(trim(te.doc_no)) from 7 for 2)
      || to_char(coalesce(substring(upper(trim(te.doc_no)) from 9 for 4)::int, 0), 'FM00')
    ) = 'ID042001'
  )
order by te.created_at desc;

