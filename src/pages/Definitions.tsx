import { useMemo, useState } from 'react';
import { insert, newId, remove, update, useTable } from '../lib/db';
import { download, useDefinitions, useMembers } from '../lib/hooks';
import { LISTS, enumKey, type Definition, type Item, type ListKey, type QuestNode, type Task } from '../lib/types';
import { DefSelect, Icon, SwatchPicker, TextField } from '../components/ui';

type View = ListKey | 'members';

export default function DefinitionsPage() {
  const [view, setView] = useState<View>('item_category');
  const defs = useDefinitions();
  const members = useMembers();
  const usage = useUsage();

  const groups: { name: string; items: { key: View; title: string; n: number }[] }[] = [
    { name: 'TEAM', items: [{ key: 'members', title: 'Team members', n: members.list.length }] },
    ...(['World', 'Player factions', 'Items', 'Quests', 'Tasks'] as const).map((g) => ({
      name: g.toUpperCase(),
      items: LISTS.filter((l) => l.group === g).map((l) => ({ key: l.key as View, title: l.title, n: defs.list(l.key).length })),
    })),
  ];

  const exportAll = () => {
    const out: Record<string, unknown> = {};
    for (const l of LISTS) {
      out[l.enumName] = defs.list(l.key).map((d) => {
        const extra: Record<string, string> = { ...d.extra };
        // Fields that point at another list are exported as that entry's enum key.
        l.extras.filter((x) => x.ref).forEach((x) => (extra[x.key] = extra[x.key] ? enumKey(defs.get(extra[x.key])?.name ?? '') : ''));
        return { key: enumKey(d.name), name: d.name, color: d.color, ...extra };
      });
    }
    download('earthlings-definitions.json', JSON.stringify(out, null, 2), 'application/json');
  };

  return (
    <div className="split">
      <nav className="panel lists-nav" aria-label="Lists">
        {groups.map((g) => (
          <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ padding: '0 10px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--muted)' }}>{g.name}</span>
            {g.items.map((it) => (
              <button key={it.key} type="button" aria-current={view === it.key ? 'page' : undefined} onClick={() => setView(it.key)}>
                {it.title}
                <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                  {it.n}
                </span>
              </button>
            ))}
          </div>
        ))}
        <button type="button" className="btn small" style={{ justifyContent: 'center', color: 'var(--text)' }} onClick={exportAll}>
          <Icon name="download" size={14} /> Export all lists (JSON)
        </button>
      </nav>
      <section className="main" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {view === 'members' ? <MembersEditor usage={usage} /> : <ListEditor key={view} listKey={view} usage={usage} />}
      </section>
    </div>
  );
}

/** How many things use each definition / member id. */
function useUsage() {
  const { rows: items } = useTable<Item>('items');
  const { rows: nodes } = useTable<QuestNode>('quest_nodes');
  const { rows: tasks } = useTable<Task>('tasks');
  const { rows: defRows } = useTable<Definition>('definitions');
  return useMemo(() => {
    const m = new Map<string, number>();
    const add = (id: string | null | undefined) => id && m.set(id, (m.get(id) ?? 0) + 1);
    for (const it of items) {
      add(it.category);
      add(it.rarity);
      it.sources?.forEach((s) => add(s.type));
      add(it.recipe?.station);
    }
    for (const n of nodes) {
      if (n.kind === 'dialogue') add(n.data.speaker);
      if (n.kind === 'condition' || n.kind === 'action') add(n.data.variable);
      if (n.kind !== 'quest') continue;
      const d = n.data;
      add(d.type);
      add(d.region);
      add(d.district);
      add(d.status);
      add(d.assignee);
      add(d.giver_id);
      d.objectives?.forEach((o: { type: string }) => add(o.type));
      d.rewards?.forEach((r: { type: string }) => add(r.type));
    }
    for (const d of defRows) {
      if (d.list === 'district') add(d.extra?.region);
      if (d.list === 'character') add(d.extra?.district);
    }
    for (const t of tasks) {
      add(t.priority);
      add(t.status);
      t.assignees.forEach(add);
    }
    return m;
  }, [items, nodes, tasks, defRows]);
}

function ListEditor({ listKey, usage }: { listKey: ListKey; usage: Map<string, number> }) {
  const meta = LISTS.find((l) => l.key === listKey)!;
  const defs = useDefinitions();
  const rows = defs.list(listKey);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6fb3d6');

  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (rows.some((r) => r.name.toLowerCase() === n.toLowerCase())) return alert(`"${n}" is already in this list.`);
    const extra: Record<string, string> = {};
    meta.extras.forEach((x) => (extra[x.key] = x.options ? x.options[0] : ''));
    insert('definitions', { id: newId(), list: listKey, name: n, color, sort: rows.length ? Math.max(...rows.map((r) => r.sort)) + 1 : 0, extra });
    setName('');
  };

  const move = (i: number, dir: -1 | 1) => {
    const a = rows[i];
    const b = rows[i + dir];
    if (!a || !b) return;
    update('definitions', a.id, { sort: b.sort });
    update('definitions', b.id, { sort: a.sort === b.sort ? a.sort + dir : a.sort });
  };

  const cols = `74px 64px minmax(180px, 1.4fr) minmax(140px, 1fr) ${meta.extras.map((x) => (x.ref ? '170px' : x.options ? '130px' : '120px')).join(' ')} 110px 48px`;

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 26 }}>{meta.title}</h1>
          <span className="muted" style={{ fontSize: 13 }}>
            {meta.description}
          </span>
        </div>
        <span style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--panel-2)', border: '1px solid var(--line)', fontSize: 12, color: 'var(--text-2)' }}>
          Exports to Unreal as <strong style={{ color: 'var(--accent-text)' }}>{meta.enumName}</strong>
        </span>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--row)', overflow: 'auto' }}>
        <div className="drow head" style={{ gridTemplateColumns: cols }}>
          <div>ORDER</div>
          <div>COLOR</div>
          <div>NAME</div>
          <div>UE ENUM KEY</div>
          {meta.extras.map((x) => (
            <div key={x.key}>{x.label.toUpperCase()}</div>
          ))}
          <div>USED BY</div>
          <div />
        </div>
        {rows.map((r, i) => {
          const used = usage.get(r.id) ?? 0;
          return (
            <div key={r.id} className="drow" style={{ gridTemplateColumns: cols }}>
              <span className="cell" style={{ display: 'flex' }}>
                <button type="button" className="icon-btn" aria-label={'Move ' + r.name + ' up'} disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </button>
                <button type="button" className="icon-btn" aria-label={'Move ' + r.name + ' down'} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </button>
              </span>
              <span className="cell">
                <label className="color-btn" style={{ background: r.color }} title="Change colour">
                  <input type="color" value={r.color} aria-label={'Colour of ' + r.name} onChange={(e) => update('definitions', r.id, { color: e.target.value })} />
                </label>
              </span>
              <span className="cell">
                <TextField
                  className="input bare"
                  value={r.name}
                  label={'Name of ' + r.name}
                  style={{ fontWeight: 600, color: listKey === 'rarity' ? r.color : '#f1ebdf' }}
                  onCommit={(v) => v.trim() && update('definitions', r.id, { name: v.trim() })}
                />
              </span>
              <span className="cell" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-2)', paddingLeft: 14 }}>
                {enumKey(r.name)}
              </span>
              {meta.extras.map((x) => (
                <span key={x.key} className="cell">
                  {x.options ? (
                    <span className="select-wrap bare">
                      <select
                        aria-label={x.label + ' of ' + r.name}
                        value={r.extra?.[x.key] || x.options[0]}
                        style={{ paddingLeft: 10 }}
                        onChange={(e) => update('definitions', r.id, { extra: { ...r.extra, [x.key]: e.target.value } })}
                      >
                        {x.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </span>
                  ) : x.ref ? (
                    <DefSelect
                      className="bare"
                      options={defs.list(x.ref)}
                      value={r.extra?.[x.key] || null}
                      allowEmpty
                      label={x.label + ' of ' + r.name}
                      onChange={(v) => update('definitions', r.id, { extra: { ...r.extra, [x.key]: v ?? '' } })}
                    />
                  ) : (
                  <TextField
                    className="input bare"
                    value={r.extra?.[x.key] ?? ''}
                    placeholder={x.placeholder}
                    label={x.label + ' of ' + r.name}
                    onCommit={(v) => update('definitions', r.id, { extra: { ...r.extra, [x.key]: v } })}
                  />
                  )}
                </span>
              ))}
              <span className="cell" style={{ color: used ? 'var(--text-2)' : 'var(--faint)', paddingLeft: 14 }}>
                {used ? `${used} use${used === 1 ? '' : 's'}` : 'Not used'}
              </span>
              <span className="cell" style={{ padding: 0 }}>
                <button
                  type="button"
                  className="icon-btn danger"
                  disabled={used > 0}
                  title={used > 0 ? 'In use, so it can’t be deleted. Move what uses it to another entry first.' : 'Delete'}
                  aria-label={'Delete ' + r.name}
                  onClick={() => confirm(`Delete "${r.name}"?`) && remove('definitions', r.id)}
                >
                  <Icon name="trash" />
                </button>
              </span>
            </div>
          );
        })}
        {rows.length === 0 && <div className="empty">This list is empty. Add the first entry below.</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--panel)' }}>
          <SwatchPicker value={color} onChange={setColor} label="Colour for new entry" />
          <input
            className="input"
            style={{ flex: '1 1 200px', width: 'auto' }}
            placeholder={'New entry in ' + meta.title.toLowerCase()}
            aria-label="New entry name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button type="button" className="btn primary" onClick={add}>
            Add
          </button>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
        The order here is the order in every dropdown. Renaming an entry updates everything that uses it. Entries in use can't be deleted.
      </div>
    </>
  );
}

function MembersEditor({ usage }: { usage: Map<string, number> }) {
  const members = useMembers();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6fb3d6');
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const initials = n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || n.slice(0, 2).toUpperCase();
    insert('members', { id: newId(), name: n, initials, color, email: null, sort: members.list.length });
    setName('');
  };
  const cols = '64px minmax(160px, 1fr) 90px minmax(200px, 1.2fr) 110px 48px';
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ fontSize: 26 }}>Team members</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          People who can be assigned to tasks and quests. To let someone sign in, also invite their email in Supabase (see README).
        </span>
      </div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--row)', overflow: 'auto' }}>
        <div className="drow head" style={{ gridTemplateColumns: cols }}>
          <div>COLOR</div>
          <div>NAME</div>
          <div>INITIALS</div>
          <div>EMAIL</div>
          <div>ASSIGNED</div>
          <div />
        </div>
        {members.list.map((m) => {
          const used = usage.get(m.id) ?? 0;
          return (
            <div key={m.id} className="drow" style={{ gridTemplateColumns: cols }}>
              <span className="cell">
                <label className="color-btn" style={{ background: m.color }}>
                  <input type="color" value={m.color} aria-label={'Colour of ' + m.name} onChange={(e) => update('members', m.id, { color: e.target.value })} />
                </label>
              </span>
              <span className="cell">
                <TextField className="input bare" value={m.name} label="Name" style={{ fontWeight: 600 }} onCommit={(v) => v.trim() && update('members', m.id, { name: v.trim() })} />
              </span>
              <span className="cell">
                <TextField className="input bare" value={m.initials} label="Initials" onCommit={(v) => v.trim() && update('members', m.id, { initials: v.trim().slice(0, 3).toUpperCase() })} />
              </span>
              <span className="cell">
                <TextField className="input bare" value={m.email ?? ''} label="Email" placeholder="name@example.com" type="email" onCommit={(v) => update('members', m.id, { email: v.trim() || null })} />
              </span>
              <span className="cell" style={{ color: used ? 'var(--text-2)' : 'var(--faint)', paddingLeft: 14 }}>
                {used ? `${used} item${used === 1 ? '' : 's'}` : 'Nothing'}
              </span>
              <span className="cell" style={{ padding: 0 }}>
                <button type="button" className="icon-btn danger" disabled={used > 0} title={used ? 'Unassign them first' : 'Remove'} aria-label={'Remove ' + m.name} onClick={() => confirm(`Remove ${m.name}?`) && remove('members', m.id)}>
                  <Icon name="trash" />
                </button>
              </span>
            </div>
          );
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--panel)' }}>
          <SwatchPicker value={color} onChange={setColor} label="Badge colour" />
          <input className="input" style={{ flex: '1 1 200px', width: 'auto' }} placeholder="Name" aria-label="New member name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button type="button" className="btn primary" onClick={add}>
            Add member
          </button>
        </div>
      </div>
    </>
  );
}

export type { Definition };
