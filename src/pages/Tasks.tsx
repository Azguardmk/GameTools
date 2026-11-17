import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { insert, newId, remove, snapshot, update, useTable } from '../lib/db';
import { useDefinitions, useMembers } from '../lib/hooks';
import type { Definition, Task, TaskGroup } from '../lib/types';
import { DefSelect, Icon, MemberBadge, SwatchPicker, TextField } from '../components/ui';

export default function TasksPage() {
  const { rows: groupsRaw } = useTable<TaskGroup>('task_groups');
  const { rows: tasks } = useTable<Task>('tasks');
  const defs = useDefinitions();
  const members = useMembers();
  const [who, setWho] = useState<string>('all');
  const [hideDone, setHideDone] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#6fb3d6');

  const groups = useMemo(() => [...groupsRaw].sort((a, b) => a.sort - b.sort), [groupsRaw]);
  const doneCount = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const priorities = defs.list('task_priority');
  const statuses = defs.list('task_status');

  const visible = (t: Task) => {
    if (hideDone && t.done) return false;
    if (who === 'all') return true;
    if (who === 'none') return t.assignees.length === 0;
    return t.assignees.includes(who);
  };

  const addTask = (g: TaskGroup) => {
    const inGroup = tasks.filter((t) => t.group_id === g.id);
    insert('tasks', {
      id: newId(), group_id: g.id, title: '', notes: '', assignees: who !== 'all' && who !== 'none' ? [who] : [], priority: priorities[1]?.id ?? priorities[0]?.id ?? null,
      status: statuses[0]?.id ?? null, done: false, done_by: null, done_at: null,
      sort: inGroup.length ? Math.max(...inGroup.map((t) => t.sort)) + 1 : 0,
    });
    if (g.collapsed) update('task_groups', g.id, { collapsed: false });
  };

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    insert('task_groups', { id: newId(), name, color: newGroupColor, sort: groups.length ? Math.max(...groups.map((g) => g.sort)) + 1 : 0, collapsed: false });
    setNewGroup('');
    setAddingGroup(false);
  };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <h1 style={{ fontSize: 30 }}>Task Board</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)' }}>
            <span>Overall progress</span>
            <strong style={{ color: 'var(--text)' }}>
              {doneCount} of {tasks.length} done
            </strong>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: '#2a2723', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>
          Show tasks for
        </span>
        <button type="button" className="chip" aria-pressed={who === 'all'} onClick={() => setWho('all')}>
          Everyone
        </button>
        {members.list.map((m) => (
          <button key={m.id} type="button" className="chip" aria-pressed={who === m.id} onClick={() => setWho(m.id)} style={{ paddingLeft: 5 }}>
            <MemberBadge m={m} size={24} />
            {m.name}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={who === 'none'} onClick={() => setWho('none')}>
          Unassigned
        </button>
        <div className="spacer" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
          Hide completed
        </label>
      </div>

      <div className="board">
        <div className="trow head">
          <div className="c-num" style={{ justifyContent: 'flex-end', paddingRight: 4 }}>
            #
          </div>
          <div className="c-done" style={{ justifyContent: 'center' }}>
            DONE
          </div>
          <div className="c-title">TASK</div>
          <div>NOTES</div>
          <div>ASSIGNED TO</div>
          <div>PRIORITY</div>
          <div>STATUS</div>
          <div />
        </div>

        {groups.map((g) => {
          const all = tasks.filter((t) => t.group_id === g.id).sort((a, b) => a.sort - b.sort);
          const shown = all.filter(visible);
          return (
            <div key={g.id}>
              <div className="ghead">
                <div className="ghead-inner">
                <button type="button" className="gbtn" aria-expanded={!g.collapsed} onClick={() => update('task_groups', g.id, { collapsed: !g.collapsed })}>
                  <span style={{ display: 'inline-flex', transform: g.collapsed ? 'none' : 'rotate(90deg)', color: 'var(--muted)' }}>
                    <Icon name="chevron" size={14} />
                  </span>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: g.color }} />
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{g.name}</span>
                  <span className="count">
                    {all.filter((t) => t.done).length}/{all.length}
                  </span>
                </button>
                <button type="button" className="btn ghost small" onClick={() => addTask(g)}>
                  <Icon name="plus" size={14} /> Task
                </button>
                <GroupMenu group={g} taskCount={all.length} />
                </div>
              </div>
              {!g.collapsed && (
                <>
                  {shown.map((t) => (
                    <TaskRow key={t.id} t={t} n={all.indexOf(t) + 1} groupColor={g.color} priorities={priorities} statuses={statuses} members={members} />
                  ))}
                  {shown.length === 0 && (
                    <div className="empty" style={{ paddingLeft: 116, minWidth: 1124 }}>
                      {all.length === 0 ? 'No tasks in this group yet.' : 'No tasks match this filter.'}
                    </div>
                  )}
                  <button type="button" className="add-row" onClick={() => addTask(g)} aria-label={'Add a task to ' + g.name}>
                    <span className="add-row-inner">
                      <Icon name="plus" size={14} /> Add task
                    </span>
                  </button>
                </>
              )}
            </div>
          );
        })}

        <div style={{ padding: 12, minWidth: 1124, background: 'var(--row)' }}>
          {addingGroup ? (
            <div style={{ position: 'sticky', left: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, maxWidth: 820 }}>
              <SwatchPicker value={newGroupColor} onChange={setNewGroupColor} label="Group colour" />
              <input
                className="input"
                style={{ flex: '1 1 200px', width: 'auto' }}
                autoFocus
                placeholder="Theme name, e.g. Audio, UI, Characters"
                aria-label="Theme group name"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              />
              <button type="button" className="btn primary" onClick={addGroup}>
                Add group
              </button>
              <button type="button" className="btn" onClick={() => setAddingGroup(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn" style={{ position: 'sticky', left: 12, borderStyle: 'dashed', color: 'var(--accent-text)' }} onClick={() => setAddingGroup(true)}>
              <Icon name="plus" /> Add new theme group
            </button>
          )}
        </div>
      </div>
    </>
  );
}

type Members = ReturnType<typeof useMembers>;

function TaskRow({ t, n, groupColor, priorities, statuses, members }: { t: Task; n: number; groupColor: string; priorities: Definition[]; statuses: Definition[]; members: Members }) {
  return (
    <div className={'trow' + (t.done ? ' done' : '')}>
      <div className="c-num" style={{ borderLeft: '3px solid ' + groupColor }}>
        {n}
      </div>
      <div className="c-done">
        <label className="check">
          <input
            type="checkbox"
            checked={t.done}
            aria-label={(t.done ? 'Mark not done: ' : 'Mark done: ') + (t.title || 'untitled task')}
            onChange={(e) =>
              update('tasks', t.id, { done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null })
            }
          />
        </label>
      </div>
      <div className="c-title">
        <TextField className="input bare" value={t.title} onCommit={(v) => update('tasks', t.id, { title: v })} placeholder="Task name" label="Task name" autoFocus={!t.title} style={{ fontWeight: 500 }} />
      </div>
      <div className="cell fade">
        <TextField className="input bare" value={t.notes} onCommit={(v) => update('tasks', t.id, { notes: v })} placeholder="Add notes" label="Notes" style={{ color: 'var(--muted)', fontSize: 13 }} />
      </div>
      <div className="cell fade">
        <AssigneePicker t={t} members={members} />
      </div>
      <div className="cell fade">
        <DefSelect className="bare" options={priorities} value={t.priority} onChange={(v) => update('tasks', t.id, { priority: v })} label="Priority" />
      </div>
      <div className="cell fade">
        {t.done ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, color: '#b2d69e', fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#8fbf74' }} /> Done
          </span>
        ) : (
          <DefSelect className="bare" options={statuses} value={t.status} onChange={(v) => update('tasks', t.id, { status: v })} label="Status" />
        )}
      </div>
      <div className="cell" style={{ padding: 0 }}>
        <button type="button" className="icon-btn danger" aria-label={'Delete task ' + t.title} onClick={() => confirm('Delete this task?') && remove('tasks', t.id)}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

function AssigneePicker({ t, members }: { t: Task; members: Members }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // The menu is drawn on top of the whole page (outside the table) so nothing shows through it.
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const height = Math.min(members.list.length * 40 + 12, 320);
    const below = r.bottom + 4 + height <= window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), left: Math.min(r.left, window.innerWidth - 240) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!menu.current?.contains(n) && !btn.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const people = t.assignees.map((id) => members.get(id)).filter(Boolean) as ReturnType<typeof members.get>[];
  return (
    <>
      <button ref={btn} type="button" className="assignees" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {people.length === 0 ? (
          <span className="unassigned">Unassigned</span>
        ) : (
          <>
            <span className="stack">{people.map((m) => m && <MemberBadge key={m.id} m={m} />)}</span>
            <span style={{ marginLeft: 8, fontSize: 13, color: '#d6cfc2' }}>{people.length === 1 ? people[0]!.name : people.length + ' people'}</span>
          </>
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={menu} className="popover" role="group" aria-label="Assign people" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
            {members.list.map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={t.assignees.includes(m.id)}
                  onChange={(e) =>
                    update('tasks', t.id, {
                      assignees: e.target.checked ? [...t.assignees, m.id] : t.assignees.filter((x) => x !== m.id),
                    })
                  }
                />
                <MemberBadge m={m} size={24} />
                {m.name}
              </label>
            ))}
            {members.list.length === 0 && <span className="empty">Add team members on the Definitions page.</span>}
          </div>,
          document.body,
        )}
    </>
  );
}

async function deleteGroup(id: string) {
  const ids = snapshot<Task>('tasks').filter((t) => t.group_id === id).map((t) => t.id);
  if (ids.length) await remove('tasks', ids);
  await remove('task_groups', id);
}

function GroupMenu({ group, taskCount }: { group: TaskGroup; taskCount: number }) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <button type="button" className="btn ghost small" style={{ color: 'var(--muted)' }} onClick={() => setEditing(true)}>
        Edit group
      </button>
    );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <TextField value={group.name} onCommit={(v) => v.trim() && update('task_groups', group.id, { name: v.trim() })} label="Group name" style={{ width: 200 }} />
      <SwatchPicker value={group.color} onChange={(c) => update('task_groups', group.id, { color: c })} label="Group colour" />
      <button
        type="button"
        className="btn small warn"
        onClick={() => confirm(taskCount ? `Delete "${group.name}" and its ${taskCount} tasks?` : `Delete "${group.name}"?`) && deleteGroup(group.id)}
      >
        Delete group
      </button>
      <button type="button" className="btn small" onClick={() => setEditing(false)}>
        Done
      </button>
    </div>
  );
}
