-- 웹푸시 구독 저장 테이블
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  to_user_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text null default '',
  is_active boolean not null default true,
  last_sent_at bigint null,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_push_subscriptions_user_active
  on public.push_subscriptions (to_user_id, is_active);

create or replace function public.set_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := (extract(epoch from now()) * 1000)::bigint;
  return new;
end;
$$;

drop trigger if exists trg_push_subscriptions_updated_at on public.push_subscriptions;
create trigger trg_push_subscriptions_updated_at
before update on public.push_subscriptions
for each row execute function public.set_push_subscriptions_updated_at();

grant select, insert, update, delete on table public.push_subscriptions to anon, authenticated;
