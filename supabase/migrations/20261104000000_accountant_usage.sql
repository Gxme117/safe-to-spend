-- What each user's questions to Tim and Frank have cost Anthropic so far, per UK day (US cents, worked out by the accountant
-- function from each answer's token use). The function checks it before asking Claude, so one person can't run up the bill.
-- Only the function reaches it (with the service role): row level security on with no policies, and the function that adds to
-- it can't be called with a user's own key, so no one can reset their own day.

create table public.accountant_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  cents numeric not null default 0,
  primary key (user_id, day)
);

alter table public.accountant_usage enable row level security;

-- Adds p_cents to the user's day and returns the new total (0 just reads it).
create function public.accountant_spend(p_user uuid, p_day date, p_cents numeric)
returns numeric
language sql
security invoker
set search_path = ''
as $$
  insert into public.accountant_usage as u (user_id, day, cents) values (p_user, p_day, p_cents)
  on conflict (user_id, day) do update set cents = u.cents + excluded.cents
  returning u.cents;
$$;

revoke execute on function public.accountant_spend(uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.accountant_spend(uuid, date, numeric) to service_role;
