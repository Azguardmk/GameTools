import { useContext, useMemo, useState } from 'react';
import { ItemIcon, NpcIcon } from '../../components/ui';
import { QuestCtx } from './shared';

/*
 * Left-hand library in the quest editor: NPCs, items and currency.
 * Drag one onto the graph:
 *   NPC  → on empty space: new dialogue line with that speaker
 *          on a dialogue or End: sets the speaker · on a quest: sets the quest giver
 *   Item → on a quest or End: adds it as a reward
 * Or select a node and click an entry to do the same.
 */
export type LibraryDrop = { kind: 'npc' | 'item'; id: string };
export const LIBRARY_MIME = 'application/x-earthlings-library';

export function Library({ onPick, open, onToggle }: { onPick: (d: LibraryDrop) => void; open: boolean; onToggle: () => void }) {
  const { defs, itemsById } = useContext(QuestCtx);
  const [tab, setTab] = useState<'npc' | 'item' | 'currency'>('npc');
  const [q, setQ] = useState('');
  const npcs = defs.list('character');
  const { items, currency } = useMemo(() => {
    const all = [...itemsById.values()].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
    const isCurrency = (catId: string | null) => /currenc|coin|money/i.test(defs.get(catId)?.name ?? '');
    return { items: all.filter((i) => !isCurrency(i.category)), currency: all.filter((i) => isCurrency(i.category)) };
  }, [itemsById, defs]);

  if (!open)
    return (
      <button type="button" className="lib-collapsed" onClick={onToggle} aria-label="Show NPCs and items" title="Show NPCs and items">
        <span>NPCs · ITEMS</span>
      </button>
    );

  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const drag = (d: LibraryDrop) => (e: React.DragEvent) => {
    e.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(d));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const list = tab === 'npc' ? [] : tab === 'item' ? items : currency;

  return (
    <aside className="library" aria-label="NPCs and items">
      <div className="lib-head">
        <div className="seg" role="tablist" style={{ flex: 1 }}>
          {(
            [
              ['npc', 'NPCs', npcs.length],
              ['item', 'Items', items.length],
              ['currency', 'Currency', currency.length],
            ] as const
          ).map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label} <span className="muted">{n}</span>
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={onToggle} aria-label="Hide NPCs and items" title="Hide">
          ‹
        </button>
      </div>
      <input className="input" placeholder="Search" aria-label="Search NPCs and items" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 32, fontSize: 13 }} />
      <div className="lib-list">
        {tab === 'npc'
          ? npcs
              .filter((c) => match(c.name + ' ' + (c.extra?.role ?? '')))
              .map((c) => (
                <button key={c.id} type="button" className="lib-entry" draggable onDragStart={drag({ kind: 'npc', id: c.id })} onClick={() => onPick({ kind: 'npc', id: c.id })} title="Drag onto the graph, or click to use it on the selected node">
                  <NpcIcon name={c.name} color={c.color} />
                  <span className="lib-text">
                    <strong>{c.name}</strong>
                    <span>{[c.extra?.role, defs.get(c.extra?.district)?.name].filter(Boolean).join(' · ') || 'Character'}</span>
                  </span>
                </button>
              ))
          : list
              .filter((it) => match(it.name + ' ' + it.code))
              .map((it) => (
                <button key={it.id} type="button" className="lib-entry" draggable onDragStart={drag({ kind: 'item', id: it.id })} onClick={() => onPick({ kind: 'item', id: it.id })} title="Drag onto a quest or End to add it as a reward">
                  <ItemIcon name={it.name} icon={it.icon_url} color={defs.get(it.category)?.color} edge={defs.get(it.rarity)?.color} size={26} />
                  <span className="lib-text">
                    <strong>{it.name}</strong>
                    <span style={{ color: defs.get(it.rarity)?.color }}>{defs.get(it.rarity)?.name ?? ''}</span>
                  </span>
                </button>
              ))}
        {tab === 'npc' && npcs.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No characters yet. Add them under Definitions → Characters / NPCs.</span>}
        {tab !== 'npc' && list.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{tab === 'currency' ? 'No items in a “Currency” category yet.' : 'No items yet.'}</span>}
      </div>
      <span className="muted" style={{ fontSize: 11, lineHeight: 1.45 }}>
        Drag an NPC onto empty space for a new dialogue line, or onto a quest / dialogue / End to set who speaks. Drag an item onto a quest or End to add it as a reward.
      </span>
    </aside>
  );
}
