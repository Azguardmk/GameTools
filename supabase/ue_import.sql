-- Game data imported from the Unreal project (tools/ue-sync).
-- Run after schema.sql. Safe to run again.

-- Items that exist in Unreal carry their asset name and a copy of the Unreal values.
alter table items add column if not exists ue_asset text;
alter table items add column if not exists ue jsonb;
create unique index if not exists items_ue_asset_key on items(ue_asset) where ue_asset is not null;

-- Recipes, drop tables, loot tables and shops as they are in Unreal.
-- kind: recipe | drop_table | loot_table | shop. Items inside "data" are Unreal asset names (items.ue_asset).
create table if not exists ue_tables (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  code text not null,
  name text not null default '',
  data jsonb not null default '{}'::jsonb,
  notes text not null default '',
  imported_at timestamptz not null default now(),
  unique (kind, code)
);

alter table public.ue_tables enable row level security;
drop policy if exists "team access" on public.ue_tables;
create policy "team access" on public.ue_tables for all to authenticated using (true) with check (true);
alter table public.ue_tables replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.ue_tables;
exception when duplicate_object then null;
end $$;

-- List entries Unreal uses that the tool didn't have yet.
do $$
declare r_sort int; c_sort int;
begin
  if not exists (select 1 from definitions where list = 'rarity' and name = 'Very Rare') then
    select sort into r_sort from definitions where list = 'rarity' and name = 'Rare';
    update definitions set sort = sort + 1 where list = 'rarity' and sort > coalesce(r_sort, 0);
    insert into definitions (list, name, color, sort, extra) values ('rarity', 'Very Rare', '#7aa7e8', coalesce(r_sort, 0) + 1, '{"tier":"3"}');
  end if;
  if not exists (select 1 from definitions where list = 'rarity' and name = 'Mythic') then
    insert into definitions (list, name, color, sort, extra)
    select 'rarity', 'Mythic', '#e86f9c', coalesce(max(sort), 0) + 1, '{"tier":"6"}' from definitions where list = 'rarity';
  end if;
  select coalesce(max(sort), 0) into c_sort from definitions where list = 'item_category';
  insert into definitions (list, name, color, sort, extra)
  select 'item_category', v.name, v.color, c_sort + v.n, jsonb_build_object('prefix', v.prefix, 'default_stack', v.stack)
  from (values (1, 'Special', '#c99be0', 'SP_', '1'), (2, 'Companion', '#9fd18b', 'CMP_', '1'), (3, 'Pin', '#e0b04f', 'PIN_', '1'),
               (4, 'Racing', '#66c6d6', 'RC_', '1'), (5, 'Housing', '#c4a27a', 'HDA_', '1')) as v(n, name, color, prefix, stack)
  where not exists (select 1 from definitions d where d.list = 'item_category' and d.name = v.name);
end $$;

-- Imports a ue_export.json (tools/ue-sync/ue_export.py). Called from Game data → Import from Unreal.
-- Items: matched by asset name, or the first time by the same name (ignoring case, spaces and symbols)
-- so items already written in the tool get linked instead of duplicated. Only new items get their
-- name / category / rarity / stack / description from Unreal; for every item the Unreal values are kept in "ue".
create or replace function public.import_ue(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  it jsonb;
  norm text;
  target uuid;
  n_new int := 0; n_linked int := 0; n_updated int := 0; n_removed int := 0;
  next_sort int;
  assets text[] := array(select jsonb_array_elements(payload->'items')->>'asset');
begin
  select coalesce(max(sort), 0) + 1 into next_sort from items;

  for it in select * from jsonb_array_elements(payload->'items') loop
    select id into target from items where ue_asset = it->>'asset';
    if target is not null then
      update items set ue = it - 'asset' where id = target;
      n_updated := n_updated + 1;
      continue;
    end if;

    norm := lower(regexp_replace(it->>'name', '[^a-zA-Z0-9]', '', 'g'));
    -- Link to a hand-written item only when the name is unambiguous on both sides.
    if norm <> '' and (select count(*) from jsonb_array_elements(payload->'items') x
                       where lower(regexp_replace(x->>'name', '[^a-zA-Z0-9]', '', 'g')) = norm) = 1 then
      select id into target from items
      where ue_asset is null and lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) = norm
      order by sort limit 1;
    end if;

    if target is not null then
      update items set ue_asset = it->>'asset', ue = it - 'asset' where id = target;
      n_linked := n_linked + 1;
    else
      insert into items (code, name, category, rarity, stack, value, weight, description, icon_url, sources, recipe, teaches, sort, ue_asset, ue)
      values (
        regexp_replace(it->>'asset', '^.*/', ''), it->>'name',
        (select id from definitions where list = 'item_category' and name = it->>'category' limit 1),
        (select id from definitions where list = 'rarity' and name = it->>'rarity' limit 1),
        greatest(1, coalesce((it->>'stack')::int, 1)), 0, 0, coalesce(it->>'description', ''), null, '[]'::jsonb, null, null,
        next_sort, it->>'asset', it - 'asset');
      next_sort := next_sort + 1;
      n_new := n_new + 1;
    end if;
  end loop;

  -- Items that are gone from Unreal stay in the tool, flagged.
  update items set ue = coalesce(ue, '{}'::jsonb) || '{"removed": true}'::jsonb
  where ue_asset is not null and not (ue_asset = any(assets)) and coalesce((ue->>'removed')::boolean, false) = false;
  get diagnostics n_removed = row_count;
  update items set ue = ue - 'removed' where ue_asset = any(assets) and ue ? 'removed';

  -- Tables: replace each kind with what Unreal has now; notes typed in the tool are kept.
  insert into ue_tables (kind, code, name, data, imported_at)
  select k.kind, x->>'code', coalesce(x->>'name', x->>'code'), x, now()
  from (values ('recipe', 'recipes'), ('drop_table', 'drop_tables'), ('loot_table', 'loot_tables'), ('shop', 'shops')) as k(kind, key),
       jsonb_array_elements(coalesce(payload->k.key, '[]'::jsonb)) x
  on conflict (kind, code) do update set name = excluded.name, data = excluded.data, imported_at = excluded.imported_at;

  delete from ue_tables t
  where not exists (
    select 1 from (values ('recipe', 'recipes'), ('drop_table', 'drop_tables'), ('loot_table', 'loot_tables'), ('shop', 'shops')) as k(kind, key),
                  jsonb_array_elements(coalesce(payload->k.key, '[]'::jsonb)) x
    where k.kind = t.kind and x->>'code' = t.code);

  return jsonb_build_object('new_items', n_new, 'linked_items', n_linked, 'updated_items', n_updated, 'removed_items', n_removed,
    'recipes', jsonb_array_length(coalesce(payload->'recipes', '[]')), 'drop_tables', jsonb_array_length(coalesce(payload->'drop_tables', '[]')),
    'loot_tables', jsonb_array_length(coalesce(payload->'loot_tables', '[]')), 'shops', jsonb_array_length(coalesce(payload->'shops', '[]')));
end $$;

revoke all on function public.import_ue(jsonb) from public, anon;
grant execute on function public.import_ue(jsonb) to authenticated;
