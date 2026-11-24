import { useMemo } from 'react';
import { useTable } from './db';
import type { Item, QuestNode, UeDropTable, UeLootTable, UeRecipe, UeShop, UeTable } from './types';

/*
 * Ties the Unreal game data (items.ue, ue_tables) to the written quests.
 * "Not in questlines" = the item came from Unreal but no quest gives it as a reward or asks for it.
 */

export type UeLink = { tag: string; color: string; text: string; href: string };

export const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
export const qty = (min: number, max: number) => (min === max ? `×${min}` : `×${min}–${max}`);

/** Every item asset a table entry mentions. */
export function tableItems(t: UeTable): string[] {
  const d = t.data;
  if (t.kind === 'recipe') return [(d as UeRecipe).result, ...(d as UeRecipe).ingredients.map((g) => g.item)];
  if (t.kind === 'drop_table') return (d as UeDropTable).entries.map((e) => e.item);
  if (t.kind === 'loot_table') return (d as UeLootTable).pools.flatMap((p) => p.entries.map((e) => e.item));
  if (t.kind === 'shop') return (d as UeShop).entries.flatMap((e) => (e.currency ? [e.item, e.currency] : [e.item]));
  return [];
}

export function useGameData() {
  const { rows: items } = useTable<Item>('items');
  const { rows: nodes } = useTable<QuestNode>('quest_nodes');
  const { rows: tables, loaded } = useTable<UeTable>('ue_tables');

  return useMemo(() => {
    const byAsset = new Map<string, Item>();
    for (const it of items) if (it.ue_asset) byAsset.set(it.ue_asset, it);

    // Quests that give or need each item.
    const questUse = new Map<string, string[]>();
    for (const q of nodes) {
      if (q.kind !== 'quest') continue;
      const label = `${q.data.code ? q.data.code + ' ' : ''}${q.data.name || 'Untitled quest'}`;
      const ids = [...(q.data.rewards ?? []).map((r: { item: string | null }) => r.item), ...(q.data.required_items ?? []).map((r: { item: string }) => r.item)];
      for (const id of ids) if (id) questUse.set(id, [...new Set([...(questUse.get(id) ?? []), label])]);
    }
    const inQuests = (itemId: string | undefined | null) => !!itemId && questUse.has(itemId);
    const assetInQuests = (asset: string | null | undefined) => inQuests(asset ? byAsset.get(asset)?.id : null);
    /** Imported from Unreal and not used by any written quest. */
    const notInQuests = (it: Item) => !!it.ue_asset && !questUse.has(it.id);

    // Where Unreal says each item comes from and goes to.
    const sources = new Map<string, UeLink[]>();
    const uses = new Map<string, UeLink[]>();
    const add = (m: Map<string, UeLink[]>, asset: string | null | undefined, l: UeLink) => {
      const id = asset ? byAsset.get(asset)?.id : undefined;
      if (id) m.set(id, [...(m.get(id) ?? []), l]);
    };
    const nameOf = (asset: string) => byAsset.get(asset)?.name ?? asset;
    for (const t of tables) {
      if (t.kind === 'recipe') {
        const r = t.data as UeRecipe;
        const text = `${r.station === 'None' ? 'Field' : r.station}: ${r.ingredients.map((g) => `${g.qty}× ${nameOf(g.item)}`).join(' + ')}${r.qty > 1 ? ` → ${r.qty}` : ''}`;
        add(sources, r.result, { tag: 'UE RECIPE', color: '#b9c0f0', text, href: '#/game-data/recipes' });
        for (const g of r.ingredients) add(uses, g.item, { tag: 'UE RECIPE', color: '#b9c0f0', text: `${g.qty}× in ${nameOf(r.result)} (${r.code})`, href: '#/game-data/recipes' });
      } else if (t.kind === 'drop_table') {
        for (const e of (t.data as UeDropTable).entries)
          add(sources, e.item, { tag: 'UE DROP', color: '#e0805d', text: `${t.code} · ${pct(e.chance)} ${qty(e.min, e.max)}`, href: '#/game-data/drops' });
      } else if (t.kind === 'loot_table') {
        const lt = t.data as UeLootTable;
        for (const p of lt.pools) {
          const total = p.entries.reduce((n, e) => n + e.weight, 0) || 1;
          for (const e of p.entries)
            add(sources, e.item, { tag: 'UE LOOT', color: '#c4b04e', text: `${t.code}${lt.pools.length > 1 ? ' · ' + p.name : ''} · ${pct(e.weight / total)} ${qty(e.min, e.max)}`, href: '#/game-data/loot' });
        }
      } else if (t.kind === 'shop') {
        const s = t.data as UeShop;
        for (const e of s.entries) {
          const cur = e.currency ? nameOf(e.currency) : 'WATER';
          if (e.can_buy) add(sources, e.item, { tag: 'UE SHOP', color: '#8fbf74', text: `${s.name} · buy ${e.buy} ${cur}`, href: '#/game-data/shops' });
          if (e.can_sell) add(uses, e.item, { tag: 'UE SHOP', color: '#8fbf74', text: `${s.name} buys it for ${e.sell} ${cur}`, href: '#/game-data/shops' });
          if (e.currency) add(uses, e.currency, { tag: 'UE SHOP', color: '#8fbf74', text: `Pays for ${nameOf(e.item)} at ${s.name}`, href: '#/game-data/shops' });
        }
      }
    }

    return { loaded, items, tables, byAsset, questUse, inQuests, assetInQuests, notInQuests, sources, uses, nameOf };
  }, [items, nodes, tables, loaded]);
}

export type GameData = ReturnType<typeof useGameData>;
