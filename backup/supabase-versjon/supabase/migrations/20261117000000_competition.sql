-- Flaksefeber: competition mode and leaderboard.
-- Like the other tables, only the Edge Function `game` (service role) reads
-- and writes this. The browser asks the function for the leaderboard.

alter table public.runs
  add column mode text not null default 'normal'
  check (mode in ('normal', 'comp'));

create table public.leaderboard (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 20),
  klass       text not null check (klass in (
                '1IM', '2IM', '1MK', '2MK', '3MK', '1STA', '2STA', '3STA',
                '1STB', '2STB', '3STB', 'Påbygg', 'Lærere')),
  best        int  not null default 0 check (best >= 0),
  achieved_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- set to true in the dashboard to hide a row (for example a bad name)
  hidden      boolean not null default false
);
create index leaderboard_rank_idx
  on public.leaderboard (best desc, achieved_at asc)
  where not hidden;

alter table public.leaderboard enable row level security;
revoke all on public.leaderboard from anon, authenticated;
