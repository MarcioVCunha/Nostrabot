-- Phase 2: audios metadata + admin key hash + storage policies + RPCs
-- Apply in Supabase SQL editor / CLI. Do NOT commit secrets.
-- After applying, insert the admin key hash (sha256 hex of the plaintext key):
--   insert into private.app_config (key, value)
--   values (
--     'admin_key_hash',
--     encode(digest(convert_to('SUA_CHAVE_AQUI', 'UTF8'), 'sha256'), 'hex')
--   )
--   on conflict (key) do update set value = excluded.value;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;

create table if not exists private.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.app_config from public, anon, authenticated;

create or replace function private.verify_admin_key(p_key text)
returns boolean
language sql
stable
security definer
set search_path = private, extensions, public
as $$
  select
    p_key is not null
    and length(trim(p_key)) > 0
    and exists (
      select 1
      from private.app_config c
      where c.key = 'admin_key_hash'
        and c.value = encode(digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    );
$$;

revoke all on function private.verify_admin_key(text) from public, anon, authenticated;
grant execute on function private.verify_admin_key(text) to postgres, service_role;

create table if not exists public.audios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  weight integer not null default 1 check (weight >= 1),
  storage_path text not null unique,
  content_type text not null default 'audio/webm',
  size_bytes bigint,
  upload_nonce text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  blob_url text
);

create index if not exists audios_active_created_idx
  on public.audios (created_at desc)
  where deleted_at is null;

create index if not exists audios_deleted_at_idx
  on public.audios (deleted_at)
  where deleted_at is not null;

do $$
begin
  create extension if not exists pg_trgm with schema extensions;
  create index if not exists audios_name_trgm_idx
    on public.audios using gin (name gin_trgm_ops);
exception
  when others then
    create index if not exists audios_name_lower_idx
      on public.audios (lower(name));
end $$;

alter table public.audios enable row level security;

drop policy if exists audios_select_active on public.audios;
create policy audios_select_active
  on public.audios
  for select
  to anon, authenticated
  using (deleted_at is null);

-- No direct insert/update/delete for anon; use SECURITY DEFINER RPCs.

create or replace function private.can_upload_storage_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.audios a
    where a.storage_path = p_name
      and a.upload_nonce is not null
      and a.deleted_at is null
      and a.created_at > now() - interval '2 hours'
  );
$$;

revoke all on function private.can_upload_storage_path(text) from public;
grant execute on function private.can_upload_storage_path(text) to anon, authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audios',
  'audios',
  true,
  26214400,
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/*']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists audios_storage_select on storage.objects;
create policy audios_storage_select
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'audios');

drop policy if exists audios_storage_insert on storage.objects;
create policy audios_storage_insert
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'audios'
    and private.can_upload_storage_path(name)
  );

drop policy if exists audios_storage_update on storage.objects;
create policy audios_storage_update
  on storage.objects
  for update
  to anon, authenticated
  using (
    bucket_id = 'audios'
    and private.can_upload_storage_path(name)
  )
  with check (
    bucket_id = 'audios'
    and private.can_upload_storage_path(name)
  );

create or replace function public.prepare_audio_upload(
  p_admin_key text,
  p_name text,
  p_description text default '',
  p_content_type text default 'audio/webm',
  p_weight integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_nonce text := encode(gen_random_bytes(16), 'hex');
  v_safe text;
  v_path text;
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_content_type is null or p_content_type not like 'audio/%' then
    raise exception 'only audio content types allowed';
  end if;

  v_safe := regexp_replace(coalesce(nullif(trim(p_name), ''), 'audio'), '[^a-zA-Z0-9._-]+', '_', 'g');
  v_path := v_id::text || '/' || v_safe;

  insert into public.audios (id, name, description, weight, storage_path, content_type, upload_nonce)
  values (
    v_id,
    left(trim(p_name), 200),
    left(coalesce(p_description, ''), 1000),
    greatest(1, coalesce(p_weight, 1)),
    v_path,
    p_content_type,
    v_nonce
  );

  return jsonb_build_object(
    'id', v_id,
    'storage_path', v_path,
    'upload_nonce', v_nonce,
    'content_type', p_content_type
  );
end;
$$;

create or replace function public.finalize_audio_upload(
  p_admin_key text,
  p_id uuid,
  p_size_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row public.audios;
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.audios
  set
    upload_nonce = null,
    size_bytes = coalesce(p_size_bytes, size_bytes)
  where id = p_id
    and deleted_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'audio not found';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'storage_path', v_row.storage_path,
    'size_bytes', v_row.size_bytes
  );
end;
$$;

create or replace function public.soft_delete_audio(p_admin_key text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.audios
  set deleted_at = now()
  where id = p_id
    and deleted_at is null;

  if not found then
    raise exception 'audio not found';
  end if;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.restore_audio(p_admin_key text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_deleted timestamptz;
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select deleted_at into v_deleted
  from public.audios
  where id = p_id;

  if v_deleted is null then
    raise exception 'audio not in trash or not found';
  end if;

  if v_deleted < now() - interval '30 days' then
    raise exception 'restore window expired (30 days)';
  end if;

  update public.audios
  set deleted_at = null
  where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.list_trashed_audios(p_admin_key text)
returns setof public.audios
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  return query
  select *
  from public.audios
  where deleted_at is not null
    and deleted_at > now() - interval '30 days'
  order by deleted_at desc;
end;
$$;

create or replace function public.update_audio_meta(
  p_admin_key text,
  p_id uuid,
  p_name text default null,
  p_description text default null,
  p_weight integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row public.audios;
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.audios
  set
    name = coalesce(nullif(trim(p_name), ''), name),
    description = coalesce(p_description, description),
    weight = coalesce(greatest(1, p_weight), weight)
  where id = p_id
    and deleted_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'audio not found';
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.set_audio_blob_url(
  p_admin_key text,
  p_id uuid,
  p_blob_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.audios
  set blob_url = p_blob_url
  where id = p_id;

  if not found then
    raise exception 'audio not found';
  end if;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.purge_expired_trash(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_count integer;
begin
  if not private.verify_admin_key(p_admin_key) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with deleted as (
    delete from public.audios
    where deleted_at is not null
      and deleted_at <= now() - interval '30 days'
    returning id
  )
  select count(*) into v_count from deleted;

  return jsonb_build_object('purged', v_count);
end;
$$;

revoke all on function public.prepare_audio_upload(text, text, text, text, integer) from public;
revoke all on function public.finalize_audio_upload(text, uuid, bigint) from public;
revoke all on function public.soft_delete_audio(text, uuid) from public;
revoke all on function public.restore_audio(text, uuid) from public;
revoke all on function public.list_trashed_audios(text) from public;
revoke all on function public.update_audio_meta(text, uuid, text, text, integer) from public;
revoke all on function public.set_audio_blob_url(text, uuid, text) from public;
revoke all on function public.purge_expired_trash(text) from public;

grant execute on function public.prepare_audio_upload(text, text, text, text, integer) to anon, authenticated;
grant execute on function public.finalize_audio_upload(text, uuid, bigint) to anon, authenticated;
grant execute on function public.soft_delete_audio(text, uuid) to anon, authenticated;
grant execute on function public.restore_audio(text, uuid) to anon, authenticated;
grant execute on function public.list_trashed_audios(text) to anon, authenticated;
grant execute on function public.update_audio_meta(text, uuid, text, text, integer) to anon, authenticated;
grant execute on function public.set_audio_blob_url(text, uuid, text) to anon, authenticated;
grant execute on function public.purge_expired_trash(text) to anon, authenticated;

grant select on table public.audios to anon, authenticated;
