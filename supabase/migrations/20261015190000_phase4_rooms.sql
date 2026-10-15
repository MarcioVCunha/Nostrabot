-- Phase 4: shared rooms + server clock for synced timers

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default 'Sala Nostrabot',
  host_label text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rooms_code_idx on public.rooms (code);

alter table public.rooms enable row level security;

drop policy if exists rooms_select on public.rooms;
create policy rooms_select
  on public.rooms
  for select
  to anon, authenticated
  using (true);

-- Mutations only via SECURITY DEFINER RPCs.

create or replace function public.server_now()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select now();
$$;

create or replace function private.random_room_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..6 loop
    out := out || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return out;
end;
$$;

create or replace function public.create_room(
  p_name text default 'Sala Nostrabot',
  p_host_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_code text;
  v_id uuid;
  v_tries int := 0;
begin
  loop
    v_code := private.random_room_code();
    begin
      insert into public.rooms (code, name, host_label, state)
      values (
        v_code,
        left(coalesce(nullif(trim(p_name), ''), 'Sala Nostrabot'), 80),
        left(coalesce(p_host_label, ''), 80),
        jsonb_build_object(
          'status', 'idle',
          'ends_at', null,
          'duration_ms', null,
          'remaining_ms', null,
          'drawn_audio', null,
          'revision', 0
        )
      )
      returning id into v_id;
      exit;
    exception
      when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 8 then
          raise exception 'could not allocate room code';
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'name', coalesce(nullif(trim(p_name), ''), 'Sala Nostrabot'),
    'server_now', now()
  );
end;
$$;

create or replace function public.get_room(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.rooms;
begin
  select * into v_row
  from public.rooms
  where code = upper(trim(p_code));

  if v_row.id is null then
    raise exception 'room not found';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'code', v_row.code,
    'name', v_row.name,
    'host_label', v_row.host_label,
    'state', v_row.state,
    'updated_at', v_row.updated_at,
    'server_now', now()
  );
end;
$$;

create or replace function public.set_room_state(
  p_code text,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.rooms;
  v_state jsonb;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid state';
  end if;

  select * into v_row from public.rooms where code = upper(trim(p_code));
  if v_row.id is null then
    raise exception 'room not found';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb) || p_state;
  v_state := jsonb_set(
    v_state,
    '{revision}',
    to_jsonb(coalesce((v_row.state->>'revision')::int, 0) + 1)
  );

  update public.rooms
  set state = v_state,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'code', v_row.code,
    'state', v_row.state,
    'updated_at', v_row.updated_at,
    'server_now', now()
  );
end;
$$;

create or replace function public.start_room_timer(
  p_code text,
  p_duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ends timestamptz;
begin
  if p_duration_ms is null or p_duration_ms < 1000 or p_duration_ms > 86400000 then
    raise exception 'invalid duration';
  end if;

  v_ends := now() + make_interval(secs => p_duration_ms::numeric / 1000.0);

  return public.set_room_state(
    p_code,
    jsonb_build_object(
      'status', 'running',
      'duration_ms', p_duration_ms,
      'ends_at', v_ends,
      'remaining_ms', null,
      'drawn_audio', null
    )
  );
end;
$$;

revoke all on function public.server_now() from public;
revoke all on function public.create_room(text, text) from public;
revoke all on function public.get_room(text) from public;
revoke all on function public.set_room_state(text, jsonb) from public;
revoke all on function public.start_room_timer(text, integer) from public;

grant execute on function public.server_now() to anon, authenticated;
grant execute on function public.create_room(text, text) to anon, authenticated;
grant execute on function public.get_room(text) to anon, authenticated;
grant execute on function public.set_room_state(text, jsonb) to anon, authenticated;
grant execute on function public.start_room_timer(text, integer) to anon, authenticated;
grant select on table public.rooms to anon, authenticated;

-- Realtime: add table to publication when available
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
