-- Help Desk RLS hardening script (custom wt_session mode)
-- IMPORTANT:
-- 1) This script is for non-Supabase-Auth apps.
-- 2) The client MUST send x-app-user-id header on every API call.
-- 3) Apply in STG first, then PROD.
--
-- Recommended companion app change:
--   API headers include:
--   - x-app-user-id
--   - x-app-user-role (optional, audit/useful log)
--   - x-app-user-email (optional, audit/useful log)

begin;

-- =========================================================
-- 1) Enable RLS
-- =========================================================
alter table if exists public.helpdesk_tickets enable row level security;
alter table if exists public.helpdesk_ticket_comments enable row level security;
alter table if exists public.helpdesk_ticket_attachments enable row level security;
alter table if exists public.helpdesk_ticket_daily_counters enable row level security;

-- =========================================================
-- 2) Remove old policies
-- =========================================================
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'helpdesk_tickets',
        'helpdesk_ticket_comments',
        'helpdesk_ticket_attachments',
        'helpdesk_ticket_daily_counters'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- =========================================================
-- 3) Helper functions (header-based identity)
-- =========================================================
create or replace function public.fn_hd_req_headers()
returns jsonb
language sql
stable
as $$
  select coalesce(current_setting('request.headers', true), '{}')::jsonb
$$;

create or replace function public.fn_hd_header(key_name text)
returns text
language sql
stable
as $$
  select trim(
    both from coalesce(
      public.fn_hd_req_headers() ->> lower(coalesce(key_name, '')),
      public.fn_hd_req_headers() ->> coalesce(key_name, ''),
      ''
    )
  )
$$;

create or replace function public.fn_hd_uid()
returns text
language sql
stable
as $$
  select nullif(public.fn_hd_header('x-app-user-id'), '')
$$;

create or replace function public.fn_hd_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id::text = public.fn_hd_uid()
      and coalesce(u.deleted, false) = false
      and coalesce(u.is_active, true) = true
  )
$$;

create or replace function public.fn_hd_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id::text = public.fn_hd_uid()
      and coalesce(u.deleted, false) = false
      and coalesce(u.is_active, true) = true
      and lower(coalesce(u.role, '')) in ('manager', 'director', 'top_mgr', 'admin')
  )
$$;

create or replace function public.fn_hd_can_read_ticket(t public.helpdesk_tickets)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.fn_hd_uid() is not null
    and public.fn_hd_is_active_user()
    and (
      coalesce(t.reporter_user_id, '') = public.fn_hd_uid()
      or coalesce(t.assignee_user_id, '') = public.fn_hd_uid()
      or public.fn_hd_is_manager()
    )
$$;

-- =========================================================
-- 4) Tickets policies
-- =========================================================
create policy hd_tickets_select
on public.helpdesk_tickets
for select
to anon, authenticated
using (public.fn_hd_can_read_ticket(helpdesk_tickets));

create policy hd_tickets_insert
on public.helpdesk_tickets
for insert
to anon, authenticated
with check (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and reporter_user_id = public.fn_hd_uid()
  and created_by = public.fn_hd_uid()
);

create policy hd_tickets_update
on public.helpdesk_tickets
for update
to anon, authenticated
using (public.fn_hd_can_read_ticket(helpdesk_tickets))
with check (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and (
    public.fn_hd_is_manager()
    or reporter_user_id = public.fn_hd_uid()
    or assignee_user_id = public.fn_hd_uid()
  )
);

create policy hd_tickets_delete
on public.helpdesk_tickets
for delete
to anon, authenticated
using (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and public.fn_hd_is_manager()
);

-- =========================================================
-- 5) Comments policies
-- =========================================================
create policy hd_comments_select
on public.helpdesk_ticket_comments
for select
to anon, authenticated
using (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and exists (
    select 1
    from public.helpdesk_tickets t
    where t.id = helpdesk_ticket_comments.ticket_id
      and public.fn_hd_can_read_ticket(t)
  )
  and (
    coalesce(is_internal_only, false) = false
    or public.fn_hd_is_manager()
    or created_by = public.fn_hd_uid()
  )
);

create policy hd_comments_insert
on public.helpdesk_ticket_comments
for insert
to anon, authenticated
with check (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and created_by = public.fn_hd_uid()
  and exists (
    select 1
    from public.helpdesk_tickets t
    where t.id = helpdesk_ticket_comments.ticket_id
      and public.fn_hd_can_read_ticket(t)
  )
);

create policy hd_comments_update
on public.helpdesk_ticket_comments
for update
to anon, authenticated
using (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and (created_by = public.fn_hd_uid() or public.fn_hd_is_manager())
)
with check (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and (created_by = public.fn_hd_uid() or public.fn_hd_is_manager())
);

create policy hd_comments_delete
on public.helpdesk_ticket_comments
for delete
to anon, authenticated
using (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and (created_by = public.fn_hd_uid() or public.fn_hd_is_manager())
);

-- =========================================================
-- 6) Attachments policies
-- =========================================================
create policy hd_attachments_select
on public.helpdesk_ticket_attachments
for select
to anon, authenticated
using (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and exists (
    select 1
    from public.helpdesk_tickets t
    where t.id = helpdesk_ticket_attachments.ticket_id
      and public.fn_hd_can_read_ticket(t)
  )
);

create policy hd_attachments_insert
on public.helpdesk_ticket_attachments
for insert
to anon, authenticated
with check (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and uploaded_by = public.fn_hd_uid()
  and exists (
    select 1
    from public.helpdesk_tickets t
    where t.id = helpdesk_ticket_attachments.ticket_id
      and public.fn_hd_can_read_ticket(t)
  )
);

create policy hd_attachments_update
on public.helpdesk_ticket_attachments
for update
to anon, authenticated
using (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and (uploaded_by = public.fn_hd_uid() or public.fn_hd_is_manager())
)
with check (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and (uploaded_by = public.fn_hd_uid() or public.fn_hd_is_manager())
);

create policy hd_attachments_delete
on public.helpdesk_ticket_attachments
for delete
to anon, authenticated
using (
  public.fn_hd_uid() is not null
  and public.fn_hd_is_active_user()
  and (uploaded_by = public.fn_hd_uid() or public.fn_hd_is_manager())
);

-- =========================================================
-- 7) Daily counters table
-- =========================================================
-- Keep blocked to anon/authenticated.
-- fn_helpdesk_assign_ticket_no() (SECURITY DEFINER trigger function) handles insert/update.
-- No policy is created intentionally.

commit;

