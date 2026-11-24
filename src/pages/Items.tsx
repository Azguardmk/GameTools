import { Fragment, useEffect, useMemo, useState } from 'react';
import { insert, newId, remove, update, useTable } from '../lib/db';
import { download, useDefinitions } from '../lib/hooks';
import { enumKey, type Item, type QuestNode, type Recipe } from '../lib/types';
import { DefSelect, Icon, TextField } from '../components/ui';
import { useGameData, type GameData } from '../lib/gameData';
import { UeBadge, UeItemPanel } from '../components/gameData';

function mono(name: string) {
  const w = name.replace(/^Blueprint:\s*/i, '').split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w[0][0] + (w[1] ? w[1][0] : w[0][1] ?? '')).toUpperCase();
}

function byOrder(a: Item, b: Item) {
  return (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);
}

function csvCell(v: unknown) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default function ItemsPage() {
  const { rows: items } = useTable<Item>('items');
  const { rows: nodes } = useTable<QuestNode>('quest_nodes');
  const defs = useDefinitions();
  const [cat, setCat] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [ueFilter, setUeFilter] = useState<'off' | 'unused' | 'notInUe'>('off');
  const gd = useGameData();

  const categories = defs.list('item_category');
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const quests = nodes.filter((n) => n.kind === 'quest');

  // Where each item comes from / is used, worked out from recipes and quests.
  const links = useMemo(() => {
    const fromQuests = new Map<string, string[]>();
    const neededByQuests = new Map<string, string[]>();
    const inRecipes = new Map<string, string[]>();
    const taughtBy = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string | null | undefined, v: string) => k && m.set(k, [...(m.get(k) ?? []), v]);
    for (const q of quests) {
      const label = `${q.data.code ? q.data.code + ' ' : ''}${q.data.name || 'Untitled quest'}`;
      q.data.rewards?.forEach((r: { item: string | null }) => push(fromQuests, r.item, label));
      q.data.required_items?.forEach((r: { item: string }) => push(neededByQuests, r.item, label));
    }
    for (const it of items) {
      it.recipe?.ingredients.forEach((g) => push(inRecipes, g.item, it.name));
      push(taughtBy, it.teaches, it.name);
    }
    return { fromQuests, neededByQuests, inRecipes, taughtBy };
  }, [items, quests]);

  const hasSource = (it: Item) => it.sources.length > 0 || !!it.recipe || (links.fromQuests.get(it.id)?.length ?? 0) > 0 || (gd.sources.get(it.id)?.length ?? 0) > 0;
  const ueUnused = items.filter(gd.notInQuests);
  const notInUe = items.filter((i) => !i.ue_asset);
  const problems = items.filter((i) => !hasSource(i));

  // In the All tab items are grouped by category, in the order of Definitions → Item categories.
  const catIndex = (id: string | null) => {
    const i = categories.findIndex((c) => c.id === id);
    return i < 0 ? 9999 : i;
  };
  const filtered = items
    .filter((i) => (cat === 'all' ? true : i.category === cat))
    .filter((i) => !query || (i.name + ' ' + i.code + ' ' + (i.ue_asset ?? '')).toLowerCase().includes(query.toLowerCase()))
    .filter((i) => (ueFilter === 'unused' ? gd.notInQuests(i) : ueFilter === 'notInUe' ? !i.ue_asset : true))
    .filter((i) => !onlyProblems || !hasSource(i))
    .sort((a, b) => (cat === 'all' ? catIndex(a.category) - catIndex(b.category) : 0) || byOrder(a, b));

  const sel = (selId && byId.get(selId)) || filtered[0] || null;

  /** Swaps an item with its neighbour in the list as you see it (filters included). */
  const move = (it: Item, dir: -1 | 1) => {
    const idx = filtered.findIndex((x) => x.id === it.id);
    const other = filtered[idx + dir];
    if (!other || other.category !== it.category) return; // order is kept within a category
    const all = [...items].sort(byOrder);
    // Make every position unique first (older items may share the same number).
    const sorts = all.map((x) => x.sort ?? 0);
    if (new Set(sorts).size !== sorts.length) {
      all.forEach((x, n) => x.sort !== n && update('items', x.id, { sort: n }));
      const a = all.findIndex((x) => x.id === it.id);
      const b = all.findIndex((x) => x.id === other.id);
      update('items', it.id, { sort: b });
      update('items', other.id, { sort: a });
      return;
    }
    update('items', it.id, { sort: other.sort });
    update('items', other.id, { sort: it.sort });
  };

  // Alt + ↑ / ↓ moves the selected item.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !sel) return;
      e.preventDefault();
      move(sel, e.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const newItem = () => {
    const c = cat !== 'all' ? defs.get(cat) : categories[0];
    const rarity = defs.list('rarity')[0];
    const id = newId();
    insert('items', {
      id, code: (c?.extra.prefix || 'ITM_') + 'NewItem', name: 'New item', category: c?.id ?? null, rarity: rarity?.id ?? null,
      stack: parseInt(c?.extra.default_stack || '1') || 1, value: 0, weight: 0, description: '', icon_url: null, sources: [], recipe: null, teaches: null,
      sort: items.length ? Math.max(...items.map((i) => i.sort ?? 0)) + 1 : 0,
    });
    setSelId(id);
    setQuery('');
    setOnlyProblems(false);
  };

  const exportCsv = () => {
    const head = ['---', 'DisplayName', 'Category', 'Rarity', 'MaxStack', 'Value', 'Weight', 'Description', 'CraftStation', 'Ingredients', 'Teaches'];
    const lines = [head.join(',')];
    for (const it of [...items].sort(byOrder)) {
      lines.push(
        [
          it.code || enumKey(it.name),
          it.name,
          enumKey(defs.get(it.category)?.name ?? ''),
          enumKey(defs.get(it.rarity)?.name ?? ''),
          it.stack,
          it.value,
          it.weight,
          it.description,
          it.recipe ? enumKey(defs.get(it.recipe.station)?.name ?? '') : '',
          it.recipe ? it.recipe.ingredients.map((g) => `${byId.get(g.item)?.code ?? '?'}x${g.qty}`).join(';') : '',
          it.teaches ? byId.get(it.teaches)?.code ?? '' : '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    download('DT_Items.csv', lines.join('\n'), 'text/csv');
  };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <h1 style={{ fontSize: 30, marginRight: 8 }}>Items</h1>
        <label style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '0 1 280px' }}>
          <span className="sr-only">Search items</span>
          <span style={{ position: 'absolute', left: 12, color: 'var(--muted)', display: 'flex' }}>
            <Icon name="search" />
          </span>
          <input className="input" type="search" placeholder="Search by name or ID" value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 36 }} />
        </label>
        <div className="spacer" />
        {ueUnused.length > 0 && (
          <button type="button" className="btn ue-btn" aria-pressed={ueFilter === 'unused'} onClick={() => setUeFilter(ueFilter === 'unused' ? 'off' : 'unused')}
            title="Items imported from Unreal that no written quest gives or asks for">
            <span className="ue-dot" /> {ueUnused.length} from Unreal, not in questlines
          </button>
        )}
        {notInUe.length > 0 && (
          <button type="button" className="btn" aria-pressed={ueFilter === 'notInUe'} onClick={() => setUeFilter(ueFilter === 'notInUe' ? 'off' : 'notInUe')} title="Items written in the tool that have no Unreal asset yet">
            {notInUe.length} not in Unreal
          </button>
        )}
        {problems.length > 0 && (
          <button type="button" className="btn warn" aria-pressed={onlyProblems} onClick={() => setOnlyProblems(!onlyProblems)}>
            <Icon name="warn" /> {problems.length} item{problems.length === 1 ? ' has' : 's have'} no source
          </button>
        )}
        <button type="button" className="btn" onClick={exportCsv}>
          <Icon name="download" /> Export DataTable (CSV)
        </button>
        <button type="button" className="btn primary" onClick={newItem}>
          <Icon name="plus" /> New item
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
          All <span className="count">{items.length}</span>
        </button>
        {categories.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color }} />
            {c.name} <span className="count">{items.filter((i) => i.category === c.id).length}</span>
          </button>
        ))}
      </div>

      <div className="split">
        <section className="main" aria-label="Item list" style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--row)', overflow: 'auto', maxHeight: 'calc(100vh - 230px)' }}>
          <div className="irow head">
            <span>ORDER</span>
            <span>ITEM</span>
            <span>CATEGORY</span>
            <span>RARITY</span>
            <span>STACK</span>
            <span>STATION</span>
            <span>CRAFT TIME</span>
            <span>SOURCES</span>
            <span>USED IN</span>
          </div>
          {filtered.map((it, i) => {
            const c = defs.get(it.category);
            const r = defs.get(it.rarity);
            const srcCount = it.sources.length + (it.recipe ? 1 : 0) + (links.fromQuests.get(it.id)?.length ?? 0) + (gd.sources.get(it.id)?.length ?? 0);
            const useCount = (links.inRecipes.get(it.id)?.length ?? 0) + (links.neededByQuests.get(it.id)?.length ?? 0) + (gd.uses.get(it.id)?.length ?? 0);
            const newGroup = cat === 'all' && (i === 0 || filtered[i - 1].category !== it.category);
            const groupCount = newGroup ? filtered.filter((x) => x.category === it.category).length : 0;
            return (
              <Fragment key={it.id}>
              {newGroup && (
                <div className="icat-sep" role="presentation">
                  <span style={{ background: c?.color ?? '#5a544a' }} />
                  {c?.name ?? 'No category'}
                  <em>{groupCount}</em>
                </div>
              )}
              <div className={'irow' + (sel?.id === it.id ? ' sel' : '')} onClick={() => setSelId(it.id)}>
                <span className="order-cell" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="icon-btn" aria-label={'Move ' + it.name + ' up'} disabled={i === 0 || filtered[i - 1].category !== it.category} onClick={() => move(it, -1)}>
                    <Icon name="up" size={14} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={'Move ' + it.name + ' down'} disabled={i === filtered.length - 1 || filtered[i + 1].category !== it.category} onClick={() => move(it, 1)}>
                    <Icon name="down" size={14} />
                  </button>
                </span>
                <button type="button" className="irow-name" aria-pressed={sel?.id === it.id} onClick={() => setSelId(it.id)}>
                  <span className="tile" style={{ background: (c?.color ?? '#3a362f') + '33', borderColor: r?.color ?? '#3a362f' }}>
                    {it.icon_url ? <img src={it.icon_url} alt="" /> : mono(it.name)}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <strong style={{ fontSize: 14, color: '#f1ebdf' }}>{it.name || 'Untitled'}</strong>
                    <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {it.code}
                      <UeBadge item={it} gd={gd} />
                    </span>
                  </span>
                </button>
                <span style={{ color: '#d6cfc2' }}>{c?.name ?? '—'}</span>
                <span style={{ color: r?.color ?? 'var(--muted)', fontWeight: 600 }}>{r?.name ?? '—'}</span>
                <span className="muted">{it.stack}</span>
                <span style={{ color: it.recipe ? '#d6cfc2' : 'var(--muted)' }}>{it.recipe ? defs.get(it.recipe.station ?? '')?.name ?? '—' : '—'}</span>
                <span style={{ color: it.recipe?.time ? '#d6cfc2' : 'var(--muted)' }}>{it.recipe?.time || '—'}</span>
                <span style={{ color: srcCount ? 'var(--text-2)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!srcCount && <Icon name="warn" size={14} />}
                  {srcCount ? `${srcCount} source${srcCount === 1 ? '' : 's'}` : 'None'}
                </span>
                <span className="muted">{useCount ? `${useCount} place${useCount === 1 ? '' : 's'}` : '—'}</span>
              </div>
              </Fragment>
            );
          })}
          {filtered.length === 0 && <div className="empty">No items match.</div>}
        </section>

        {sel ? <ItemEditor key={sel.id} it={sel} items={items} links={links} gd={gd} hasSource={hasSource(sel)} onDeleted={() => setSelId(null)} /> : (
          <aside className="panel side"><span className="muted">No items yet. Press “New item”.</span></aside>
        )}
      </div>
    </>
  );
}

type Links = {
  fromQuests: Map<string, string[]>;
  neededByQuests: Map<string, string[]>;
  inRecipes: Map<string, string[]>;
  taughtBy: Map<string, string[]>;
};

function ItemEditor({ it, items, links, gd, hasSource, onDeleted }: { it: Item; items: Item[]; links: Links; gd: GameData; hasSource: boolean; onDeleted: () => void }) {
  const defs = useDefinitions();
  const set = (patch: Partial<Item>) => update('items', it.id, patch);
  const cat = defs.get(it.category);
  const rar = defs.get(it.rarity);
  const isBlueprint = !!it.teaches || /blueprint/i.test(cat?.name ?? '');
  const others = items.filter((x) => x.id !== it.id).sort((a, b) => a.name.localeCompare(b.name));
  const sourceTypes = defs.list('source_type');

  const setRecipe = (patch: Partial<Recipe>) => set({ recipe: { ...(it.recipe as Recipe), ...patch } });
  const usedCount = (links.inRecipes.get(it.id)?.length ?? 0) + (links.neededByQuests.get(it.id)?.length ?? 0) + (links.fromQuests.get(it.id)?.length ?? 0);

  return (
    <aside className="panel side" aria-label="Selected item">
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span className="tile" style={{ width: 76, height: 76, borderRadius: 12, fontSize: 20, background: (cat?.color ?? '#3a362f') + '33', borderColor: rar?.color ?? '#3a362f' }}>
          {it.icon_url ? <img src={it.icon_url} alt={it.name} /> : mono(it.name)}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
          <TextField value={it.name} label="Item name" onCommit={(v) => set({ name: v })} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700 }} />
          <TextField value={it.code} label="Item ID" onCommit={(v) => set({ code: v.replace(/\s+/g, '') })} style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent-text)' }} />
        </div>
      </div>

      <UeItemPanel item={it} gd={gd} />

      <div className="grid2">
        <label className="field">
          <span className="field-label">Category</span>
          <DefSelect options={defs.list('item_category')} value={it.category} onChange={(v) => set({ category: v })} label="Category" />
        </label>
        <label className="field">
          <span className="field-label">Rarity</span>
          <DefSelect options={defs.list('rarity')} value={it.rarity} onChange={(v) => set({ rarity: v })} label="Rarity" />
        </label>
      </div>
      <a href="#/definitions" style={{ fontSize: 12, fontWeight: 600, textDecoration: 'none', marginTop: -8 }}>
        Manage categories and rarities →
      </a>

      <div className="grid3">
        <label className="field">
          <span className="field-label">Stack</span>
          <TextField type="number" value={String(it.stack)} label="Stack size" onCommit={(v) => set({ stack: Math.max(1, parseInt(v) || 1) })} />
        </label>
        <label className="field">
          <span className="field-label">Value</span>
          <TextField type="number" value={String(it.value)} label="Value" onCommit={(v) => set({ value: parseInt(v) || 0 })} />
        </label>
        <label className="field">
          <span className="field-label">Weight (kg)</span>
          <TextField type="number" value={String(it.weight)} label="Weight" onCommit={(v) => set({ weight: parseFloat(v) || 0 })} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Description</span>
        <TextField multiline value={it.description} label="Description" onCommit={(v) => set({ description: v })} />
      </label>
      <label className="field">
        <span className="field-label">Icon image URL</span>
        <TextField value={it.icon_url ?? ''} label="Icon image URL" placeholder="https://… (optional)" onCommit={(v) => set({ icon_url: v.trim() || null })} />
      </label>

      {isBlueprint && (
        <div className="card-box recipe">
          <span className="section-label" style={{ color: '#b9c0f0' }}>TEACHES RECIPE</span>
          <span className="select-wrap">
            <select aria-label="Item this blueprint teaches" value={it.teaches ?? ''} onChange={(e) => set({ teaches: e.target.value || null })} style={{ paddingLeft: 10 }}>
              <option value="">— choose an item —</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}

      <div className="card-box recipe">
        <div className="list-row">
          <span className="section-label grow" style={{ color: '#b9c0f0' }}>CRAFTING RECIPE</span>
          {it.recipe ? (
            <button type="button" className="btn small" onClick={() => set({ recipe: null })}>
              Remove recipe
            </button>
          ) : (
            <button type="button" className="btn small" onClick={() => set({ recipe: { station: defs.list('station')[0]?.id ?? null, time: '', learned_from: '', ingredients: [] } })}>
              <Icon name="plus" size={14} /> Make craftable
            </button>
          )}
        </div>
        {it.recipe && (
          <>
            <div className="grid2">
              <label className="field">
                <span className="field-label">Station</span>
                <DefSelect options={defs.list('station')} value={it.recipe.station} onChange={(v) => setRecipe({ station: v })} label="Crafting station" />
              </label>
              <label className="field">
                <span className="field-label">Craft time</span>
                <TextField value={it.recipe.time} placeholder="e.g. 8 s" label="Craft time" onCommit={(v) => setRecipe({ time: v })} />
              </label>
            </div>
            {it.recipe.ingredients.map((g, i) => (
              <div key={i} className="list-row">
                <input
                  className="input"
                  type="number"
                  min={1}
                  aria-label="Quantity"
                  value={g.qty}
                  style={{ width: 70 }}
                  onChange={(e) => setRecipe({ ingredients: it.recipe!.ingredients.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x)) })}
                />
                <span className="select-wrap grow">
                  <select aria-label="Ingredient" value={g.item} style={{ paddingLeft: 10 }} onChange={(e) => setRecipe({ ingredients: it.recipe!.ingredients.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)) })}>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </span>
                <button type="button" className="icon-btn danger" aria-label="Remove ingredient" onClick={() => setRecipe({ ingredients: it.recipe!.ingredients.filter((_, j) => j !== i) })}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} disabled={!others.length} onClick={() => setRecipe({ ingredients: [...it.recipe!.ingredients, { item: others[0].id, qty: 1 }] })}>
              <Icon name="plus" size={14} /> Add ingredient
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              Learned from: {links.taughtBy.get(it.id)?.join(', ') || 'known from the start'}
            </span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="section-label">HOW TO GET IT</span>
        {it.sources.map((s, i) => (
          <div key={i} className="list-row">
            <DefSelect className="" options={sourceTypes} value={s.type} label="Source type" onChange={(v) => set({ sources: it.sources.map((x, j) => (j === i ? { ...x, type: v ?? '' } : x)) })} />
            <TextField value={s.text} placeholder="Details, e.g. Rust Rats (25%)" label="Source details" onCommit={(v) => set({ sources: it.sources.map((x, j) => (j === i ? { ...x, text: v } : x)) })} />
            <button type="button" className="icon-btn danger" aria-label="Remove source" onClick={() => set({ sources: it.sources.filter((_, j) => j !== i) })}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        {it.recipe && <AutoRow tag="CRAFTED" color="#b9c0f0" text={`${defs.get(it.recipe.station)?.name ?? 'Crafting'} recipe`} />}
        {links.fromQuests.get(it.id)?.map((q) => <AutoRow key={q} tag="QUEST REWARD" color="#e6bd7d" text={q} />)}
        {gd.sources.get(it.id)?.map((l, i) => <AutoRow key={'ue' + i} tag={l.tag} color={l.color} text={l.text} href={l.href} />)}
        {!hasSource && (
          <div className="warn-box">
            <Icon name="warn" /> Nothing in the game gives this item yet
          </div>
        )}
        <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ sources: [...it.sources, { type: sourceTypes[0]?.id ?? '', text: '' }] })}>
          <Icon name="plus" size={14} /> Add source
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="section-label">USED IN</span>
        {links.inRecipes.get(it.id)?.map((n) => <AutoRow key={'r' + n} tag="RECIPE" color="#b9c0f0" text={n} />)}
        {links.neededByQuests.get(it.id)?.map((n) => <AutoRow key={'q' + n} tag="QUEST NEEDS" color="#9ccbe3" text={n} href="#/quests" />)}
        {gd.uses.get(it.id)?.map((l, i) => <AutoRow key={'ueu' + i} tag={l.tag} color={l.color} text={l.text} href={l.href} />)}
        {!links.inRecipes.get(it.id) && !links.neededByQuests.get(it.id) && !gd.uses.get(it.id) && <span className="muted" style={{ fontSize: 13 }}>Not used anywhere yet</span>}
      </div>

      <button
        type="button"
        className="btn warn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          const msg = usedCount ? `"${it.name}" is used by ${usedCount} recipe(s) or quest(s). Delete anyway?` : `Delete "${it.name}"?`;
          if (confirm(msg)) {
            remove('items', it.id);
            onDeleted();
          }
        }}
      >
        <Icon name="trash" /> Delete item
      </button>
    </aside>
  );
}

function AutoRow({ tag, color, text, href }: { tag: string; color: string; text: string; href?: string }) {
  const body = (
    <>
      <span className="tag" style={{ color, background: color + '26', minWidth: 96, justifyContent: 'center' }}>
        {tag}
      </span>
      <span style={{ fontSize: 13 }}>{text}</span>
    </>
  );
  const style = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, background: 'var(--panel-2)', color: 'var(--text)', textDecoration: 'none' } as const;
  return href ? (
    <a href={href} style={style}>
      {body}
    </a>
  ) : (
    <div style={style}>{body}</div>
  );
}
