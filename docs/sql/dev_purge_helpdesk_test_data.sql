-- Help Desk 테스트 데이터 삭제 (통합 버전)
-- PostgreSQL / Supabase SQL Editor 기준
-- 목적: 신청자/관리자 화면에 남아 있는 동일 테스트 묶음을 한 번에 삭제
-- 기준:
--   1) 티켓번호 배치: HD-20260420-*
--   2) 계정 식별자: id / user_id(문자열키) / email / name 교차 매칭

begin;

-- 1) 삭제 기준 계정 목록 (필요 시 추가)
drop table if exists _tmp_hd_purge_actor_keys;
create temporary table _tmp_hd_purge_actor_keys (
  key_type text not null,
  key_value text not null
);

insert into _tmp_hd_purge_actor_keys (key_type, key_value) values
  -- 신청자
  ('name', '임소영'),
  -- 관리자/담당자
  ('name', '한휘선'),
  ('user_id', 'hshan'),
  ('email', 'hshan@hjcustoms.co.kr');

-- 2) users에서 실제 식별자 확장 (id/email/name)
drop table if exists _tmp_hd_purge_users;
create temporary table _tmp_hd_purge_users as
select distinct
  trim(coalesce(u.id::text, ''))               as id_key,
  lower(trim(coalesce(u.email, '')))           as email_key,
  trim(coalesce(u.name, ''))                   as name_key
from public.users u
where
  trim(coalesce(u.name, '')) in (
    select key_value from _tmp_hd_purge_actor_keys where key_type = 'name'
  )
  or lower(trim(coalesce(u.email, ''))) in (
    select lower(key_value) from _tmp_hd_purge_actor_keys where key_type = 'email'
  );

-- 3) 삭제 대상 티켓 추출
drop table if exists _tmp_hd_purge_targets;
create temporary table _tmp_hd_purge_targets as
select
  t.id,
  t.ticket_no,
  t.title,
  t.status,
  t.reporter_user_id,
  t.reporter_user_name,
  t.assignee_user_id,
  t.assignee_user_name,
  t.created_at
from public.helpdesk_tickets t
where
  (
    -- 1순위: 테스트 배치 티켓번호 전체
    t.ticket_no like 'HD-20260420-%'
  )
  and (
    -- 계정 식별자 교차 매칭 (id/user_id문자열/email/name)
    lower(trim(coalesce(t.reporter_user_id, ''))) in (
      select lower(id_key) from _tmp_hd_purge_users where id_key <> ''
      union
      select email_key from _tmp_hd_purge_users where email_key <> ''
      union
      select lower(key_value) from _tmp_hd_purge_actor_keys where key_type = 'user_id'
    )
    or lower(trim(coalesce(t.assignee_user_id, ''))) in (
      select lower(id_key) from _tmp_hd_purge_users where id_key <> ''
      union
      select email_key from _tmp_hd_purge_users where email_key <> ''
      union
      select lower(key_value) from _tmp_hd_purge_actor_keys where key_type = 'user_id'
    )
    or trim(coalesce(t.reporter_user_name, '')) in (
      select name_key from _tmp_hd_purge_users where name_key <> ''
      union
      select key_value from _tmp_hd_purge_actor_keys where key_type = 'name'
    )
    or trim(coalesce(t.assignee_user_name, '')) in (
      select name_key from _tmp_hd_purge_users where name_key <> ''
      union
      select key_value from _tmp_hd_purge_actor_keys where key_type = 'name'
    )
  );

-- 4) 삭제 대상 확인
select
  id,
  ticket_no,
  status,
  title,
  reporter_user_id,
  reporter_user_name,
  assignee_user_id,
  assignee_user_name,
  to_timestamp((coalesce(created_at, 0)::numeric) / 1000) as created_at_ts
from _tmp_hd_purge_targets
order by created_at;

-- 5) 자식 데이터 먼저 삭제
delete from public.helpdesk_ticket_attachments a
using _tmp_hd_purge_targets t
where a.ticket_id = t.id;

delete from public.helpdesk_ticket_comments c
using _tmp_hd_purge_targets t
where c.ticket_id = t.id;

-- 알림 데이터 정리 (entry_id: text, ticket id: uuid)
delete from public.notifications n
using _tmp_hd_purge_targets t
where n.entry_id = t.id::text;

-- 6) 티켓 본문 삭제
delete from public.helpdesk_tickets h
using _tmp_hd_purge_targets t
where h.id = t.id
returning
  h.id,
  h.ticket_no,
  h.status,
  h.title,
  h.reporter_user_name,
  h.assignee_user_name;

commit;

