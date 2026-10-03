-- Arena v1. All client writes pass through transaction-scoped RPCs.
create table public.tetris_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(24) not null default '方塊玩家' check (length(display_name) between 2 and 24 and display_name !~ '[[:cntrl:]]'),
  is_banned boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tetris_rooms (
  id uuid primary key default gen_random_uuid(), code varchar(8) unique not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','countdown','playing','finished','closed')),
  current_match_id uuid, revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'), closed_at timestamptz
);
create table public.tetris_room_players (
  room_id uuid not null references public.tetris_rooms(id) on delete cascade,
  seat smallint not null check (seat in (1,2)), user_id uuid not null references auth.users(id) on delete cascade,
  ready boolean not null default false, rematch_ready boolean not null default false,
  joined_at timestamptz not null default now(), left_at timestamptz, last_seen_at timestamptz not null default now(),
  controller_connection_id uuid, primary key (room_id,seat), unique(room_id,user_id)
);
create table public.tetris_matches (
  id uuid primary key default gen_random_uuid(), round_id uuid unique not null default gen_random_uuid(),
  room_id uuid not null references public.tetris_rooms(id) on delete cascade,
  mode text not null default 'online' check (mode in ('solo','ai','online')),
  rules_version text not null default 'arena-v1' check (rules_version = 'arena-v1'),
  status text not null default 'countdown' check (status in ('pending','countdown','playing','resolving','finished','abandoned')),
  piece_seed text not null, garbage_seed_1 text not null, garbage_seed_2 text not null,
  start_at timestamptz not null, ended_at timestamptz, resolve_after timestamptz,
  winner_user_id uuid references auth.users(id) on delete set null,
  finish_reason text check (finish_reason in ('top_out','draw','disconnect','surrender','sync_failed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tetris_rooms add constraint tetris_current_match_fk foreign key (current_match_id) references public.tetris_matches(id) on delete set null;
create table public.tetris_match_players (
  match_id uuid not null references public.tetris_matches(id) on delete cascade,
  seat smallint not null check (seat in (1,2)), user_id uuid not null references auth.users(id) on delete cascade,
  score bigint not null default 0 check (score between 0 and 9007199254740991),
  lines bigint not null default 0 check (lines between 0 and 100000), level bigint not null default 1 check (level between 1 and 10001),
  pieces_locked bigint not null default 0 check (pieces_locked between 0 and 1000000),
  attacks_sent bigint not null default 0 check (attacks_sent between 0 and 1000000),
  attacks_received bigint not null default 0 check (attacks_received between 0 and 1000000),
  outcome text check (outcome in ('win','loss','draw','abandoned')), top_out_at timestamptz, last_report_at timestamptz,
  result_report_id uuid unique, finish_reason text check (finish_reason in ('top_out','surrender','sync_failed')),
  primary key (match_id,seat), unique(match_id,user_id)
);
create table public.tetris_scores (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('solo','ai')), rules_version text not null check (rules_version = 'arena-v1'),
  difficulty text check (difficulty in ('easy','normal')),
  score bigint not null check (score between 0 and 9007199254740991), lines bigint not null check (lines between 0 and 100000),
  level bigint not null check (level between 1 and 10001), duration_ms bigint not null check (duration_ms between 0 and 86400000),
  pieces_locked bigint not null check (pieces_locked between 0 and 1000000),
  outcome text check (outcome in ('win','loss','draw')),
  client_run_id uuid not null, validation_status text not null default 'unverified' check (validation_status in ('unverified','verified','rejected')),
  created_at timestamptz not null default now(), unique(user_id,client_run_id)
);
create table public.tetris_requests (
  user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
  kind text not null, input jsonb not null, response jsonb, created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
create index tetris_room_expiry on public.tetris_rooms(status,expires_at);
create index tetris_members_user on public.tetris_room_players(user_id,left_at);
create index tetris_matches_history on public.tetris_matches(room_id,created_at desc);
create index tetris_match_user on public.tetris_match_players(user_id,match_id);
create index tetris_scores_ranking on public.tetris_scores(mode,rules_version,score desc,lines desc,created_at);
create index tetris_scores_user on public.tetris_scores(user_id,mode,rules_version,score desc);
create index tetris_requests_rate on public.tetris_requests(user_id,kind,created_at);

alter table public.tetris_profiles enable row level security;
alter table public.tetris_rooms enable row level security;
alter table public.tetris_room_players enable row level security;
alter table public.tetris_matches enable row level security;
alter table public.tetris_match_players enable row level security;
alter table public.tetris_scores enable row level security;
alter table public.tetris_requests enable row level security;
revoke all on public.tetris_profiles, public.tetris_rooms, public.tetris_room_players, public.tetris_matches, public.tetris_match_players, public.tetris_scores, public.tetris_requests from anon, authenticated;
grant select on public.tetris_profiles, public.tetris_rooms, public.tetris_room_players, public.tetris_matches, public.tetris_match_players, public.tetris_scores to authenticated;

create function public.tetris_is_member(p_room_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tetris_room_players p join public.tetris_rooms r on r.id=p.room_id
    where p.room_id=p_room_id and p.user_id=auth.uid() and p.left_at is null and r.status<>'closed');
$$;
create function public.tetris_is_participant(p_match_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tetris_match_players where match_id=p_match_id and user_id=auth.uid());
$$;
create function public.tetris_topic_member(p_topic text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tetris_room_players p join public.tetris_rooms r on r.id=p.room_id
    where ('tetris:room:' || p.room_id::text)=p_topic and p.user_id=auth.uid() and p.left_at is null and r.status<>'closed');
$$;
create policy tetris_profile_self on public.tetris_profiles for select to authenticated using (user_id=(select auth.uid()));
create policy tetris_rooms_member on public.tetris_rooms for select to authenticated using (public.tetris_is_member(id));
create policy tetris_seats_member on public.tetris_room_players for select to authenticated using (public.tetris_is_member(room_id));
create policy tetris_matches_participant on public.tetris_matches for select to authenticated using (public.tetris_is_participant(id));
create policy tetris_results_participant on public.tetris_match_players for select to authenticated using (public.tetris_is_participant(match_id));
create policy tetris_scores_self on public.tetris_scores for select to authenticated using (user_id=(select auth.uid()));
-- realtime.messages already has RLS; do not ALTER a platform-owned table.
create policy tetris_private_receive on realtime.messages for select to authenticated
  using (extension in ('broadcast','presence') and public.tetris_topic_member((select realtime.topic())));
create policy tetris_private_send on realtime.messages for insert to authenticated
  with check (extension in ('broadcast','presence') and public.tetris_topic_member((select realtime.topic())));

create function public.tetris_require_user() returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception '請先登入' using errcode='42501'; end if;
  insert into public.tetris_profiles(user_id) values(u) on conflict do nothing;
  if exists(select 1 from public.tetris_profiles where user_id=u and is_banned) then raise exception '帳號無法使用' using errcode='42501'; end if;
  return u;
end $$;
create function public.tetris_begin_request(p_id uuid,p_kind text,p_input jsonb,p_limit integer default 60) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := public.tetris_require_user(); saved public.tetris_requests;
begin
  if p_id is null then raise exception '缺少 request_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || p_id::text,0));
  select * into saved from public.tetris_requests where user_id=u and request_id=p_id;
  if found then
    if saved.kind<>p_kind or saved.input<>p_input then raise exception 'request_id 已用於不同請求'; end if;
    return saved.response;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || p_kind,1));
  if (select count(*) from public.tetris_requests where user_id=u and kind=p_kind and created_at>clock_timestamp()-interval '1 minute')>=p_limit then raise exception '操作過於頻繁，請稍後再試'; end if;
  insert into public.tetris_requests(user_id,request_id,kind,input) values(u,p_id,p_kind,p_input);
  return null;
end $$;
create function public.tetris_end_request(p_id uuid,p_response jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.tetris_requests set response=p_response where user_id=auth.uid() and request_id=p_id;
  return p_response;
end $$;
create function public.tetris_room_dto(p_room_id uuid) returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('room',to_jsonb(r),'players',coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object('display_name',f.display_name) order by p.seat)
    from public.tetris_room_players p join public.tetris_profiles f on f.user_id=p.user_id
    where p.room_id=r.id and p.left_at is null),'[]'::jsonb),
    'match',(select to_jsonb(m) from public.tetris_matches m where m.id=r.current_match_id),
    'results',coalesce((select jsonb_agg(to_jsonb(mp) order by mp.seat) from public.tetris_match_players mp where mp.match_id=r.current_match_id),'[]'::jsonb),
    'server_time',clock_timestamp()) from public.tetris_rooms r where r.id=p_room_id;
$$;
create function public.tetris_get_room(p_room_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.tetris_require_user();
  if not public.tetris_is_member(p_room_id) and not exists(select 1 from public.tetris_room_players p join public.tetris_rooms r on r.id=p.room_id where p.room_id=p_room_id and p.user_id=auth.uid() and r.status='closed') then raise exception '無法讀取房間' using errcode='42501'; end if;
  return public.tetris_room_dto(p_room_id);
end $$;
create function public.tetris_update_profile(p_display_name text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; name text := trim(regexp_replace(p_display_name,'[[:cntrl:]]','','g'));
begin
  saved := public.tetris_begin_request(p_request_id,'profile',jsonb_build_object('name',name),10);
  if saved is not null then return saved; end if;
  if length(name) not between 2 and 24 then raise exception '暱稱須為 2–24 個字'; end if;
  update public.tetris_profiles set display_name=name,updated_at=clock_timestamp() where user_id=auth.uid();
  return public.tetris_end_request(p_request_id,jsonb_build_object('display_name',name));
end $$;
create function public.tetris_create_room(p_request_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; r public.tetris_rooms; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; n integer; bytes bytea;
begin
  saved:=public.tetris_begin_request(p_request_id,'create','{}',4);
  if saved is not null then return saved; end if;
  if (select count(*) from public.tetris_rooms where owner_id=auth.uid() and status<>'closed' and expires_at>clock_timestamp())>=3 then raise exception '請先離開其他房間'; end if;
  loop
    bytes:=decode(replace(gen_random_uuid()::text,'-',''),'hex'); c:='';
    for n in 0..5 loop c:=c || substr(alphabet,1+(get_byte(bytes,n)%length(alphabet)),1); end loop;
    begin
      insert into public.tetris_rooms(code,owner_id) values(c,auth.uid()) returning * into r; exit;
    exception when unique_violation then null;
    end;
  end loop;
  insert into public.tetris_room_players(room_id,seat,user_id) values(r.id,1,auth.uid());
  return public.tetris_end_request(p_request_id,public.tetris_room_dto(r.id));
end $$;
create function public.tetris_join_room(p_code text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; r public.tetris_rooms; task_code text := upper(trim(p_code));
begin
  saved:=public.tetris_begin_request(p_request_id,'join',jsonb_build_object('code',task_code),20);
  if saved is not null then return saved; end if;
  select * into r from public.tetris_rooms where tetris_rooms.code=task_code for update;
  if r.id is null or r.expires_at<=clock_timestamp() or r.status='closed' then return public.tetris_end_request(p_request_id,jsonb_build_object('error','無法加入房間，請確認房碼與空位')); end if;
  if exists(select 1 from public.tetris_room_players where room_id=r.id and user_id=auth.uid() and left_at is null) then return public.tetris_end_request(p_request_id,public.tetris_room_dto(r.id)); end if;
  if r.status<>'waiting' or exists(select 1 from public.tetris_room_players where room_id=r.id and seat=2) then return public.tetris_end_request(p_request_id,jsonb_build_object('error','無法加入房間，請確認房碼與空位')); end if;
  insert into public.tetris_room_players(room_id,seat,user_id) values(r.id,2,auth.uid());
  update public.tetris_rooms set revision=revision+1,updated_at=clock_timestamp() where id=r.id;
  return public.tetris_end_request(p_request_id,public.tetris_room_dto(r.id));
end $$;
create function public.tetris_claim_controller(p_room_id uuid,p_connection_id uuid,p_request_id uuid,p_take_over boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; p public.tetris_room_players; can_control boolean;
begin
  saved:=public.tetris_begin_request(p_request_id,'controller',jsonb_build_object('room',p_room_id,'connection',p_connection_id,'take_over',p_take_over));
  if saved is not null then return saved; end if;
  if not public.tetris_is_member(p_room_id) or p_connection_id is null then raise exception '無法取得控制權' using errcode='42501'; end if;
  perform 1 from public.tetris_rooms where id=p_room_id for update;
  select * into p from public.tetris_room_players where room_id=p_room_id and user_id=auth.uid() for update;
  if p.last_seen_at<clock_timestamp()-interval '20 seconds' and exists(select 1 from public.tetris_matches m join public.tetris_rooms r on r.current_match_id=m.id where r.id=p_room_id and m.status='playing' and clock_timestamp()>=m.start_at+interval '20 seconds') then raise exception '已超過重連期限，等待伺服器結算'; end if;
  can_control:=p.controller_connection_id is null or p.controller_connection_id=p_connection_id or p.last_seen_at<clock_timestamp()-interval '20 seconds' or p_take_over;
  if can_control then update public.tetris_room_players set controller_connection_id=p_connection_id,last_seen_at=clock_timestamp() where room_id=p_room_id and user_id=auth.uid(); end if;
  return public.tetris_end_request(p_request_id,jsonb_build_object('can_control',can_control));
end $$;
create function public.tetris_assert_controller(p_room_id uuid,p_connection_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.tetris_room_players where room_id=p_room_id and user_id=auth.uid() and left_at is null and controller_connection_id=p_connection_id) then raise exception '此分頁沒有控制權' using errcode='42501'; end if;
end $$;
create function public.tetris_heartbeat(p_room_id uuid,p_connection_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.tetris_require_user(); perform public.tetris_assert_controller(p_room_id,p_connection_id);
  if exists(select 1 from public.tetris_room_players p join public.tetris_rooms r on r.id=p.room_id join public.tetris_matches m on m.id=r.current_match_id where p.room_id=p_room_id and p.user_id=auth.uid() and p.last_seen_at<clock_timestamp()-interval '20 seconds' and m.status='playing' and clock_timestamp()>=m.start_at+interval '20 seconds') then raise exception '已超過重連期限'; end if;
  update public.tetris_room_players set last_seen_at=clock_timestamp() where room_id=p_room_id and user_id=auth.uid() and last_seen_at<=clock_timestamp()-interval '4 seconds';
  return jsonb_build_object('server_time',clock_timestamp());
end $$;
create function public.tetris_new_match(p_room_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare m public.tetris_matches;
begin
  if (select count(*) from public.tetris_room_players where room_id=p_room_id and left_at is null)<>2 then raise exception '需要兩位玩家'; end if;
  insert into public.tetris_matches(room_id,piece_seed,garbage_seed_1,garbage_seed_2,start_at)
    values(p_room_id,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,clock_timestamp()+interval '3 seconds') returning * into m;
  insert into public.tetris_match_players(match_id,seat,user_id) select m.id,seat,user_id from public.tetris_room_players where room_id=p_room_id and left_at is null;
  update public.tetris_room_players set ready=false,rematch_ready=false,last_seen_at=clock_timestamp() where room_id=p_room_id;
  update public.tetris_rooms set status='countdown',current_match_id=m.id,revision=revision+1,expires_at=clock_timestamp()+interval '24 hours',updated_at=clock_timestamp() where id=p_room_id;
end $$;
create function public.tetris_set_ready(p_room_id uuid,p_ready boolean,p_expected_revision bigint,p_request_id uuid,p_connection_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; r public.tetris_rooms;
begin
  saved:=public.tetris_begin_request(p_request_id,'ready',jsonb_build_object('room',p_room_id,'ready',p_ready,'revision',p_expected_revision),40);
  if saved is not null then return saved; end if;
  select * into r from public.tetris_rooms where id=p_room_id for update;
  perform public.tetris_assert_controller(p_room_id,p_connection_id);
  if r.status<>'waiting' then raise exception '房間已開始'; end if;
  if r.revision<>p_expected_revision then return public.tetris_end_request(p_request_id,jsonb_build_object('error','房間狀態已更新，請重試')); end if;
  update public.tetris_room_players set ready=p_ready where room_id=p_room_id and user_id=auth.uid();
  if (select count(*) from public.tetris_room_players where room_id=p_room_id and left_at is null and ready)=2 then perform public.tetris_new_match(p_room_id);
  else update public.tetris_rooms set revision=revision+1,updated_at=clock_timestamp() where id=p_room_id; end if;
  return public.tetris_end_request(p_request_id,public.tetris_room_dto(p_room_id));
end $$;
create function public.tetris_activate_match(p_match_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; m public.tetris_matches; rid uuid;
begin
  saved:=public.tetris_begin_request(p_request_id,'activate',jsonb_build_object('match',p_match_id));
  if saved is not null then return saved; end if;
  if not public.tetris_is_participant(p_match_id) then raise exception '無法存取對局' using errcode='42501'; end if;
  select room_id into rid from public.tetris_matches where id=p_match_id;
  perform 1 from public.tetris_rooms where id=rid for update;
  select * into m from public.tetris_matches where id=p_match_id for update;
  if m.status='countdown' and clock_timestamp()>=m.start_at then
    update public.tetris_matches set status='playing',updated_at=clock_timestamp() where id=m.id;
    update public.tetris_rooms set status='playing',revision=revision+1,updated_at=clock_timestamp() where id=rid;
  end if;
  return public.tetris_end_request(p_request_id,public.tetris_room_dto(rid));
end $$;
create function public.tetris_set_rematch(p_room_id uuid,p_ready boolean,p_expected_revision bigint,p_request_id uuid,p_connection_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; r public.tetris_rooms;
begin
  saved:=public.tetris_begin_request(p_request_id,'rematch',jsonb_build_object('room',p_room_id,'ready',p_ready,'revision',p_expected_revision),40);
  if saved is not null then return saved; end if;
  select * into r from public.tetris_rooms where id=p_room_id for update;
  perform public.tetris_assert_controller(p_room_id,p_connection_id);
  if r.status<>'finished' then raise exception '對局尚未結束'; end if;
  if r.revision<>p_expected_revision then return public.tetris_end_request(p_request_id,jsonb_build_object('error','房間狀態已更新，請重試')); end if;
  update public.tetris_room_players set rematch_ready=p_ready where room_id=p_room_id and user_id=auth.uid();
  if (select count(*) from public.tetris_room_players where room_id=p_room_id and left_at is null and rematch_ready)=2 then perform public.tetris_new_match(p_room_id);
  else update public.tetris_rooms set revision=revision+1,updated_at=clock_timestamp() where id=p_room_id; end if;
  return public.tetris_end_request(p_request_id,public.tetris_room_dto(p_room_id));
end $$;
create function public.tetris_report_finish(p_match_id uuid,p_round_id uuid,p_result_report_id uuid,p_stats jsonb,p_reason text,p_connection_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.tetris_matches; mp public.tetris_match_players; rid uuid;
begin
  perform public.tetris_require_user();
  if not public.tetris_is_participant(p_match_id) then raise exception '無法回報對局' using errcode='42501'; end if;
  select room_id into rid from public.tetris_matches where id=p_match_id;
  perform 1 from public.tetris_rooms where id=rid for update;
  select * into m from public.tetris_matches where id=p_match_id for update;
  if m.round_id<>p_round_id then raise exception '回合已過期'; end if;
  perform public.tetris_finalize_timeout(m.id);
  select * into m from public.tetris_matches where id=p_match_id;
  if m.status='resolving' and clock_timestamp()>=m.resolve_after then
    perform public.tetris_finalize_match(m.id);
    return public.tetris_room_dto(rid);
  end if;
  select * into mp from public.tetris_match_players where match_id=p_match_id and user_id=auth.uid();
  if mp.result_report_id is not null or m.status in ('finished','abandoned') then return public.tetris_room_dto(rid); end if;
  perform public.tetris_assert_controller(rid,p_connection_id);
  if m.status not in ('playing','resolving') or p_reason not in ('top_out','surrender','sync_failed') or p_result_report_id is null then raise exception '無效的結束報告'; end if;
  update public.tetris_match_players set
    score=(p_stats->>'score')::bigint,lines=(p_stats->>'lines')::bigint,level=(p_stats->>'level')::bigint,
    pieces_locked=(p_stats->>'pieces_locked')::bigint,attacks_sent=(p_stats->>'attacks_sent')::bigint,attacks_received=(p_stats->>'attacks_received')::bigint,
    top_out_at=clock_timestamp(),last_report_at=clock_timestamp(),result_report_id=p_result_report_id,finish_reason=p_reason
    where match_id=p_match_id and user_id=auth.uid();
  if m.status='playing' then
    update public.tetris_matches set status='resolving',resolve_after=clock_timestamp()+interval '150 milliseconds',updated_at=clock_timestamp() where id=m.id;
    update public.tetris_rooms set revision=revision+1,updated_at=clock_timestamp() where id=rid;
  end if;
  return public.tetris_room_dto(rid);
end $$;
create function public.tetris_finalize_match(p_match_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare m public.tetris_matches; first_report public.tetris_match_players; second_report public.tetris_match_players; winner uuid; reason text; rid uuid;
begin
  select room_id into rid from public.tetris_matches where id=p_match_id;
  perform 1 from public.tetris_rooms where id=rid for update;
  select * into m from public.tetris_matches where id=p_match_id for update;
  if m.status<>'resolving' or clock_timestamp()<m.resolve_after then return; end if;
  select * into first_report from public.tetris_match_players where match_id=p_match_id and top_out_at is not null order by top_out_at,seat limit 1;
  select * into second_report from public.tetris_match_players where match_id=p_match_id and user_id<>first_report.user_id;
  if first_report.finish_reason='sync_failed' or second_report.finish_reason='sync_failed' then
    update public.tetris_match_players set outcome='abandoned' where match_id=m.id;
    update public.tetris_matches set status='abandoned',finish_reason='sync_failed',ended_at=clock_timestamp() where id=m.id;
  else
    if first_report.finish_reason='top_out' and second_report.finish_reason='top_out' and abs(extract(epoch from second_report.top_out_at-first_report.top_out_at))<=0.100 then winner:=null; reason:='draw';
    else winner:=second_report.user_id; reason:=first_report.finish_reason; end if;
    update public.tetris_match_players set outcome=case when winner is null then 'draw' when user_id=winner then 'win' else 'loss' end where match_id=m.id;
    update public.tetris_matches set status='finished',winner_user_id=winner,finish_reason=reason,ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
  end if;
  update public.tetris_rooms set status='finished',revision=revision+1,expires_at=clock_timestamp()+interval '24 hours',updated_at=clock_timestamp() where id=rid;
end $$;
create function public.tetris_leave_room(p_room_id uuid,p_request_id uuid,p_connection_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb; r public.tetris_rooms;
begin
  saved:=public.tetris_begin_request(p_request_id,'leave',jsonb_build_object('room',p_room_id));
  if saved is not null then return saved; end if;
  select * into r from public.tetris_rooms where id=p_room_id for update;
  perform public.tetris_assert_controller(p_room_id,p_connection_id);
  if r.status in ('playing','countdown') then
    update public.tetris_room_players set left_at=clock_timestamp(),last_seen_at=clock_timestamp()-interval '21 seconds' where room_id=p_room_id and user_id=auth.uid();
  elsif r.owner_id=auth.uid() then update public.tetris_rooms set status='closed',closed_at=clock_timestamp(),revision=revision+1 where id=r.id;
  elsif r.status='waiting' then delete from public.tetris_room_players where room_id=r.id and user_id=auth.uid();
  else update public.tetris_room_players set left_at=clock_timestamp() where room_id=r.id and user_id=auth.uid(); end if;
  if r.owner_id<>auth.uid() then update public.tetris_rooms set revision=revision+1,updated_at=clock_timestamp() where id=r.id; end if;
  return public.tetris_end_request(p_request_id,jsonb_build_object('left',true));
end $$;
create function public.tetris_record_match_stats(p_match_id uuid,p_round_id uuid,p_stats jsonb,p_result_report_id uuid,p_connection_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare m public.tetris_matches; rid uuid;
begin
  perform public.tetris_require_user();
  if not public.tetris_is_participant(p_match_id) then raise exception '無法回報對局' using errcode='42501'; end if;
  select room_id into rid from public.tetris_matches where id=p_match_id;
  perform 1 from public.tetris_rooms where id=rid for update;
  select * into m from public.tetris_matches where id=p_match_id for update;
  if m.round_id<>p_round_id or m.status not in ('finished','abandoned') or p_result_report_id is null then raise exception '對局尚未結算'; end if;
  perform public.tetris_assert_controller(rid,p_connection_id);
  update public.tetris_match_players set score=(p_stats->>'score')::bigint,lines=(p_stats->>'lines')::bigint,level=(p_stats->>'level')::bigint,
    pieces_locked=(p_stats->>'pieces_locked')::bigint,attacks_sent=(p_stats->>'attacks_sent')::bigint,attacks_received=(p_stats->>'attacks_received')::bigint,
    result_report_id=p_result_report_id,last_report_at=clock_timestamp()
    where match_id=m.id and user_id=auth.uid() and result_report_id is null;
  -- Stats cannot modify top_out_at, finish_reason, winner or outcome.
end $$;
create function public.tetris_submit_score(p_client_run_id uuid,p_mode text,p_stats jsonb,p_rules_version text,p_difficulty text default null,p_outcome text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid:=public.tetris_require_user(); existing public.tetris_scores; result uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(u::text || 'score',0));
  select * into existing from public.tetris_scores where user_id=u and client_run_id=p_client_run_id;
  if found then return existing.id; end if;
  if (select count(*) from public.tetris_scores where user_id=u and created_at>clock_timestamp()-interval '1 minute')>=6 then raise exception '成績提交過於頻繁'; end if;
  insert into public.tetris_scores(user_id,mode,rules_version,difficulty,score,lines,level,duration_ms,pieces_locked,outcome,client_run_id)
    values(u,p_mode,p_rules_version,p_difficulty,(p_stats->>'score')::bigint,(p_stats->>'lines')::bigint,(p_stats->>'level')::bigint,(p_stats->>'duration_ms')::bigint,(p_stats->>'pieces_locked')::bigint,p_outcome,p_client_run_id) returning id into result;
  return result;
end $$;
create function public.tetris_get_leaderboard(p_mode text default 'solo',p_rules_version text default 'arena-v1',p_limit integer default 20,p_offset integer default 0) returns table(display_name text,score bigint,lines bigint,level bigint,difficulty text,validation_status text,created_at timestamptz) language sql stable security definer set search_path = '' as $$
  select p.display_name::text,s.score,s.lines,s.level,s.difficulty,s.validation_status,s.created_at
  from (select distinct on (user_id) * from public.tetris_scores
    where mode=p_mode and rules_version=p_rules_version and validation_status<>'rejected'
    order by user_id,score desc,lines desc,created_at asc) s
  join public.tetris_profiles p on p.user_id=s.user_id and not p.is_banned
  order by s.score desc,s.lines desc,s.created_at asc limit least(greatest(p_limit,1),50) offset least(greatest(p_offset,0),10000);
$$;
create function public.tetris_finalize_timeout(p_match_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare m public.tetris_matches; expired integer; winner uuid; rid uuid;
begin
  select room_id into rid from public.tetris_matches where id=p_match_id;
  perform 1 from public.tetris_rooms where id=rid for update;
  select * into m from public.tetris_matches where id=p_match_id for update;
  if m.status<>'playing' or clock_timestamp()<m.start_at+interval '20 seconds' then return; end if;
  select count(*) into expired from public.tetris_room_players where room_id=rid and (left_at is not null or last_seen_at<clock_timestamp()-interval '20 seconds');
  if expired=0 then return; end if;
  if expired=1 then select user_id into winner from public.tetris_room_players where room_id=rid and left_at is null and last_seen_at>=clock_timestamp()-interval '20 seconds'; end if;
  update public.tetris_matches set status=case when expired=2 then 'abandoned' else 'finished' end,winner_user_id=winner,finish_reason='disconnect',ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
  update public.tetris_match_players set outcome=case when expired=2 then 'abandoned' when user_id=winner then 'win' else 'loss' end where match_id=m.id;
  update public.tetris_rooms set status='finished',revision=revision+1,updated_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours' where id=rid;
end $$;
create function public.tetris_sweep() returns void language plpgsql security definer set search_path = '' as $$
declare m public.tetris_matches; expired integer; winner uuid;
begin
  -- Every mutation takes room then match locks, matching all client RPCs.
  for m in select * from public.tetris_matches where status in ('countdown','playing','resolving') order by created_at loop
    perform 1 from public.tetris_rooms where id=m.room_id for update;
    select * into m from public.tetris_matches where id=m.id for update;
    if m.status='resolving' then perform public.tetris_finalize_match(m.id); continue; end if;
    if m.status='countdown' and clock_timestamp()>=m.start_at then
      update public.tetris_matches set status='playing',updated_at=clock_timestamp() where id=m.id;
      update public.tetris_rooms set status='playing',revision=revision+1,updated_at=clock_timestamp() where id=m.room_id;
      m.status:='playing';
    end if;
    perform public.tetris_finalize_timeout(m.id);
  end loop;
  update public.tetris_rooms set status='closed',closed_at=clock_timestamp(),revision=revision+1 where status in ('waiting','finished') and expires_at<clock_timestamp();
  delete from public.tetris_requests where created_at<clock_timestamp()-interval '7 days';
end $$;
create function public.tetris_broadcast_room() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('roomId',new.id,'revision',new.revision,'matchId',new.current_match_id,'status',new.status),'room_changed','tetris:room:' || new.id::text,true);
  return new;
end $$;
create trigger tetris_room_changed after update on public.tetris_rooms for each row execute function public.tetris_broadcast_room();

-- Helpers and finalizers are server-only. Public function defaults are revoked explicitly.
do $$ declare fn record; begin
  for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'tetris_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  end loop;
end $$;
grant execute on function public.tetris_is_member(uuid),public.tetris_is_participant(uuid),public.tetris_topic_member(text),public.tetris_get_room(uuid),public.tetris_update_profile(text,uuid),public.tetris_create_room(uuid),public.tetris_join_room(text,uuid),public.tetris_claim_controller(uuid,uuid,uuid,boolean),public.tetris_heartbeat(uuid,uuid),public.tetris_set_ready(uuid,boolean,bigint,uuid,uuid),public.tetris_activate_match(uuid,uuid),public.tetris_set_rematch(uuid,boolean,bigint,uuid,uuid),public.tetris_report_finish(uuid,uuid,uuid,jsonb,text,uuid),public.tetris_leave_room(uuid,uuid,uuid),public.tetris_submit_score(uuid,text,jsonb,text,text,text) to authenticated;
grant execute on function public.tetris_get_leaderboard(text,text,integer,integer) to anon,authenticated;
grant execute on function public.tetris_record_match_stats(uuid,uuid,jsonb,uuid,uuid) to authenticated;
grant execute on function public.tetris_finalize_match(uuid),public.tetris_sweep() to service_role;
grant execute on function public.tetris_finalize_timeout(uuid) to service_role;
