-- Next Finish Carpentry | shared agenda | draft migration (NOT run in production yet)
-- Apply ONLY to a dedicated Supabase project for Next Finish Carpentry.
-- No customer data is stored in this migration.
begin;

create extension if not exists pgcrypto;
create schema if not exists nfc_private;

create table if not exists public.nfc_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.nfc_team_members (
  team_id uuid not null references public.nfc_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (team_id,user_id)
);

-- SECURITY DEFINER functions avoid recursive RLS checks on the membership table.
create or replace function nfc_private.is_member(p_team uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.nfc_team_members m
    where m.team_id = p_team and m.user_id = (select auth.uid())
  );
$$;

create or replace function nfc_private.is_owner(p_team uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.nfc_team_members m
    where m.team_id = p_team and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

revoke all on schema nfc_private from public, anon;
grant usage on schema nfc_private to authenticated;
revoke all on function nfc_private.is_member(uuid), nfc_private.is_owner(uuid) from public, anon;
grant execute on function nfc_private.is_member(uuid), nfc_private.is_owner(uuid) to authenticated;

create table if not exists public.nfc_agenda_events (
  team_id uuid not null references public.nfc_teams(id) on delete cascade,
  id text not null check (length(id) between 1 and 128),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (team_id,id),
  constraint payload_event_id check (payload->>'id' = id),
  constraint payload_date check (payload ? 'data')
);

create table if not exists public.nfc_agenda_clients (
  team_id uuid not null references public.nfc_teams(id) on delete cascade,
  name_key text not null check (length(name_key) between 1 and 256),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (team_id,name_key)
);

create or replace function nfc_private.stamp_change()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.team_id := old.team_id;
  else
    new.revision := 1;
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists nfc_event_stamp on public.nfc_agenda_events;
create trigger nfc_event_stamp before insert or update
on public.nfc_agenda_events for each row execute function nfc_private.stamp_change();

drop trigger if exists nfc_client_stamp on public.nfc_agenda_clients;
create trigger nfc_client_stamp before insert or update
on public.nfc_agenda_clients for each row execute function nfc_private.stamp_change();

create index if not exists nfc_events_by_date
on public.nfc_agenda_events(team_id, ((payload->>'data')));

-- Every table defaults to no public access. Only explicitly invited members can read/write private data.
alter table public.nfc_teams enable row level security;
alter table public.nfc_team_members enable row level security;
alter table public.nfc_agenda_events enable row level security;
alter table public.nfc_agenda_clients enable row level security;

revoke all on public.nfc_teams, public.nfc_team_members,
  public.nfc_agenda_events, public.nfc_agenda_clients from anon;
grant select on public.nfc_teams, public.nfc_team_members to authenticated;
grant select,insert,update,delete on public.nfc_agenda_events, public.nfc_agenda_clients to authenticated;

drop policy if exists nfc_team_read on public.nfc_teams;
create policy nfc_team_read on public.nfc_teams for select to authenticated
using (nfc_private.is_member(id));

drop policy if exists nfc_member_read on public.nfc_team_members;
create policy nfc_member_read on public.nfc_team_members for select to authenticated
using (user_id = (select auth.uid()) or nfc_private.is_owner(team_id));

drop policy if exists nfc_event_read on public.nfc_agenda_events;
create policy nfc_event_read on public.nfc_agenda_events for select to authenticated
using (nfc_private.is_member(team_id));
drop policy if exists nfc_event_insert on public.nfc_agenda_events;
create policy nfc_event_insert on public.nfc_agenda_events for insert to authenticated
with check (nfc_private.is_member(team_id));
drop policy if exists nfc_event_update on public.nfc_agenda_events;
create policy nfc_event_update on public.nfc_agenda_events for update to authenticated
using (nfc_private.is_member(team_id)) with check (nfc_private.is_member(team_id));
drop policy if exists nfc_event_delete on public.nfc_agenda_events;
create policy nfc_event_delete on public.nfc_agenda_events for delete to authenticated
using (nfc_private.is_member(team_id));

drop policy if exists nfc_client_read on public.nfc_agenda_clients;
create policy nfc_client_read on public.nfc_agenda_clients for select to authenticated
using (nfc_private.is_member(team_id));
drop policy if exists nfc_client_insert on public.nfc_agenda_clients;
create policy nfc_client_insert on public.nfc_agenda_clients for insert to authenticated
with check (nfc_private.is_member(team_id));
drop policy if exists nfc_client_update on public.nfc_agenda_clients;
create policy nfc_client_update on public.nfc_agenda_clients for update to authenticated
using (nfc_private.is_member(team_id)) with check (nfc_private.is_member(team_id));
drop policy if exists nfc_client_delete on public.nfc_agenda_clients;
create policy nfc_client_delete on public.nfc_agenda_clients for delete to authenticated
using (nfc_private.is_member(team_id));

-- Enable Realtime only after reviewing security settings, project limits and publication membership.
-- alter publication supabase_realtime add table public.nfc_agenda_events;
-- alter publication supabase_realtime add table public.nfc_agenda_clients;

commit;

-- MANUAL INITIALIZATION (run in SQL editor only after the owner registers with Auth):
-- 1. Insert a team (save returned id).
-- insert into public.nfc_teams(name) values ('Next Finish Carpentry') returning id;
-- 2. Assign an owner user from auth.users with a known, verified UUID.
-- insert into public.nfc_team_members(team_id,user_id,role) values ('<TEAM_ID>','<AUTH_USER_UUID>','owner');
-- 3. Add invited, verified staff by user UUID as role 'member' using the SQL editor.
-- Never store personal emails, passwords, user UUIDs or service_role keys in GitHub.
