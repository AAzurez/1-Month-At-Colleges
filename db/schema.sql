create table choices (
  id bigint generated always as identity primary key,
  player_id text not null,
  event_id text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create table agent_replies (
  id bigint generated always as identity primary key,
  choice_id bigint not null references choices (id),
  agent text not null,
  reply text not null,
  created_at timestamptz not null default now()
);
