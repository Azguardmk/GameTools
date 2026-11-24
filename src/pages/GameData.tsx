import { useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { supabase, update } from '../lib/db';
import { pct, qty, tableItems, useGameData, type GameData } from '../lib/gameData';
import type { Item, UeDropTable, UeLootTable, UeRecipe, UeShop, UeTable } from '../lib/types';
import { Icon, TextField } from '../components/ui';
import { UE_HELP, UeItemChip } from '../components/gameData';

/*
 * Game data: what the Unreal project's managers hold (recipes, drop tables, loot tables, shops, equipment),
 * imported with tools/ue-sync. Orange dots mark items no written quest uses yet.
 */

const TABS = [
  { key: 'recipes', label: 'Recipes', kind: 'recipe' },
  { key: 'drops', label: 'Drop tables', kind: 'drop_table' },
  { key: 'loot', label: 'Loot tables', kind: 'loot_table' },
  { key: 'shops', label: 'Shops', kind: 'shop' },
  { key: 'equipment', label: 'Equipment', kind: null },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const EQUIP_CLASSES = ['EquipmentDataAsset', 'WeaponItemDataAsset', 'HoverboardLightsDataAsset', 'RaceSpellDataAsset'];
const SLOT_ORDER = ['Head', 'Chest', 'Gloves', 'Legs', 'Boots', 'Accessory', 'Weapon', 'WeaponMelee', 'WeaponRanged', 'ToolPickaxe', 'ToolAxe', 'ToolFishingRod', 'Flashlight', 'Hoverboard', 'RaceSpell1'];

/** How many of a table's items no quest uses. */
function unusedCount(t: UeTable, gd: GameData) {
  const assets = [...new Set(tableItems(t))];
  return { total: assets.length, unused: assets.filter((a) => !gd.assetInQuests(a)).length };
}

export default function GameDataPage() {
  const { tab } = useParams<{ tab: TabKey }>();
  const gd = useGameData();
  const [query, setQuery] = useState('');
  const [onlyUnused, setOnlyUnused] = useState(false);

  const current = TABS.find((t) => t.key === tab);
  if (!current) return <Navigate to="/game-data/recipes" replace />;

  const equipment = gd.items.filter((i) => i.ue && EQUIP_CLASSES.includes(i.ue.class));
  const lastImport = gd.tables.reduce((m, t) => (t.imported_at > m ? t.imported_at : m), '');
  const q = query.trim().toLowerCase();

  const matches = (t: UeTable) =>
    (!q || (t.code + ' ' + t.name + ' ' + tableItems(t).map((a) => a + ' ' + gd.nameOf(a)).join(' ')).toLowerCase().includes(q)) &&
    (!onlyUnused || unusedCount(t, gd).unused > 0);

  const counts = (kind: string | null) => {
    if (!kind) return { n: equipment.length, unused: equipment.filter(gd.notInQuests).length };
    const list = gd.tables.filter((t) => t.kind === kind);
    return { n: list.length, unused: list.filter((t) => unusedCount(t, gd).unused > 0).length };
  };

  const list = current.kind ? gd.tables.filter((t) => t.kind === current.kind && matches(t)).sort((a, b) => a.code.localeCompare(b.code)) : [];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <h1 style={{ fontSize: 30, marginRight: 8 }}>Game data</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          From the Unreal project{lastImport ? ' · imported ' + new Date(lastImport).toLocaleString() : ''}
        </span>
        <div className="spacer" />
        <label style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '0 1 260px' }}>
          <span className="sr-only">Search</span>
          <span style={{ position: 'absolute', left: 12, color: 'var(--muted)', display: 'flex' }}>
            <Icon name="search" />
          </span>
          <input className="input" type="search" placeholder="Search tables or items" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 36 }} />
        </label>
        <button type="button" className="btn ue-btn" aria-pressed={onlyUnused} onClick={() => setOnlyUnused(!onlyUnused)} title={UE_HELP}>
          <span className="ue-dot" /> Only not in questlines
        </button>
        <ImportButton />
      </div>

      <nav className="gd-tabs" aria-label="Game data">
        {TABS.map((t) => {
          const c = counts(t.kind);
          return (
            <NavLink key={t.key} to={'/game-data/' + t.key}>
              {t.label} <span className="count">{c.n}</span>
              {c.unused > 0 && (
                <span className="ue-count" title={`${c.unused} with items not in questlines`}>
                  {c.unused}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="ue-dot" /> = imported from Unreal but not used in any written questline yet. Hover an item to see which quests use it.
      </div>

      {!gd.loaded ? null : current.key === 'equipment' ? (
        <EquipmentList items={equipment} gd={gd} query={q} onlyUnused={onlyUnused} />
      ) : list.length === 0 ? (
        <div className="empty">{gd.tables.length ? 'Nothing matches.' : 'Nothing imported yet. Use “Import from Unreal”.'}</div>
      ) : (
        <div className="gd-list">
          {current.kind === 'recipe' ? (
            <RecipeTable rows={list} gd={gd} />
          ) : (
            list.map((t) => (
              <TableCard key={t.id} t={t} gd={gd}>
                {t.kind === 'drop_table' && <DropBody d={t.data as UeDropTable} gd={gd} />}
                {t.kind === 'loot_table' && <LootBody d={t.data as UeLootTable} gd={gd} />}
                {t.kind === 'shop' && <ShopBody d={t.data as UeShop} gd={gd} />}
              </TableCard>
            ))
          )}
        </div>
      )}
    </>
  );
}

function UnusedBadge({ t, gd }: { t: UeTable; gd: GameData }) {
  const c = unusedCount(t, gd);
  if (!c.unused) return <span className="ue-pill ok">All items in questlines</span>;
  return (
    <span className="ue-pill" title={UE_HELP}>
      {c.unused === c.total ? 'Not in questlines' : `${c.unused} of ${c.total} items not in questlines`}
    </span>
  );
}

function TableCard({ t, gd, children }: { t: UeTable; gd: GameData; children: ReactNode }) {
  const d = t.data;
  return (
    <section className="panel gd-card" aria-label={t.name}>
      <div className="list-row" style={{ flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 16, color: '#f1ebdf' }}>{t.name}</strong>
        {t.name !== t.code && <code className="muted" style={{ fontSize: 12 }}>{t.code}</code>}
        <UnusedBadge t={t} gd={gd} />
        <div className="spacer" />
        {d.type && <span className="tag muted">{d.type}</span>}
        {d.vendors?.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Sold by {d.vendors.join(', ')}</span>}
        {d.path && <span className="muted" style={{ fontSize: 11 }}>{d.path}</span>}
      </div>
      {children}
      <TextField value={t.notes} label={'Notes for ' + t.name} placeholder="Notes: what to fix, which quest it belongs to…" onCommit={(v) => update('ue_tables', t.id, { notes: v })} />
    </section>
  );
}

function DropBody({ d, gd }: { d: UeDropTable; gd: GameData }) {
  return (
    <table className="gd-table">
      <thead>
        <tr><th>Item</th><th>Chance</th><th>Quantity</th><th /></tr>
      </thead>
      <tbody>
        {d.entries.map((e, i) => (
          <tr key={i}>
            <td><UeItemChip asset={e.item} gd={gd} /></td>
            <td>{pct(e.chance)}</td>
            <td>{qty(e.min, e.max)}</td>
            <td className="muted" style={{ fontSize: 12 }}>{e.legacy_quest ? `Old quest gate ${e.legacy_quest} (ignored since EP-1054)` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LootBody({ d, gd }: { d: UeLootTable; gd: GameData }) {
  return (
    <>
      {d.pools.map((p, pi) => {
        const total = p.entries.reduce((n, e) => n + e.weight, 0) || 1;
        return (
          <div key={pi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {d.pools.length > 1 || d.type !== 'Loot DataTable' ? (
              <span className="section-label">
                {p.name.toUpperCase()} · {pct(p.chance)} chance · {p.min_rolls === p.max_rolls ? p.min_rolls : `${p.min_rolls}–${p.max_rolls}`} roll{p.max_rolls === 1 ? '' : 's'}
                {p.unique ? ' · no repeats' : ''}
              </span>
            ) : null}
            <table className="gd-table">
              <thead>
                <tr><th>Item</th><th>Weight</th><th>Odds</th><th>Quantity</th>{d.type === 'Loot DataTable' && <th>Row / node material</th>}</tr>
              </thead>
              <tbody>
                {p.entries.map((e, i) => (
                  <tr key={i}>
                    <td><UeItemChip asset={e.item} gd={gd} /></td>
                    <td>{e.weight}</td>
                    <td>{pct(e.weight / total)}</td>
                    <td>{qty(e.min, e.max)}</td>
                    {d.type === 'Loot DataTable' && <td className="muted" style={{ fontSize: 12 }}>{[e.row, e.node_material].filter(Boolean).join(' · ')}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function ShopBody({ d, gd }: { d: UeShop; gd: GameData }) {
  return (
    <table className="gd-table">
      <thead>
        <tr><th>Item</th><th>Player buys for</th><th>Player sells for</th><th>Currency</th></tr>
      </thead>
      <tbody>
        {d.entries.map((e, i) => (
          <tr key={i}>
            <td><UeItemChip asset={e.item} gd={gd} /></td>
            <td>{e.can_buy ? e.buy : <span className="muted">not sold</span>}</td>
            <td>{e.can_sell ? e.sell : <span className="muted">not bought</span>}</td>
            <td>{e.currency ? <UeItemChip asset={e.currency} gd={gd} /> : 'WATER'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecipeTable({ rows, gd }: { rows: UeTable[]; gd: GameData }) {
  const stations = [...new Set(rows.map((r) => (r.data as UeRecipe).station))].sort();
  return (
    <>
      {stations.map((st) => {
        const list = rows.filter((r) => (r.data as UeRecipe).station === st);
        return (
          <section key={st} className="panel gd-card">
            <div className="list-row">
              <strong style={{ fontSize: 16, color: '#f1ebdf' }}>{st === 'None' ? 'Field (no station)' : st}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{list.length} recipes</span>
            </div>
            <table className="gd-table">
              <thead>
                <tr><th>Makes</th><th>Ingredients</th><th>Time</th><th>Recipe ID</th><th>Status</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const r = t.data as UeRecipe;
                  return (
                    <tr key={t.id}>
                      <td><UeItemChip asset={r.result} gd={gd} suffix={r.qty > 1 ? '×' + r.qty : undefined} /></td>
                      <td>
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {r.ingredients.map((g, i) => <UeItemChip key={i} asset={g.item} gd={gd} suffix={'×' + g.qty} />)}
                        </span>
                      </td>
                      <td>{r.seconds ? r.seconds + ' s' : 'instant'}{r.field ? ' · field' : ''}</td>
                      <td><code className="muted" style={{ fontSize: 11 }}>{r.code}</code></td>
                      <td><UnusedBadge t={t} gd={gd} /></td>
                      <td style={{ minWidth: 180 }}>
                        <TextField value={t.notes} label={'Notes for ' + r.code} placeholder="Notes" onCommit={(v) => update('ue_tables', t.id, { notes: v })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}

function statText(it: Item) {
  const p = it.ue?.props ?? {};
  if (Array.isArray(p.StatModifiers) && p.StatModifiers.length && !p.bRollStats)
    return p.StatModifiers.map((m: { Stat?: string; Value?: number }) => `${m.Stat ?? 'Attack'} +${m.Value ?? 0}`).join(', ');
  if (p.bRollStats) {
    const r = p.RollParams ?? {};
    const n = `${r.MinStatCount ?? 1}–${r.MaxStatCount ?? 3}`;
    return `Rolls ${n} of ${(r.ObtainableStats ?? []).join(', ') || 'slot defaults'} · total ${r.MinTotalValue ?? 5}–${r.MaxTotalValue ?? 20}`;
  }
  return '—';
}

function EquipmentList({ items, gd, query, onlyUnused }: { items: Item[]; gd: GameData; query: string; onlyUnused: boolean }) {
  const shown = useMemo(
    () =>
      items
        .filter((i) => !query || (i.name + ' ' + i.ue_asset + ' ' + (i.ue?.slot ?? '')).toLowerCase().includes(query))
        .filter((i) => !onlyUnused || gd.notInQuests(i)),
    [items, query, onlyUnused, gd],
  );
  const slotIdx = (s: string | null | undefined) => {
    const i = SLOT_ORDER.indexOf(s ?? '');
    return i < 0 ? 99 : i;
  };
  const slots = [...new Set(shown.map((i) => i.ue?.slot ?? 'None'))].sort((a, b) => slotIdx(a) - slotIdx(b));
  if (!shown.length) return <div className="empty">Nothing matches.</div>;
  return (
    <div className="gd-list">
      {slots.map((s) => {
        const list = shown.filter((i) => (i.ue?.slot ?? 'None') === s).sort((a, b) => (a.ue?.tier ?? 0) - (b.ue?.tier ?? 0) || a.name.localeCompare(b.name));
        return (
          <section key={s} className="panel gd-card">
            <div className="list-row">
              <strong style={{ fontSize: 16, color: '#f1ebdf' }}>{s.replace(/^Tool/, 'Tool: ').replace(/^RaceSpell1$/, 'Race spell')}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{list.length}</span>
            </div>
            <table className="gd-table">
              <thead>
                <tr><th>Item</th><th>Tier</th><th>Rarity</th><th>Stats</th><th>Other</th></tr>
              </thead>
              <tbody>
                {list.map((it) => {
                  const p = it.ue?.props ?? {};
                  const other = [p.HandCategory, p.GatherSpeed && `gather ×${p.GatherSpeed}`, p.Cooldown && `cooldown ${p.Cooldown} s`, it.ue?.removed && 'removed from UE']
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <tr key={it.id}>
                      <td><UeItemChip asset={it.ue_asset} gd={gd} /></td>
                      <td>{it.ue?.tier || '—'}</td>
                      <td>{it.ue?.rarity}</td>
                      <td style={{ fontSize: 12 }}>{statText(it)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{other}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

/** Reads a ue_export.json (tools/ue-sync) and imports it into the database. */
function ImportButton() {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<string | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !supabase) return;
          setState('Importing…');
          try {
            const payload = JSON.parse(await f.text());
            if (!Array.isArray(payload.items)) throw new Error('This is not a ue_export.json file.');
            const { data, error } = await supabase.rpc('import_ue', { payload });
            if (error) throw error;
            setState(`Imported: ${data.new_items} new items, ${data.linked_items} linked, ${data.updated_items} updated, ${data.removed_items} removed · ${data.recipes} recipes, ${data.drop_tables} drop tables, ${data.loot_tables} loot tables, ${data.shops} shops.`);
          } catch (err) {
            setState('Import failed: ' + (err instanceof Error ? err.message : String((err as any)?.message ?? err)));
          }
        }}
      />
      <button
        type="button"
        className="btn"
        disabled={!supabase}
        title="Pick a ue_export.json made by tools/ue-sync/ue_export.py"
        onClick={() => input.current?.click()}
      >
        <Icon name="download" /> Import from Unreal
      </button>
      {state && (
        <div className="undo-toast" role="status">
          <span>{state}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setState(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
    </>
  );
}
