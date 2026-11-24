-- Flaksefeber: progress and runs.
-- Players never write to these tables from the browser. Only the Edge
-- Function `game` writes (with the service role), after replaying the run.

create table public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  bests      int[] not null default array_fill(0, array[10]),
  arenas     int   not null default 1 check (arenas between 1 and 10),
  arena      int   not null default 0,
  xp         int   not null default 0 check (xp between 0 and 200),
  skin       int   not null default 0 check (skin between 0 and 6),
  seq        int   not null default 0,
  updated_at timestamptz not null default now(),
  constraint progress_arena_unlocked check (arena >= 0 and arena < arenas),
  constraint progress_bests_len check (array_length(bests, 1) = 10)
);

create table public.runs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  seed       bigint not null,
  seq        int not null,
  arena      int not null,
  started_at timestamptz not null default now(),
  finished   boolean not null default false
);
create index runs_user_started_idx on public.runs (user_id, started_at);

-- Row level security on, with NO policies: the anon and authenticated roles
-- (the browser) can't read or write anything directly.
alter table public.progress enable row level security;
alter table public.runs enable row level security;
revoke all on public.progress from anon, authenticated;
revoke all on public.runs from anon, authenticated;
