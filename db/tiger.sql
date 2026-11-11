-- Tiger Data (TimescaleDB) setup for CollegeExperience.
-- Run once against your Tiger Data service after schema.sql:
--   psql "$DATABASE_URL" -f db/schema.sql -f db/tiger.sql
-- Sam's stats are logged once per game hour so the end screen can chart the whole month.

create table if not exists stat_history (
  game_id     text        not null,
  game_time   timestamptz not null,   -- the in-game clock (October 2026), not wall time
  recorded_at timestamptz not null default now(),
  health      int not null,
  hunger      int not null,
  happiness   int not null,
  money       int not null,
  energy      int not null,
  burnout     int not null,
  occupation  text
);

-- Turn it into a hypertable partitioned on the game clock.
select create_hypertable('stat_history', by_range('game_time', interval '7 days'), if_not_exists => true);

-- One row per game and game hour (re-logging an hour updates it).
create unique index if not exists stat_history_game_hour on stat_history (game_id, game_time);
