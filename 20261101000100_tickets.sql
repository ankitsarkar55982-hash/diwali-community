-- Support tickets. Deliberately has NO relation to greeting cards: greeting names/messages are generated and kept in the visitor's browser only.
create table public.ticket_counters (year int primary key, n int not null default 0);

create or replace function public.next_ticket_no() returns text
language plpgsql security definer set search_path = '' as $$
declare y int := extract(year from now())::int; k int;
begin
  insert into public.ticket_counters (year, n) values (y, 1)
  on conflict (year) do update set n = public.ticket_counters.n + 1 returning n into k;  -- atomic, no duplicates
  return 'DIWALI-' || y || '-' || lpad(k::text, 4, '0');
end $$;
revoke all on function public.next_ticket_no() from public, anon, authenticated;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text not null unique,
  tracking_token_hash text not null,                 -- SHA-256 of the random tracking code; the code itself is never stored
  name text check (char_length(name) <= 80),
  email text check (char_length(email) <= 120),
  category text not null check (category in ('photo_upload','gallery','greeting_card','download_share','website_bug','other')),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  attachment_path text,
  admin_notes text check (char_length(admin_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_status_created_idx on public.tickets (status, created_at desc);
create index tickets_category_idx on public.tickets (category);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as
$$ begin new.updated_at = now(); return new; end $$;
create trigger tickets_touch before update on public.tickets for each row execute function public.touch_updated_at();

alter table public.tickets enable row level security;
alter table public.ticket_counters enable row level security;
revoke all on public.tickets, public.ticket_counters from anon, authenticated;
grant select on public.tickets to authenticated;
create policy "admins read tickets" on public.tickets for select to authenticated using (public.is_admin());
-- No insert/update/delete policies: visitors submit and track through Edge Functions only; admin writes go through the admin function.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 3145728, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg'];

grant execute on function public.next_ticket_no() to service_role;
