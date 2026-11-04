create extension if not exists pgcrypto;

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  content_hash text not null unique,                 -- blocks duplicate uploads
  bytes int not null check (bytes between 1 and 5242880),
  status text not null default 'pending' check (status in ('pending','approved','rejected','deleted')),
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null
);
create index photos_status_created_idx on public.photos (status, created_at desc);

create table public.photo_reports (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos(id) on delete cascade,
  reason text not null check (reason in ('inappropriate','privacy','copyright','spam','other')),
  details text check (char_length(details) <= 300),
  reporter_hash text not null,                       -- salted hash, not an IP
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (photo_id, reporter_hash)
);
create index photo_reports_open_idx on public.photo_reports (resolved, created_at desc);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid references public.photos(id) on delete set null,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  prev_status text,
  new_status text,
  created_at timestamptz not null default now()
);
create index moderation_logs_created_idx on public.moderation_logs (created_at desc);

create table public.rate_limits (
  id bigint generated always as identity primary key,
  key text not null, action text not null,
  created_at timestamptz not null default now()
);
create index rate_limits_lookup_idx on public.rate_limits (key, action, created_at);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- RLS everywhere. No INSERT/UPDATE/DELETE policies exist: all writes go through Edge Functions (service role).
alter table public.photos enable row level security;
alter table public.photo_reports enable row level security;
alter table public.admin_users enable row level security;
alter table public.moderation_logs enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select (id, status, created_at) on public.photos to anon, authenticated;  -- never storage_path
grant select on public.photo_reports, public.moderation_logs to authenticated;
grant select on public.admin_users to authenticated;

create policy "public reads approved photos" on public.photos for select to anon, authenticated using (status = 'approved');
create policy "admins read reports" on public.photo_reports for select to authenticated using (public.is_admin());
create policy "admins read logs" on public.moderation_logs for select to authenticated using (public.is_admin());
create policy "users read own admin row" on public.admin_users for select to authenticated using (user_id = auth.uid());

-- Private quarantine bucket. No storage.objects policies = no direct client access at all.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos-quarantine', 'photos-quarantine', false, 5242880, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];
