-- Phase 3: play history for weighted draws / rooms
-- room_id is nullable text for now; Phase 4 will link shared rooms.

create table if not exists public.play_history (
  id uuid primary key default gen_random_uuid(),
  audio_id uuid references public.audios (id) on delete set null,
  audio_name text,
  audio_url text,
  room_id text,
  played_at timestamptz not null default now()
);

create index if not exists play_history_played_at_idx
  on public.play_history (played_at desc);

create index if not exists play_history_room_idx
  on public.play_history (room_id, played_at desc);

alter table public.play_history enable row level security;

drop policy if exists play_history_select on public.play_history;
create policy play_history_select
  on public.play_history
  for select
  to anon, authenticated
  using (true);

-- Inserts go through SECURITY DEFINER RPC (no direct insert for anon).

create or replace function public.record_play(
  p_audio_id uuid default null,
  p_audio_name text default null,
  p_audio_url text default null,
  p_room_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.play_history (audio_id, audio_name, audio_url, room_id)
  values (p_audio_id, left(coalesce(p_audio_name, ''), 200), p_audio_url, nullif(p_room_id, ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'ok', true);
end;
$$;

create or replace function public.list_play_history(
  p_room_id text default null,
  p_limit integer default 50
)
returns setof public.play_history
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.play_history
  where (p_room_id is null or room_id is not distinct from p_room_id)
  order by played_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.record_play(uuid, text, text, text) from public;
revoke all on function public.list_play_history(text, integer) from public;
grant execute on function public.record_play(uuid, text, text, text) to anon, authenticated;
grant execute on function public.list_play_history(text, integer) to anon, authenticated;
grant select on table public.play_history to anon, authenticated;
