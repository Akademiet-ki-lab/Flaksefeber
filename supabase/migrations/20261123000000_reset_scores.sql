-- Flaksefeber: reset all scores before the school-wide competition.
-- Users (auth.users), names, classes, XP, skins and unlocked arenas are kept,
-- so everyone stays logged in on the same account. Only the scores go to zero.

-- Competition leaderboard: the rows stay (name and class), best goes back to 0.
-- The leaderboard function only shows rows with best > 0, so the list starts empty.
update public.leaderboard
set best = 0,
    achieved_at = now(),
    updated_at = now();

-- Personal bests per arena in normal mode.
update public.progress
set bests = array_fill(0, array[10]),
    updated_at = now();

-- Runs started before the reset must not post a score afterwards.
update public.runs
set finished = true
where not finished;
