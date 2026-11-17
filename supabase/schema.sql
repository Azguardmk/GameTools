-- Earthlings Tools — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create extension if not exists "pgcrypto";

-- Team members shown as coloured badges on tasks and quests.
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initials text not null,
  color text not null default '#d9a75e',
  email text,
  sort int not null default 0
);

-- Every pre-defined list (item categories, rarities, quest types, ...).
-- "list" is the list key, "extra" holds list-specific fields (e.g. prefix, default_stack, tier).
create table if not exists definitions (
  id uuid primary key default gen_random_uuid(),
  list text not null,
  name text not null,
  color text not null default '#c9c1b3',
  sort int not null default 0,
  extra jsonb not null default '{}'::jsonb
);
create index if not exists definitions_list_idx on definitions(list);

-- Task board
create table if not exists task_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#d9a75e',
  sort int not null default 0,
  collapsed boolean not null default false
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references task_groups(id) on delete cascade,
  title text not null default '',
  notes text not null default '',
  assignees uuid[] not null default '{}',
  priority uuid references definitions(id) on delete set null,
  status uuid references definitions(id) on delete set null,
  done boolean not null default false,
  done_by uuid,
  done_at timestamptz,
  sort int not null default 0
);

-- Items
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  code text not null default '',
  name text not null default '',
  category uuid references definitions(id) on delete restrict,
  rarity uuid references definitions(id) on delete restrict,
  stack int not null default 1,
  value int not null default 0,
  weight numeric not null default 0,
  description text not null default '',
  icon_url text,
  -- [{ "type": <definition id>, "text": "Rust Rats (25%)" }]
  sources jsonb not null default '[]'::jsonb,
  -- { "station": <definition id>, "time": "8 s", "learned_from": "...", "ingredients": [{ "item": <item id>, "qty": 2 }] } or null
  recipe jsonb,
  -- for blueprints: the item id this blueprint teaches
  teaches uuid
);

-- Quests
create table if not exists quest_chains (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#d9a75e',
  sort int not null default 0
);

-- kind: quest | condition | choice | external
-- data for a quest: code, name, description, level, giver, type, zone, status, assignee,
--   objectives [{type, text, count}], required_items [{item, qty}], rewards [{type, text, item, amount}]
create table if not exists quest_nodes (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid references quest_chains(id) on delete cascade,
  kind text not null,
  x double precision not null default 0,
  y double precision not null default 0,
  data jsonb not null default '{}'::jsonb
);

-- kind: unlocks | condition | choice | external
create table if not exists quest_edges (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid references quest_chains(id) on delete cascade,
  source uuid references quest_nodes(id) on delete cascade,
  target uuid references quest_nodes(id) on delete cascade,
  kind text not null default 'unlocks',
  label text not null default ''
);

-- Only signed-in team members can read or change anything.
do $$
declare t text;
begin
  foreach t in array array['members','definitions','task_groups','tasks','items','quest_chains','quest_nodes','quest_edges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "team access" on %I', t);
    execute format('create policy "team access" on %I for all to authenticated using (true) with check (true)', t);
    execute format('alter table %I replica identity full', t);
  end loop;
end $$;

-- Live updates for everyone looking at the tool.
do $$
declare t text;
begin
  foreach t in array array['members','definitions','task_groups','tasks','items','quest_chains','quest_nodes','quest_edges'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
