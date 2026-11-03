-- Aggregate counters only. No visitor id, IP, user agent, timestamp-per-event or content is stored: each event just adds 1 to a total.
create table public.site_counters (
  metric text primary key check (metric in ('visits','cards_created','shares','photo_submissions','ticket_submissions')),
  total bigint not null default 0 check (total >= 0),
  updated_at timestamptz not null default now()
);
insert into public.site_counters (metric) values ('visits'),('cards_created'),('shares'),('photo_submissions'),('ticket_submissions');

alter table public.site_counters enable row level security;
revoke all on public.site_counters from anon, authenticated;
grant select on public.site_counters to authenticated;
create policy "admins read counters" on public.site_counters for select to authenticated using (public.is_admin());

create or replace function public.increment_counter(m text) returns void
language sql security definer set search_path = '' as
$$ update public.site_counters set total = total + 1, updated_at = now() where metric = m $$;
revoke all on function public.increment_counter(text) from public, anon, authenticated;
grant execute on function public.increment_counter(text) to service_role;
