-- Help Desk v1 (내부 운영 -> 외주 전환 준비) 스키마
-- PostgreSQL / Supabase 기준

-- 1) 티켓 본문
create table if not exists public.helpdesk_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text unique,
  category text not null check (category in ('bug', 'improvement', 'question')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'triaged', 'in_progress', 'waiting_user', 'resolved', 'closed', 'rejected')),
  title text not null,
  description text not null,
  page_code text not null default '',
  repro_steps text not null default '',
  expected_result text not null default '',
  actual_result text not null default '',
  reporter_user_id text not null,
  reporter_user_name text not null default '',
  reporter_org text not null default '',
  assignee_user_id text not null default '',
  assignee_user_name text not null default '',
  owner_team text not null default 'internal',
  -- 내부 운영 후 외주 이관 준비 필드
  outsource_ready boolean not null default false,
  vendor_visible boolean not null default false,
  vendor_assignee text not null default '',
  external_ref_no text not null default '',
  due_at bigint,
  resolved_at bigint,
  closed_at bigint,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by text not null default '',
  created_by_name text not null default '',
  updated_by text not null default '',
  updated_by_name text not null default ''
);

create index if not exists idx_helpdesk_tickets_status on public.helpdesk_tickets(status);
create index if not exists idx_helpdesk_tickets_category on public.helpdesk_tickets(category);
create index if not exists idx_helpdesk_tickets_reporter on public.helpdesk_tickets(reporter_user_id);
create index if not exists idx_helpdesk_tickets_assignee on public.helpdesk_tickets(assignee_user_id);
create index if not exists idx_helpdesk_tickets_vendor_visible on public.helpdesk_tickets(vendor_visible);
create index if not exists idx_helpdesk_tickets_created_at on public.helpdesk_tickets(created_at desc);

-- 2) 티켓 코멘트/처리이력
create table if not exists public.helpdesk_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  comment_type text not null default 'comment'
    check (comment_type in ('comment', 'status_change', 'assignment', 'system')),
  body text not null default '',
  old_status text not null default '',
  new_status text not null default '',
  is_internal_only boolean not null default false,
  vendor_visible boolean not null default false,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by text not null default '',
  created_by_name text not null default ''
);

create index if not exists idx_helpdesk_comments_ticket on public.helpdesk_ticket_comments(ticket_id, created_at desc);
create index if not exists idx_helpdesk_comments_vendor_visible on public.helpdesk_ticket_comments(vendor_visible);

-- 3) 첨부파일 메타
create table if not exists public.helpdesk_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_size bigint not null default 0,
  mime_type text not null default '',
  vendor_visible boolean not null default false,
  uploaded_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  uploaded_by text not null default '',
  uploaded_by_name text not null default ''
);

create index if not exists idx_helpdesk_attachments_ticket on public.helpdesk_ticket_attachments(ticket_id, uploaded_at desc);

-- 4) updated_at 자동 갱신 트리거
create or replace function public.fn_helpdesk_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := (extract(epoch from now()) * 1000)::bigint;
  return new;
end;
$$;

drop trigger if exists trg_helpdesk_tickets_touch_updated_at on public.helpdesk_tickets;
create trigger trg_helpdesk_tickets_touch_updated_at
before update on public.helpdesk_tickets
for each row execute procedure public.fn_helpdesk_touch_updated_at();

-- 5) ticket_no 자동 채번 (예: HD-20260420-0001)
-- 동시성 안전: 일자별 카운터 테이블 + UPSERT RETURNING 사용
create table if not exists public.helpdesk_ticket_daily_counters (
  counter_date date primary key,
  last_no int not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.fn_helpdesk_assign_ticket_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _counter_date date;
  _ymd text;
  _seq_no int;
begin
  if coalesce(new.ticket_no, '') <> '' then
    return new;
  end if;

  _counter_date := current_date;
  _ymd := to_char(_counter_date, 'YYYYMMDD');

  insert into public.helpdesk_ticket_daily_counters(counter_date, last_no, updated_at)
  values (_counter_date, 1, now())
  on conflict (counter_date)
  do update set
    last_no = public.helpdesk_ticket_daily_counters.last_no + 1,
    updated_at = now()
  returning last_no into _seq_no;

  new.ticket_no := 'HD-' || _ymd || '-' || lpad(_seq_no::text, 4, '0');
  return new;
end;
$$;

-- daily counter 테이블은 트리거 내부에서만 접근하므로,
-- 함수(SECURITY DEFINER)로 안전하게 갱신되게 하고 직접 접근 정책은 최소화.
alter table public.helpdesk_ticket_daily_counters enable row level security;

drop trigger if exists trg_helpdesk_tickets_assign_no on public.helpdesk_tickets;
create trigger trg_helpdesk_tickets_assign_no
before insert on public.helpdesk_tickets
for each row execute procedure public.fn_helpdesk_assign_ticket_no();

-- 6) RLS 정책 정리
-- 본 시스템은 앱 레벨(Session) 권한을 사용하므로 Help Desk 테이블은 RLS를 비활성화한다.
-- (RLS가 켜져 있으면 anon/apikey 기반 INSERT/UPDATE가 차단되어 티켓 등록 실패 발생)
alter table public.helpdesk_tickets disable row level security;
alter table public.helpdesk_ticket_comments disable row level security;
alter table public.helpdesk_ticket_attachments disable row level security;
alter table public.helpdesk_ticket_daily_counters disable row level security;

