-- =============================================================================
-- Migration: 20260323000001_cucumber_supabase_foundation_v1.sql
-- =============================================================================

-- Cucumber Studio Supabase Foundation V1
-- Target hosted project ref: ndbwtngvypwgqexcirdo
--
-- Checklist:
-- - public.profiles
-- - public.workspaces
-- - public.workspace_members
-- - public.projects
-- - public.canvases
-- - public.asset_objects
-- - first-login bootstrap helper functions + auth.users trigger
-- - workspace-membership-based RLS policies
-- - storage buckets: project-assets, user-avatars
-- - storage.objects policies scoped by workspace membership or user ownership

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'workspace_type'
  ) then
    create type public.workspace_type as enum ('personal', 'team');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'workspace_member_role'
  ) then
    create type public.workspace_member_role as enum ('owner', 'admin', 'member');
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function private.try_parse_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  type public.workspace_type not null,
  name text not null check (char_length(btrim(name)) > 0),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_member_role not null default 'member',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  slug text not null check (char_length(btrim(slug)) > 0),
  description text,
  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint projects_workspace_slug_key unique (workspace_id, slug),
  constraint projects_id_workspace_id_key unique (id, workspace_id)
);

create table if not exists public.canvases (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  is_primary boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.asset_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid,
  bucket text not null check (bucket in ('project-assets', 'user-avatars')),
  object_path text not null check (char_length(btrim(object_path)) > 0),
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint asset_objects_bucket_object_path_key unique (bucket, object_path),
  constraint asset_objects_project_workspace_fkey
    foreign key (project_id, workspace_id)
    references public.projects (id, workspace_id)
    on delete cascade
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists workspaces_owner_user_id_idx on public.workspaces (owner_user_id);
create unique index if not exists workspaces_personal_owner_user_id_key
  on public.workspaces (owner_user_id)
  where type = 'personal';
create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);
create index if not exists projects_workspace_id_idx on public.projects (workspace_id);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists canvases_project_id_idx on public.canvases (project_id);
create unique index if not exists canvases_one_primary_per_project_key
  on public.canvases (project_id)
  where is_primary;
create index if not exists asset_objects_workspace_id_idx on public.asset_objects (workspace_id);
create index if not exists asset_objects_project_id_idx on public.asset_objects (project_id);
create index if not exists asset_objects_created_by_idx on public.asset_objects (created_by);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row
execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

drop trigger if exists canvases_set_updated_at on public.canvases;
create trigger canvases_set_updated_at
before update on public.canvases
for each row
execute function public.set_updated_at();

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = (select auth.uid())
    );
$$;

create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspaces w
      where w.id = p_workspace_id
        and w.owner_user_id = (select auth.uid())
    );
$$;

create or replace function private.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects p
      join public.workspace_members wm
        on wm.workspace_id = p.workspace_id
      where p.id = p_project_id
        and wm.user_id = (select auth.uid())
    );
$$;

create or replace function private.asset_object_project_matches_workspace(
  p_project_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_project_id is null
    or exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.workspace_id = p_workspace_id
    );
$$;

create or replace function private.bootstrap_user_foundation(
  p_user_id uuid,
  p_email text,
  p_user_meta jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_display_name text;
  v_workspace_name text;
begin
  v_display_name := nullif(
    btrim(
      coalesce(
        p_user_meta ->> 'display_name',
        p_user_meta ->> 'full_name',
        p_user_meta ->> 'name',
        split_part(coalesce(p_email, ''), '@', 1)
      )
    ),
    ''
  );

  insert into public.profiles as p (id, email, display_name, avatar_url)
  values (
    p_user_id,
    p_email,
    v_display_name,
    nullif(btrim(coalesce(p_user_meta ->> 'avatar_url', '')), '')
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, p.email),
        display_name = coalesce(p.display_name, excluded.display_name),
        avatar_url = coalesce(p.avatar_url, excluded.avatar_url),
        updated_at = timezone('utc', now());

  select w.id
  into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = p_user_id
    and w.type = 'personal'
  order by w.created_at
  limit 1;

  if v_workspace_id is null then
    v_workspace_name := coalesce(v_display_name, 'Personal') || ' Workspace';

    insert into public.workspaces (type, name, owner_user_id)
    values ('personal', v_workspace_name, p_user_id)
    returning id into v_workspace_id;
  end if;

  insert into public.workspace_members as wm (workspace_id, user_id, role)
  values (v_workspace_id, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do update
    set role = 'owner';

  return v_workspace_id;
end;
$$;

revoke all on function private.bootstrap_user_foundation(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_user_foundation(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );

  return new;
exception
  when others then
    raise warning 'handle_new_user bootstrap failed for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.canvases enable row level security;
alter table public.asset_objects enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()))
with check ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces
for select
to authenticated
using ((select private.is_workspace_member(id)));

drop policy if exists "workspaces_insert_owner" on public.workspaces;
create policy "workspaces_insert_owner"
on public.workspaces
for insert
to authenticated
with check ((select auth.uid()) is not null and owner_user_id = (select auth.uid()));

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner"
on public.workspaces
for update
to authenticated
using ((select auth.uid()) is not null and owner_user_id = (select auth.uid()))
with check ((select auth.uid()) is not null and owner_user_id = (select auth.uid()));

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
on public.workspaces
for delete
to authenticated
using ((select auth.uid()) is not null and owner_user_id = (select auth.uid()));

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
on public.workspace_members
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists "workspace_members_insert_owner" on public.workspace_members;
create policy "workspace_members_insert_owner"
on public.workspace_members
for insert
to authenticated
with check ((select private.is_workspace_owner(workspace_id)));

drop policy if exists "workspace_members_update_owner" on public.workspace_members;
create policy "workspace_members_update_owner"
on public.workspace_members
for update
to authenticated
using ((select private.is_workspace_owner(workspace_id)))
with check ((select private.is_workspace_owner(workspace_id)));

drop policy if exists "workspace_members_delete_owner" on public.workspace_members;
create policy "workspace_members_delete_owner"
on public.workspace_members
for delete
to authenticated
using ((select private.is_workspace_owner(workspace_id)));

drop policy if exists "projects_select_member" on public.projects;
create policy "projects_select_member"
on public.projects
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists "projects_insert_member" on public.projects;
create policy "projects_insert_member"
on public.projects
for insert
to authenticated
with check (
  (select private.is_workspace_member(workspace_id))
  and (created_by is null or created_by = (select auth.uid()))
);

drop policy if exists "projects_update_member" on public.projects;
create policy "projects_update_member"
on public.projects
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

drop policy if exists "projects_delete_member" on public.projects;
create policy "projects_delete_member"
on public.projects
for delete
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists "canvases_select_member" on public.canvases;
create policy "canvases_select_member"
on public.canvases
for select
to authenticated
using ((select private.is_project_member(project_id)));

drop policy if exists "canvases_insert_member" on public.canvases;
create policy "canvases_insert_member"
on public.canvases
for insert
to authenticated
with check (
  (select private.is_project_member(project_id))
  and (created_by is null or created_by = (select auth.uid()))
);

drop policy if exists "canvases_update_member" on public.canvases;
create policy "canvases_update_member"
on public.canvases
for update
to authenticated
using ((select private.is_project_member(project_id)))
with check ((select private.is_project_member(project_id)));

drop policy if exists "canvases_delete_member" on public.canvases;
create policy "canvases_delete_member"
on public.canvases
for delete
to authenticated
using ((select private.is_project_member(project_id)));

drop policy if exists "asset_objects_select_member" on public.asset_objects;
create policy "asset_objects_select_member"
on public.asset_objects
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

drop policy if exists "asset_objects_insert_member" on public.asset_objects;
create policy "asset_objects_insert_member"
on public.asset_objects
for insert
to authenticated
with check (
  (select private.is_workspace_member(workspace_id))
  and (created_by is null or created_by = (select auth.uid()))
  and (select private.asset_object_project_matches_workspace(project_id, workspace_id))
);

drop policy if exists "asset_objects_update_member" on public.asset_objects;
create policy "asset_objects_update_member"
on public.asset_objects
for update
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check (
  (select private.is_workspace_member(workspace_id))
  and (select private.asset_object_project_matches_workspace(project_id, workspace_id))
);

drop policy if exists "asset_objects_delete_member" on public.asset_objects;
create policy "asset_objects_delete_member"
on public.asset_objects
for delete
to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on function private.try_parse_uuid(text) from public, anon, authenticated;
revoke all on function private.is_workspace_member(uuid) from public, anon, authenticated;
revoke all on function private.is_workspace_owner(uuid) from public, anon, authenticated;
revoke all on function private.is_project_member(uuid) from public, anon, authenticated;
revoke all on function private.asset_object_project_matches_workspace(uuid, uuid) from public, anon, authenticated;

grant execute on function private.try_parse_uuid(text) to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
grant execute on function private.is_project_member(uuid) to authenticated;
grant execute on function private.asset_object_project_matches_workspace(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public)
values
  ('project-assets', 'project-assets', true),
  ('user-avatars', 'user-avatars', false)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;

drop policy if exists "project_assets_select_member" on storage.objects;
create policy "project_assets_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-assets'
  and (select private.is_workspace_member(private.try_parse_uuid((storage.foldername(name))[1])))
);

drop policy if exists "project_assets_insert_member" on storage.objects;
create policy "project_assets_insert_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-assets'
  and (select private.is_workspace_member(private.try_parse_uuid((storage.foldername(name))[1])))
);

drop policy if exists "project_assets_update_member" on storage.objects;
create policy "project_assets_update_member"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'project-assets'
  and (select private.is_workspace_member(private.try_parse_uuid((storage.foldername(name))[1])))
)
with check (
  bucket_id = 'project-assets'
  and (select private.is_workspace_member(private.try_parse_uuid((storage.foldername(name))[1])))
);

drop policy if exists "project_assets_delete_member" on storage.objects;
create policy "project_assets_delete_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-assets'
  and (select private.is_workspace_member(private.try_parse_uuid((storage.foldername(name))[1])))
);

drop policy if exists "user_avatars_select_owner" on storage.objects;
create policy "user_avatars_select_owner"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-avatars'
  and private.try_parse_uuid((storage.foldername(name))[1]) = (select auth.uid())
);

drop policy if exists "user_avatars_insert_owner" on storage.objects;
create policy "user_avatars_insert_owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user-avatars'
  and private.try_parse_uuid((storage.foldername(name))[1]) = (select auth.uid())
);

drop policy if exists "user_avatars_update_owner" on storage.objects;
create policy "user_avatars_update_owner"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user-avatars'
  and private.try_parse_uuid((storage.foldername(name))[1]) = (select auth.uid())
)
with check (
  bucket_id = 'user-avatars'
  and private.try_parse_uuid((storage.foldername(name))[1]) = (select auth.uid())
);

drop policy if exists "user_avatars_delete_owner" on storage.objects;
create policy "user_avatars_delete_owner"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user-avatars'
  and private.try_parse_uuid((storage.foldername(name))[1]) = (select auth.uid())
);

do $$
declare
  v_user record;
begin
  for v_user in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
  loop
    begin
      perform private.bootstrap_user_foundation(
        v_user.id,
        v_user.email,
        coalesce(v_user.raw_user_meta_data, '{}'::jsonb)
      );
    exception
      when others then
        raise warning 'bootstrap backfill failed for user %: %', v_user.id, sqlerrm;
    end;
  end loop;
end
$$;


-- =============================================================================
-- Migration: 20260323000002_cucumber_supabase_foundation_hardening.sql
-- =============================================================================

-- Cucumber Studio Supabase Foundation Hardening
-- Follow-up migration for production safety fixes without rewriting applied history.

create or replace function private.is_workspace_admin_or_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.workspaces w
        where w.id = p_workspace_id
          and w.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.workspace_members wm
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
          and wm.role in ('owner', 'admin')
      )
    );
$$;

create or replace function private.is_project_admin_or_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and private.is_workspace_admin_or_owner(p.workspace_id)
    );
$$;

create or replace function private.prevent_profile_email_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email is distinct from old.email
     and current_user = 'authenticated' then
    raise exception 'profiles.email is managed by auth.users'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.bootstrap_user_foundation(
  p_user_id uuid,
  p_email text,
  p_user_meta jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_display_name text;
  v_workspace_name text;
begin
  v_display_name := nullif(
    btrim(
      coalesce(
        p_user_meta ->> 'display_name',
        p_user_meta ->> 'full_name',
        p_user_meta ->> 'name',
        split_part(coalesce(p_email, ''), '@', 1)
      )
    ),
    ''
  );

  insert into public.profiles as p (id, email, display_name, avatar_url)
  values (
    p_user_id,
    p_email,
    v_display_name,
    nullif(btrim(coalesce(p_user_meta ->> 'avatar_url', '')), '')
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, p.email),
        display_name = coalesce(p.display_name, excluded.display_name),
        avatar_url = coalesce(p.avatar_url, excluded.avatar_url),
        updated_at = timezone('utc', now());

  select w.id
  into v_workspace_id
  from public.workspaces w
  where w.owner_user_id = p_user_id
    and w.type = 'personal'
  order by w.created_at
  limit 1;

  if v_workspace_id is null then
    v_workspace_name := coalesce(v_display_name, 'Personal') || ' Workspace';

    begin
      insert into public.workspaces (type, name, owner_user_id)
      values ('personal', v_workspace_name, p_user_id)
      returning id into v_workspace_id;
    exception
      when unique_violation then
        select w.id
        into v_workspace_id
        from public.workspaces w
        where w.owner_user_id = p_user_id
          and w.type = 'personal'
        order by w.created_at
        limit 1;
    end;
  end if;

  if v_workspace_id is null then
    raise exception 'bootstrap_user_foundation could not resolve personal workspace for user %', p_user_id;
  end if;

  insert into public.workspace_members as wm (workspace_id, user_id, role)
  values (v_workspace_id, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do update
    set role = 'owner';

  return v_workspace_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bootstrap_user_foundation(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );

  return new;
end;
$$;

drop trigger if exists profiles_prevent_email_change on public.profiles;
create trigger profiles_prevent_email_change
before update on public.profiles
for each row
execute function private.prevent_profile_email_change();

drop policy if exists "projects_insert_member" on public.projects;
drop policy if exists "projects_insert_admin" on public.projects;
create policy "projects_insert_admin"
on public.projects
for insert
to authenticated
with check (
  (select private.is_workspace_admin_or_owner(workspace_id))
  and (created_by is null or created_by = (select auth.uid()))
);

drop policy if exists "projects_update_member" on public.projects;
drop policy if exists "projects_update_admin" on public.projects;
create policy "projects_update_admin"
on public.projects
for update
to authenticated
using ((select private.is_workspace_admin_or_owner(workspace_id)))
with check ((select private.is_workspace_admin_or_owner(workspace_id)));

drop policy if exists "projects_delete_member" on public.projects;
drop policy if exists "projects_delete_admin" on public.projects;
create policy "projects_delete_admin"
on public.projects
for delete
to authenticated
using ((select private.is_workspace_admin_or_owner(workspace_id)));

drop policy if exists "canvases_insert_member" on public.canvases;
drop policy if exists "canvases_insert_admin" on public.canvases;
create policy "canvases_insert_admin"
on public.canvases
for insert
to authenticated
with check (
  (select private.is_project_admin_or_owner(project_id))
  and (created_by is null or created_by = (select auth.uid()))
);

drop policy if exists "canvases_update_member" on public.canvases;
drop policy if exists "canvases_update_admin" on public.canvases;
create policy "canvases_update_admin"
on public.canvases
for update
to authenticated
using ((select private.is_project_admin_or_owner(project_id)))
with check ((select private.is_project_admin_or_owner(project_id)));

drop policy if exists "canvases_delete_member" on public.canvases;
drop policy if exists "canvases_delete_admin" on public.canvases;
create policy "canvases_delete_admin"
on public.canvases
for delete
to authenticated
using ((select private.is_project_admin_or_owner(project_id)));

drop policy if exists "asset_objects_insert_member" on public.asset_objects;
drop policy if exists "asset_objects_insert_admin" on public.asset_objects;
create policy "asset_objects_insert_admin"
on public.asset_objects
for insert
to authenticated
with check (
  (select private.is_workspace_admin_or_owner(workspace_id))
  and (created_by is null or created_by = (select auth.uid()))
  and (select private.asset_object_project_matches_workspace(project_id, workspace_id))
);

drop policy if exists "asset_objects_update_member" on public.asset_objects;
drop policy if exists "asset_objects_update_admin" on public.asset_objects;
create policy "asset_objects_update_admin"
on public.asset_objects
for update
to authenticated
using ((select private.is_workspace_admin_or_owner(workspace_id)))
with check (
  (select private.is_workspace_admin_or_owner(workspace_id))
  and (select private.asset_object_project_matches_workspace(project_id, workspace_id))
);

drop policy if exists "asset_objects_delete_member" on public.asset_objects;
drop policy if exists "asset_objects_delete_admin" on public.asset_objects;
create policy "asset_objects_delete_admin"
on public.asset_objects
for delete
to authenticated
using ((select private.is_workspace_admin_or_owner(workspace_id)));

drop policy if exists "project_assets_insert_member" on storage.objects;
drop policy if exists "project_assets_insert_admin" on storage.objects;
create policy "project_assets_insert_admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-assets'
  and (
    select private.is_workspace_admin_or_owner(
      private.try_parse_uuid((storage.foldername(name))[1])
    )
  )
);

drop policy if exists "project_assets_update_member" on storage.objects;
drop policy if exists "project_assets_update_admin" on storage.objects;
create policy "project_assets_update_admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'project-assets'
  and (
    select private.is_workspace_admin_or_owner(
      private.try_parse_uuid((storage.foldername(name))[1])
    )
  )
)
with check (
  bucket_id = 'project-assets'
  and (
    select private.is_workspace_admin_or_owner(
      private.try_parse_uuid((storage.foldername(name))[1])
    )
  )
);

drop policy if exists "project_assets_delete_member" on storage.objects;
drop policy if exists "project_assets_delete_admin" on storage.objects;
create policy "project_assets_delete_admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-assets'
  and (
    select private.is_workspace_admin_or_owner(
      private.try_parse_uuid((storage.foldername(name))[1])
    )
  )
);

revoke all on function private.is_workspace_admin_or_owner(uuid) from public, anon, authenticated;
revoke all on function private.is_project_admin_or_owner(uuid) from public, anon, authenticated;
revoke all on function private.prevent_profile_email_change() from public, anon, authenticated;
revoke all on function private.bootstrap_user_foundation(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function private.is_workspace_admin_or_owner(uuid) to authenticated;
grant execute on function private.is_project_admin_or_owner(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('project-assets', 'project-assets', true, 52428800, null),
  (
    'user-avatars',
    'user-avatars',
    false,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
  )
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


-- =============================================================================
-- Migration: 20260323000003_atomic_rpc_functions.sql
-- =============================================================================

-- Migration: 20260323_000003_atomic_rpc_functions
-- Adds two public RPC functions:
--   1. public.bootstrap_viewer       — thin wrapper over private.bootstrap_user_foundation
--   2. public.create_project_with_canvas — atomic project + primary canvas creation

-- ------------------------------------------------------------
-- 1. public.bootstrap_viewer
--    Called by the admin/service client to initialise a new user.
--    Only service_role may execute this; no grant to authenticated.
-- ------------------------------------------------------------

create or replace function public.bootstrap_viewer(
  p_user_id uuid,
  p_email text,
  p_user_meta jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.bootstrap_user_foundation(p_user_id, p_email, p_user_meta);
end;
$$;

revoke all on function public.bootstrap_viewer(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.bootstrap_viewer(uuid, text, jsonb)
  to service_role;

-- ------------------------------------------------------------
-- 2. public.create_project_with_canvas
--    Atomically inserts a project row and its primary canvas row.
--    Both INSERTs occur in the same implicit PG transaction; if
--    either fails, both roll back.
--    Requires the caller to be an admin or owner of the workspace
--    (uses private.is_workspace_admin_or_owner, matching the
--    hardened RLS policy introduced in migration 000002).
-- ------------------------------------------------------------

create or replace function public.create_project_with_canvas(
  p_workspace_id uuid,
  p_name text,
  p_slug text,
  p_description text default null,
  p_canvas_name text default 'Main Canvas'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_project_id uuid;
  v_canvas_id uuid;
  v_project record;
  v_canvas record;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'Not authenticated'
      using errcode = '42501';
  end if;

  if not private.is_workspace_admin_or_owner(p_workspace_id) then
    raise exception 'Not an admin or owner of this workspace'
      using errcode = '42501';
  end if;

  insert into public.projects (workspace_id, name, slug, description, created_by)
  values (p_workspace_id, p_name, p_slug, p_description, v_user_id)
  returning id into v_project_id;

  insert into public.canvases (project_id, name, is_primary, created_by)
  values (v_project_id, p_canvas_name, true, v_user_id)
  returning id into v_canvas_id;

  select id, name, slug, description, created_at, updated_at, workspace_id
  into v_project
  from public.projects
  where id = v_project_id;

  select id, name, is_primary
  into v_canvas
  from public.canvases
  where id = v_canvas_id;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', v_project.id,
      'name', v_project.name,
      'slug', v_project.slug,
      'description', v_project.description,
      'created_at', v_project.created_at,
      'updated_at', v_project.updated_at,
      'workspace_id', v_project.workspace_id
    ),
    'canvas', jsonb_build_object(
      'id', v_canvas.id,
      'name', v_canvas.name,
      'is_primary', v_canvas.is_primary
    )
  );
end;
$$;

revoke all on function public.create_project_with_canvas(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.create_project_with_canvas(uuid, text, text, text, text)
  to authenticated;


-- =============================================================================
-- Migration: 20260323000004_canvas_content.sql
-- =============================================================================

-- Add content column to canvases for Excalidraw state persistence
ALTER TABLE public.canvases
  ADD COLUMN IF NOT EXISTS content jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.canvases.content IS
  'Excalidraw canvas state: { elements: [], appState: {} }';


-- =============================================================================
-- Migration: 20260323000005_workspace_settings.sql
-- =============================================================================

-- Workspace-level settings (agent model, preferences)
CREATE TABLE public.workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  default_model text NOT NULL DEFAULT 'gpt-5.4-mini',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.workspace_settings IS 'Per-workspace configuration for agent defaults.';
COMMENT ON COLUMN public.workspace_settings.default_model IS 'Default LLM model identifier for agent runs.';

-- Ensure moddatetime extension is available
CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

-- updated_at trigger
CREATE TRIGGER workspace_settings_updated_at
  BEFORE UPDATE ON public.workspace_settings
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- RLS
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;

-- Members can read their workspace settings
CREATE POLICY workspace_settings_select ON public.workspace_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_settings.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Owner or admin can insert settings
CREATE POLICY workspace_settings_insert ON public.workspace_settings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_settings.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- Owner or admin can update settings
CREATE POLICY workspace_settings_update ON public.workspace_settings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_settings.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );


-- =============================================================================
-- Migration: 20260323000006_chat_sessions.sql
-- =============================================================================

-- Chat sessions and messages for conversation persistence
CREATE TABLE public.chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id   uuid NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'New Chat',
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chat_sessions IS 'Chat conversation sessions linked to canvases.';

CREATE INDEX chat_sessions_canvas_id_idx ON public.chat_sessions(canvas_id);

CREATE TRIGGER chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE TABLE public.chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL DEFAULT '',
  tool_activities jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chat_messages IS 'Individual chat messages within a session.';

CREATE INDEX chat_messages_session_id_idx ON public.chat_messages(session_id);

-- RLS for chat_sessions
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- Members of the workspace that owns the canvas can access sessions
CREATE POLICY chat_sessions_select ON public.chat_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.canvases c
      JOIN public.projects p ON p.id = c.project_id
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE c.id = chat_sessions.canvas_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY chat_sessions_insert ON public.chat_sessions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.canvases c
      JOIN public.projects p ON p.id = c.project_id
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE c.id = chat_sessions.canvas_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY chat_sessions_delete ON public.chat_sessions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.canvases c
      JOIN public.projects p ON p.id = c.project_id
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE c.id = chat_sessions.canvas_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY chat_sessions_update ON public.chat_sessions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.canvases c
      JOIN public.projects p ON p.id = c.project_id
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE c.id = chat_sessions.canvas_id
        AND wm.user_id = auth.uid()
    )
  );

-- RLS for chat_messages
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      JOIN public.canvases c ON c.id = cs.canvas_id
      JOIN public.projects p ON p.id = c.project_id
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE cs.id = chat_messages.session_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      JOIN public.canvases c ON c.id = cs.canvas_id
      JOIN public.projects p ON p.id = c.project_id
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE cs.id = chat_messages.session_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY chat_messages_delete ON public.chat_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      JOIN public.canvases c ON c.id = cs.canvas_id
      JOIN public.projects p ON p.id = c.project_id
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE cs.id = chat_messages.session_id
        AND wm.user_id = auth.uid()
    )
  );


-- =============================================================================
-- Migration: 20260324000007_agent_thread_persistence.sql
-- =============================================================================

-- Agent thread persistence infrastructure for LangGraph-backed sessions.
-- Legacy chat sessions may remain without a thread_id; new sessions must set it at the application layer.
-- Official LangGraph Postgres persistence uses a separate server-owned schema.

ALTER TABLE public.chat_sessions
  ADD COLUMN thread_id text;

COMMENT ON COLUMN public.chat_sessions.thread_id IS
  'Server-owned LangGraph thread identifier for new chat sessions.';

CREATE UNIQUE INDEX chat_sessions_thread_id_non_null_idx
  ON public.chat_sessions(thread_id)
  WHERE thread_id IS NOT NULL;

CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'running', 'completed', 'failed')),
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  error_message text
);

COMMENT ON TABLE public.agent_runs IS
  'Server-only run bookkeeping for LangGraph thread execution.';

CREATE INDEX agent_runs_session_id_created_at_idx
  ON public.agent_runs(session_id, created_at DESC);

CREATE INDEX agent_runs_thread_id_created_at_idx
  ON public.agent_runs(thread_id, created_at DESC);

CREATE SCHEMA IF NOT EXISTS langgraph;

CREATE TABLE langgraph.checkpoint_migrations (
  v integer PRIMARY KEY
);

CREATE TABLE langgraph.checkpoints (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  type text,
  checkpoint jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE langgraph.checkpoint_blobs (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  channel text NOT NULL,
  version text NOT NULL,
  type text NOT NULL,
  blob bytea,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE langgraph.checkpoint_writes (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  idx integer NOT NULL,
  channel text NOT NULL,
  type text,
  blob bytea NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE INDEX checkpoint_writes_lookup_idx
  ON langgraph.checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id);

CREATE TABLE langgraph.store_migrations (
  v integer PRIMARY KEY
);

CREATE TABLE langgraph.store (
  namespace_path text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz,
  PRIMARY KEY (namespace_path, key)
);

CREATE INDEX idx_store_namespace_path
  ON langgraph.store USING btree (namespace_path);

CREATE INDEX idx_store_value_gin
  ON langgraph.store USING gin (value);

CREATE INDEX idx_store_expires_at
  ON langgraph.store USING btree (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION langgraph.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language plpgsql;

CREATE TRIGGER update_store_updated_at
  BEFORE UPDATE ON langgraph.store
  FOR EACH ROW
  EXECUTE FUNCTION langgraph.update_updated_at_column();

COMMENT ON SCHEMA langgraph IS
  'Server-only LangGraph checkpoint and store persistence schema.';

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE langgraph.checkpoint_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE langgraph.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE langgraph.checkpoint_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE langgraph.checkpoint_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE langgraph.store_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE langgraph.store ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- Migration: 20260324185500_add_content_blocks.sql
-- =============================================================================

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS content_blocks jsonb;


-- =============================================================================
-- Migration: 20260324200000_project_thumbnail.sql
-- =============================================================================

-- Add thumbnail storage path to projects table.
-- The path references an object in the project-assets Supabase Storage bucket.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

COMMENT ON COLUMN public.projects.thumbnail_path IS
  'Storage object path for the project canvas thumbnail (in project-assets bucket)';


-- =============================================================================
-- Migration: 20260325000001_create_brand_kits.sql
-- =============================================================================

-- Brand Kit feature: tables, enum, triggers, indexes, RLS
-- Depends on: foundation migration (set_updated_at function)

-- Asset type enum
CREATE TYPE public.brand_kit_asset_type AS ENUM ('color', 'font', 'logo', 'image');

-- brand_kits: Kit main table
CREATE TABLE public.brand_kits (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '未命名',
  is_default    BOOLEAN NOT NULL DEFAULT false,
  guidance_text TEXT,
  cover_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- brand_kit_assets: unified asset table
CREATE TABLE public.brand_kit_assets (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kit_id        UUID NOT NULL REFERENCES public.brand_kits(id) ON DELETE CASCADE,
  asset_type    public.brand_kit_asset_type NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  text_content  TEXT,
  file_url      TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- projects FK to brand_kits
ALTER TABLE public.projects ADD COLUMN brand_kit_id UUID REFERENCES public.brand_kits(id) ON DELETE SET NULL;

-- updated_at triggers (reuse existing set_updated_at from foundation migration)
CREATE TRIGGER brand_kits_updated_at
  BEFORE UPDATE ON public.brand_kits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER brand_kit_assets_updated_at
  BEFORE UPDATE ON public.brand_kit_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX idx_brand_kits_user ON public.brand_kits(user_id);
CREATE INDEX idx_brand_kit_assets_kit ON public.brand_kit_assets(kit_id);
CREATE INDEX idx_brand_kit_assets_type ON public.brand_kit_assets(kit_id, asset_type);

-- Unique partial index: at most one default kit per user
CREATE UNIQUE INDEX idx_brand_kits_default
  ON public.brand_kits(user_id) WHERE is_default = true;

-- RLS
ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_kit_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_kits_user_policy ON public.brand_kits
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY brand_kit_assets_policy ON public.brand_kit_assets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.brand_kits WHERE id = kit_id AND user_id = auth.uid())
  );


-- =============================================================================
-- Migration: 20260325100000_brand_kit_storage_bucket.sql
-- =============================================================================

-- Brand Kit file storage bucket + RLS policies.
-- Path pattern: {user_id}/{kit_id}/{timestamp}-{filename}
-- First folder = user_id, enforced by RLS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-kit-assets',
  'brand-kit-assets',
  false,
  10485760, -- 10 MB
  array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- INSERT: user can upload to their own folder
create policy "brand_kit_assets_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'brand-kit-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- SELECT: user can read their own files
create policy "brand_kit_assets_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'brand-kit-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE: user can update their own files
create policy "brand_kit_assets_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'brand-kit-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'brand-kit-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE: user can delete their own files
create policy "brand_kit_assets_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'brand-kit-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- =============================================================================
-- Migration: 20260325200000_background_jobs.sql
-- =============================================================================

-- Background Jobs: business state for async tasks.
-- pgmq handles message delivery; this table handles product-visible status.

-- Status enum
CREATE TYPE public.background_job_status AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'dead_letter'
);

-- Job type enum (extensible)
CREATE TYPE public.background_job_type AS ENUM (
  'image_generation'
);

-- Main table
CREATE TABLE public.background_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id),
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  canvas_id     uuid REFERENCES public.canvases(id) ON DELETE SET NULL,
  session_id    uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  thread_id     text,

  queue_name    text NOT NULL,
  job_type      public.background_job_type NOT NULL,
  status        public.background_job_status NOT NULL DEFAULT 'queued',

  payload       jsonb NOT NULL DEFAULT '{}',
  result        jsonb,
  error_code    text,
  error_message text,

  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,

  created_by    uuid NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  failed_at     timestamptz,
  canceled_at   timestamptz
);

-- Indexes
CREATE INDEX idx_background_jobs_status ON public.background_jobs(status);
CREATE INDEX idx_background_jobs_workspace ON public.background_jobs(workspace_id);
CREATE INDEX idx_background_jobs_created_by ON public.background_jobs(created_by);
CREATE INDEX idx_background_jobs_job_type_status ON public.background_jobs(job_type, status);

-- updated_at trigger
ALTER TABLE public.background_jobs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER trg_background_jobs_updated_at
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: users see their own jobs
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY background_jobs_user_policy
  ON public.background_jobs FOR ALL
  USING (auth.uid() = created_by);

-- Service role bypass for worker process
CREATE POLICY background_jobs_service_role
  ON public.background_jobs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Enable pgmq extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create pgmq queue (idempotent — pgmq.create skips if queue already exists)
SELECT pgmq.create('image_generation_jobs');


-- =============================================================================
-- Migration: 20260326000001_public_project_assets_bucket.sql
-- =============================================================================

-- Make project-assets bucket publicly accessible.
-- This enables permanent public URLs (no signed URL expiry),
-- which is required for multimodal AI chat and future sharing features.
UPDATE storage.buckets SET public = true WHERE id = 'project-assets';


-- =============================================================================
-- Migration: 20260327000001_canvas_screenshots_bucket.sql
-- =============================================================================

-- Create storage bucket for canvas screenshots used by the screenshot_canvas tool.
-- Screenshots are temporary artifacts for the AI agent to inspect the canvas visually.
-- Public read so the agent can access screenshot URLs directly.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'canvases',
  'canvases',
  true,
  5242880, -- 5MB
  array['image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Allow authenticated users to upload screenshots
drop policy if exists "canvases_insert_authenticated" on storage.objects;
create policy "canvases_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'canvases');

-- Allow public read access
drop policy if exists "canvases_select_public" on storage.objects;
create policy "canvases_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'canvases');


-- =============================================================================
-- Migration: 20260330100000_video_generation_jobs.sql
-- =============================================================================

-- Add video_generation to the background job type enum
ALTER TYPE public.background_job_type ADD VALUE IF NOT EXISTS 'video_generation';

-- Create PGMQ queue for video generation jobs
SELECT pgmq.create('video_generation_jobs');


-- =============================================================================
-- Migration: 20260330180000_code_execution_jobs.sql
-- =============================================================================

-- Add code_execution to the background job type enum
ALTER TYPE public.background_job_type ADD VALUE IF NOT EXISTS 'code_execution';

-- Create PGMQ queue for code execution jobs
SELECT pgmq.create('code_execution_jobs');


-- =============================================================================
-- Migration: 20260331000000_skills_management.sql
-- =============================================================================

-- Skills Management System
-- Adds skills registry and per-workspace skill installation

-- =============================================================================
-- 1. skills table (system-wide skill registry)
-- =============================================================================

CREATE TABLE public.skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,  -- URL-safe identifier, e.g., "canvas-design"
  description text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT 'system',
  version text NOT NULL DEFAULT '1.0',
  license text,
  category text NOT NULL DEFAULT 'custom'
    CHECK (category IN ('design', 'generation', 'code', 'data', 'writing', 'custom')),
  icon_name text,  -- lucide icon name, e.g., "palette", "sparkles"
  source text NOT NULL DEFAULT 'system'
    CHECK (source IN ('system', 'community', 'user')),
  skill_content text NOT NULL,  -- Full SKILL.md content
  metadata jsonb DEFAULT '{}'::jsonb,
  is_featured boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for listing/search
CREATE INDEX skills_category_idx ON public.skills (category);
CREATE INDEX skills_source_idx ON public.skills (source);
CREATE INDEX skills_created_by_idx ON public.skills (created_by);

-- =============================================================================
-- 2. workspace_skills table (per-workspace installation)
-- =============================================================================

CREATE TABLE public.workspace_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb DEFAULT '{}'::jsonb,
  installed_at timestamptz NOT NULL DEFAULT now(),
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  UNIQUE (workspace_id, skill_id)
);

CREATE INDEX workspace_skills_workspace_idx ON public.workspace_skills (workspace_id);

-- =============================================================================
-- 3. RLS Policies
-- =============================================================================

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_skills ENABLE ROW LEVEL SECURITY;

-- Skills: anyone authenticated can read system/community skills
CREATE POLICY skills_select_all ON public.skills
  FOR SELECT TO authenticated
  USING (source IN ('system', 'community') OR created_by = auth.uid());

-- Skills: users can create their own custom skills
CREATE POLICY skills_insert_user ON public.skills
  FOR INSERT TO authenticated
  WITH CHECK (source = 'user' AND created_by = auth.uid());

-- Skills: users can update/delete their own skills
CREATE POLICY skills_update_user ON public.skills
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY skills_delete_user ON public.skills
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- Service role full access
CREATE POLICY skills_service ON public.skills
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Workspace skills: workspace members can read
CREATE POLICY ws_skills_select ON public.workspace_skills
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id));

-- Workspace skills: workspace admin/owner can manage
CREATE POLICY ws_skills_insert ON public.workspace_skills
  FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_admin_or_owner(workspace_id));

CREATE POLICY ws_skills_update ON public.workspace_skills
  FOR UPDATE TO authenticated
  USING (private.is_workspace_admin_or_owner(workspace_id));

CREATE POLICY ws_skills_delete ON public.workspace_skills
  FOR DELETE TO authenticated
  USING (private.is_workspace_admin_or_owner(workspace_id));

CREATE POLICY ws_skills_service ON public.workspace_skills
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- 4. updated_at trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_skills_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skills_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.update_skills_updated_at();

-- =============================================================================
-- 5. Seed system skills
-- =============================================================================

-- Seed canvas-design skill
INSERT INTO public.skills (name, slug, description, author, version, license, category, icon_name, source, skill_content, is_featured, metadata)
VALUES (
  'Canvas Design',
  'canvas-design',
  'Create beautiful visual art as .png and .pdf files using design philosophy. Use when the user asks to create a poster, visual artwork, design piece, or static visual output via code generation.',
  'anthropic',
  '1.0',
  'Apache-2.0',
  'design',
  'palette',
  'system',
  '',  -- Content loaded from filesystem, this is just the registry entry
  true,
  '{"adapted-for": "cucumber", "requires": ["execute", "python"]}'::jsonb
);

-- Seed json-image-prompt skill
INSERT INTO public.skills (name, slug, description, author, version, license, category, icon_name, source, skill_content, is_featured, metadata)
VALUES (
  'JSON Image Prompt',
  'json-image-prompt',
  'Use structured JSON prompts for AI image generation instead of free-form text. Produces more consistent, controllable, and high-quality results.',
  'cucumber',
  '1.0',
  'Apache-2.0',
  'generation',
  'sparkles',
  'system',
  '',
  true,
  '{"requires": ["generate_image"]}'::jsonb
);


-- =============================================================================
-- Migration: 20260331140000_atomic_increment_job_attempt.sql
-- =============================================================================

-- Atomic increment of background_jobs.attempt_count.
-- Returns the new attempt_count and max_attempts in a single round-trip,
-- preventing race conditions when multiple workers pick up the same message.
CREATE OR REPLACE FUNCTION public.increment_job_attempt(p_job_id uuid)
RETURNS TABLE(attempt_count integer, max_attempts integer)
LANGUAGE sql
AS $$
  UPDATE background_jobs
  SET attempt_count = background_jobs.attempt_count + 1,
      updated_at = now()
  WHERE id = p_job_id
  RETURNING background_jobs.attempt_count, background_jobs.max_attempts;
$$;


-- =============================================================================
-- Migration: 20260403000001_fix_skills_toggle.sql
-- =============================================================================

-- Fix Skills Toggle: Populate system skills content and auto-install for workspaces
--
-- Problem: System skills had empty skill_content in DB and were not installed
-- in workspace_skills, making the toggle non-functional.

-- =============================================================================
-- 1. Populate skill_content for system skills
-- =============================================================================

UPDATE public.skills
SET skill_content = $skill_content$
---
name: canvas-design
description: Create beautiful visual art as .png and .pdf files using design philosophy. Use when the user asks to create a poster, visual artwork, design piece, or static visual output via code generation. Requires the execute tool and Python with Pillow/reportlab.
license: Apache-2.0
metadata:
  author: anthropic
  version: "1.0"
  adapted-for: cucumber
---

# Canvas Design Skill

These are instructions for creating visual artwork through code execution.
Output .md (philosophy) + .pdf or .png (artwork) files.

## Prerequisites

This skill requires:
- The `execute` tool (sandbox code execution)
- Python 3 with `Pillow` and `reportlab` installed
- Font files available at the path in `$FONT_DIR` environment variable

## Workflow

Complete in two steps:
1. Design Philosophy Creation (.md concept)
2. Express by creating it on a canvas via Python code execution (.pdf or .png)

## Step 1: Design Philosophy

Create a VISUAL PHILOSOPHY (not layouts or templates) that will be interpreted through:
- Form, space, color, composition
- Images, graphics, shapes, patterns
- Minimal text as visual accent

**Name the movement** (1-2 words): e.g., "Brutalist Joy" / "Chromatic Silence"

**Articulate the philosophy** (4-6 paragraphs) covering:
- Space and form
- Color and material
- Scale and rhythm
- Composition and balance
- Visual hierarchy

**Critical guidelines:**
- Avoid redundancy — each design aspect mentioned once
- Emphasize craftsmanship REPEATEDLY: "meticulously crafted", "master-level execution"
- Leave creative space for interpretation

## Step 2: Canvas Creation

Use the `execute` tool to run Python code that generates the artwork.

### IMPORTANT: Path Rules

**虚拟路径 vs 真实路径**：`ls` 和 `read_file` 工具使用虚拟路径（如 `/skills/...`），
但 `execute` 工具运行在真实 shell 中。Python 代码里**必须使用真实路径**。

规则：
1. **字体路径**：永远用 `os.environ["FONT_DIR"]`，不要硬编码
2. **输出文件**：永远用相对路径保存（如 `output.png`），文件会在沙箱工作目录中
3. **不要**把 `ls /skills/...` 看到的虚拟路径用在 Python 代码里

### Font Usage

字体通过 `$FONT_DIR` 环境变量访问（已在沙箱中预设）：

```python
import os
font_dir = os.environ["FONT_DIR"]  # 必须用环境变量，不要硬编码路径
fonts = [f for f in os.listdir(font_dir) if f.endswith(".ttf")]
```

Load fonts with Pillow:
```python
from PIL import ImageFont
font = ImageFont.truetype(os.path.join(font_dir, "WorkSans-Bold.ttf"), size=48)
```

Or with reportlab for PDF:
```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont("WorkSans", os.path.join(font_dir, "WorkSans-Bold.ttf")))
```

### Available Font Families

**Serif:** CrimsonPro (Regular/Bold/Italic), Gloock, IBMPlexSerif (Regular/Bold/Italic/BoldItalic), InstrumentSerif, Italiana, LibreBaskerville, Lora, YoungSerif

**Sans-serif:** ArsenalSC, BricolageGrotesque (Regular/Bold), InstrumentSans, Jura, Outfit, PoiretOne, SmoochSans, WorkSans

**Monospace:** DMMono, GeistMono (Regular/Bold), IBMPlexMono (Regular/Bold), JetBrainsMono, RedHatMono, Tektur

**Display:** BigShoulders (Regular/Bold), Boldonse, EricaOne, NationalPark, Silkscreen, PixelifySans

**Handwritten:** NothingYouCouldDo

### Design Principles

- Create museum/magazine-quality work — dense patterns, systematic shapes, clinical typography
- Use a limited color palette (3-5 colors) that feels intentional and cohesive
- Text is always minimal and visual-first — never paragraphs, only essential words
- Use DIFFERENT fonts for different roles (display, body, labels, accents)
- Nothing may overlap; all elements must stay within canvas boundaries with proper margins
- Never cartoony or amateur — even for playful subjects, maintain sophistication

### Code Execution Pattern

Write a complete Python script, then execute it.

**所有路径必须用相对路径**（多用户并发时绝对路径会冲突）：

```
1. write_file path="generate.py"       ← 相对路径，不要用 /tmp/xxx
2. execute: python3 generate.py
3. Output: img.save("output.png")      ← 相对路径
4. execute: pwd                        ← 获取当前工作目录的完整路径
5. persist_sandbox_file filePath="{pwd输出}/output.png"
```

**禁止使用绝对路径写文件**：
- ❌ `write_file path="/tmp/script.py"` — 多用户会覆盖
- ✅ `write_file path="script.py"` — 每个用户独立沙箱

**Critical**: In Python scripts:
- Use `os.environ["FONT_DIR"]` for font paths（唯一允许的绝对路径）
- Save output with RELATIVE paths (e.g., `img.save("poster.png")`)
- Do NOT use `/skills/...` paths — those are virtual backend paths, not real filesystem

### Refinement Pass

After generating the initial artwork, take a second pass:
- Re-examine the code for alignment, spacing, color calibration
- Refine rather than add — make existing composition more cohesive
- The user expects "museum quality" — every detail matters

## Step 3: Persist Output

After generating the artwork file, use the `persist_sandbox_file` tool to upload
it to persistent storage. This gives the user a downloadable URL.

## Important Notes

- Always write complete Python scripts — do not use placeholders
- Canvas size recommendation: 2400×3200 px for posters, 1920×1080 for landscapes
- Save output as PNG (for raster) or PDF (for print-quality)
- The subtle reference from the user's request should be woven into the art like a jazz musician quoting another song — perceptible to insiders but invisible to others
$skill_content$
WHERE slug = 'canvas-design';

UPDATE public.skills
SET skill_content = $skill_content$
---
name: json-image-prompt
description: Use structured JSON prompts for AI image generation instead of free-form text. Produces more consistent, controllable, and high-quality results. Activate when the user asks to generate, create, or design images, illustrations, photos, posters, or any visual content via the generate_image tool.
license: Apache-2.0
metadata:
  author: cucumber
  version: "1.0"
---

# JSON Image Prompt Skill

When generating images, always decompose the user's request into a structured JSON prompt before calling `generate_image`. JSON prompts eliminate ambiguity, improve consistency, and give the AI model clearer instructions.

## Why JSON Over Free-Form Text

| Free-form | JSON |
|-----------|------|
| "A beautiful sunset over mountains with dramatic lighting" | Each attribute is a separate, unambiguous key-value pair |
| Model guesses what "beautiful" and "dramatic" mean | You define exactly: golden hour, rim lighting, warm tones |
| Hard to iterate — rewrite everything | Change one field, keep the rest |
| Inconsistent results across runs | Same structure = reproducible quality |

## JSON Prompt Schema

Always structure the prompt as a JSON object with these fields:

```json
{
  "subject": {
    "type": "描述主体是什么（人物/物体/场景）",
    "details": "关键特征、姿态、表情、材质",
    "framing": "构图方式（全身/半身/特写/鸟瞰）"
  },
  "environment": {
    "setting": "场景描述",
    "time": "时间/时段",
    "weather": "天气/氛围条件"
  },
  "style": {
    "genre": "视觉风格（photorealistic/illustration/anime/oil-painting/3d-render/watercolor/flat-design）",
    "reference": "参考美学（如 Studio Ghibli / Swiss design / Brutalist / Art Deco）",
    "color_palette": "色彩倾向（warm/cool/monochrome/muted/vibrant + 具体色号如有）"
  },
  "lighting": {
    "type": "光源类型（natural/studio/neon/ambient/volumetric）",
    "direction": "光线方向（front/back/side/top/rim）",
    "quality": "光线质感（soft/harsh/diffused/dramatic/golden-hour）"
  },
  "camera": {
    "angle": "拍摄角度（eye-level/low-angle/high-angle/dutch-angle/overhead）",
    "lens": "镜头（wide-angle/telephoto/macro/fisheye/tilt-shift）",
    "depth_of_field": "景深（shallow/deep/selective）"
  },
  "mood": "情绪基调（1-3个关键词）",
  "negative": "需要避免的元素（可选）"
}
```

## 使用流程

### Step 1: 分析用户意图

用户说"帮我生成一张科技感的产品图"时，不要直接写一句话 prompt。先分解：
- 主体：产品（什么产品？什么角度？）
- 风格：科技感 → minimalist, clean, futuristic
- 灯光：科技感通常是 studio, rim lighting
- 情绪：professional, modern, premium

### Step 2: 构建 JSON Prompt

```json
{
  "subject": {
    "type": "wireless earbuds",
    "details": "matte black finish, floating in air, slight rotation showing both sides",
    "framing": "centered product shot"
  },
  "environment": {
    "setting": "pure dark gradient background",
    "time": "N/A (studio)",
    "weather": "N/A"
  },
  "style": {
    "genre": "photorealistic product photography",
    "reference": "Apple product page aesthetic",
    "color_palette": "dark with selective blue and white accents"
  },
  "lighting": {
    "type": "studio",
    "direction": "rim lighting from behind, subtle fill from front",
    "quality": "dramatic, high contrast"
  },
  "camera": {
    "angle": "eye-level, slightly elevated",
    "lens": "macro, 100mm equivalent",
    "depth_of_field": "shallow, product in sharp focus"
  },
  "mood": "premium, futuristic, minimal",
  "negative": "text, watermark, human hands, cluttered background"
}
```

### Step 3: 转换为 Prompt 字符串

将 JSON 扁平化为一段结构化的 prompt 文本传给 `generate_image`：

```
Product photography of wireless earbuds, matte black finish, floating in air with slight rotation showing both sides. Centered product shot. Pure dark gradient background. Photorealistic product photography, Apple product page aesthetic. Dark palette with selective blue and white accents. Studio rim lighting from behind with subtle fill from front, dramatic high contrast. Eye-level macro shot at 100mm, shallow depth of field with product in sharp focus. Premium, futuristic, minimal mood. --no text, watermark, human hands, cluttered background
```

**规则：JSON → prompt 转换时，按重要性排序：subject > style > lighting > camera > environment > mood > negative**

## 场景模板

### 人像摄影

```json
{
  "subject": {
    "type": "portrait of [person description]",
    "details": "[expression], [clothing], [pose]",
    "framing": "bust shot / headshot / full body"
  },
  "style": {
    "genre": "editorial photography",
    "color_palette": "warm skin tones, muted background"
  },
  "lighting": {
    "type": "natural",
    "direction": "side, Rembrandt lighting pattern",
    "quality": "soft, golden hour"
  },
  "camera": {
    "lens": "85mm portrait lens",
    "depth_of_field": "shallow, f/1.8"
  },
  "mood": "intimate, contemplative"
}
```

### 概念插画

```json
{
  "subject": {
    "type": "[concept or scene]",
    "details": "[key visual elements]",
    "framing": "wide establishing shot"
  },
  "style": {
    "genre": "digital illustration",
    "reference": "[art style reference]",
    "color_palette": "[specific palette or mood-based]"
  },
  "lighting": {
    "type": "volumetric / atmospheric",
    "quality": "cinematic"
  },
  "mood": "[2-3 emotion keywords]"
}
```

### 品牌/营销视觉

```json
{
  "subject": {
    "type": "[product or brand element]",
    "details": "[brand-specific details]",
    "framing": "hero shot"
  },
  "style": {
    "genre": "commercial photography / 3d-render",
    "reference": "[brand aesthetic]",
    "color_palette": "[brand colors]"
  },
  "lighting": {
    "type": "studio, three-point",
    "quality": "clean, professional"
  },
  "mood": "aspirational, on-brand"
}
```

## 重要原则

1. **每次生成图片前，先在内心构建 JSON 结构**，即使不输出给用户看
2. **Subject 永远最重要** — 如果描述不清楚主体，其他参数再好也没用
3. **少即是多** — 每个字段用精准的 2-5 个词，不要写散文
4. **negative 字段很关键** — 明确排除不想要的元素（文字、水印、变形等）
5. **迭代优化** — 如果第一次结果不理想，只调整 1-2 个字段重试，不要全部重写
6. **色彩要具体** — "warm tones" 不如 "golden amber (#D4A574) with deep burgundy (#722F37) accents"
7. **有品牌套件时** — 用 `get_brand_kit` 获取品牌色和字体，注入到 style.color_palette 和 subject.details
$skill_content$
WHERE slug = 'json-image-prompt';

-- =============================================================================
-- 2. Auto-install system skills for new workspaces
-- =============================================================================

CREATE OR REPLACE FUNCTION public.init_workspace_skills()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workspace_skills (workspace_id, skill_id, enabled)
  SELECT NEW.id, s.id, true
  FROM public.skills s
  WHERE s.source = 'system'
  ON CONFLICT (workspace_id, skill_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_init_workspace_skills
  AFTER INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.init_workspace_skills();

-- =============================================================================
-- 3. Backfill existing workspaces with system skills
-- =============================================================================

INSERT INTO public.workspace_skills (workspace_id, skill_id, enabled)
SELECT w.id, s.id, true
FROM public.workspaces w
CROSS JOIN public.skills s
WHERE s.source = 'system'
ON CONFLICT (workspace_id, skill_id) DO NOTHING;


-- =============================================================================
-- Migration: 20260403100000_skill_files.sql
-- =============================================================================

-- Skill Files: multi-file skill content storage (scripts/, references/, assets/)
-- Supports the skills.sh import pipeline and structured skill packages.

-- =============================================================================
-- 1. Extend skills table with import metadata
-- =============================================================================

ALTER TABLE public.skills
  ADD COLUMN IF NOT EXISTS source_url text,       -- original import URL (e.g., skills.sh link)
  ADD COLUMN IF NOT EXISTS package_name text;      -- npm package name from skills.sh registry

COMMENT ON COLUMN public.skills.source_url IS 'Original URL the skill was imported from';
COMMENT ON COLUMN public.skills.package_name IS 'npm-style package name from the skills.sh registry';

-- =============================================================================
-- 2. skill_files table
-- =============================================================================

CREATE TABLE public.skill_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  file_path text NOT NULL,                         -- relative path, e.g. "scripts/analyze.py"
  content text NOT NULL,                           -- raw file content
  mime_type text NOT NULL DEFAULT 'text/plain',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Each skill can only have one file at a given path
  UNIQUE (skill_id, file_path),

  -- Only allow files under known directories
  CHECK (file_path ~ '^(scripts|references|assets)/')
);

COMMENT ON TABLE public.skill_files IS 'Stores multi-file skill content (scripts, references, assets)';

-- Index for efficient lookup by parent skill
CREATE INDEX skill_files_skill_id_idx ON public.skill_files (skill_id);

-- =============================================================================
-- 3. RLS Policies
-- =============================================================================

ALTER TABLE public.skill_files ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users can read files for skills they can see
-- (system/community skills are public; user skills are visible only to owner)
CREATE POLICY skill_files_select ON public.skill_files
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.skills s
      WHERE s.id = skill_files.skill_id
        AND (s.source IN ('system', 'community') OR s.created_by = auth.uid())
    )
  );

-- INSERT: only for user-owned skills
CREATE POLICY skill_files_insert ON public.skill_files
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.skills s
      WHERE s.id = skill_files.skill_id
        AND s.source = 'user'
        AND s.created_by = auth.uid()
    )
  );

-- UPDATE: only for user-owned skills
CREATE POLICY skill_files_update ON public.skill_files
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.skills s
      WHERE s.id = skill_files.skill_id
        AND s.source = 'user'
        AND s.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.skills s
      WHERE s.id = skill_files.skill_id
        AND s.source = 'user'
        AND s.created_by = auth.uid()
    )
  );

-- DELETE: only for user-owned skills
CREATE POLICY skill_files_delete ON public.skill_files
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.skills s
      WHERE s.id = skill_files.skill_id
        AND s.source = 'user'
        AND s.created_by = auth.uid()
    )
  );

-- Service role: unrestricted access (used by server/workers for system skill imports)
CREATE POLICY skill_files_service ON public.skill_files
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- 4. updated_at trigger (reuse existing function)
-- =============================================================================

CREATE TRIGGER skill_files_updated_at
  BEFORE UPDATE ON public.skill_files
  FOR EACH ROW EXECUTE FUNCTION public.update_skills_updated_at();
