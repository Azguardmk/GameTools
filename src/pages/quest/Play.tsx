import { useEffect, useMemo, useState } from 'react';
import type { Definition, Item, QuestData, QuestEdge, QuestNode } from '../../lib/types';
import { Icon } from '../../components/ui';
import { ACTION_OPS, DONE_HANDLE, OUTCOMES, rewardText, choiceMode, choiceOptions, conditionChecks, conditionIsAutomatic, conditionText, evaluateCondition, formatValue, parseValue, questLabel, varType, type Ctx, type VarValue } from './shared';

/*
 * Play mode: walk through a quest chain like a player would.
 * Conditions on variables and “Set variable” nodes run by themselves;
 * dialogue, choices and quests wait for you to pick what happens next.
 */

type Option = { label: string; target: string | null; onPick?: () => void; disabled?: boolean; done?: boolean };
type LogEntry = { text: string; tone?: 'muted' | 'yes' | 'no' | 'set' };

export default function PlayMode(props: {
  chainName: string;
  startId: string | null;
  nodes: QuestNode[]; // this chain's nodes
  edges: QuestEdge[]; // this chain's edges
  allNodes: Map<string, QuestNode>;
  defs: Ctx['defs'];
  itemsById: Map<string, Item>;
  onClose: (lastNode: string | null) => void;
}) {
  const { nodes, edges, defs } = props;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const variables = defs.list('variable');

  const initialVars = () => {
    const v: Record<string, VarValue> = {};
    variables.forEach((d) => (v[d.id] = parseValue(varType(d), d.extra?.default)));
    return v;
  };

  const [vars, setVars] = useState<Record<string, VarValue>>(initialVars);
  const [current, setCurrent] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [questDone, setQuestDone] = useState(false);
  // For “Do all” choices: which options the player has finished, per node.
  const [doneOpts, setDoneOpts] = useState<Record<string, string[]>>({});

  const outs = (id: string) => edges.filter((e) => e.source === id);

  /** Runs automatic nodes (conditions on variables, set-variable) until something needs the player. */
  const advance = (id: string | null, v: Record<string, VarValue>, entries: LogEntry[]) => {
    let at = id;
    for (let guard = 0; at && guard < 200; guard++) {
      const n = byId.get(at);
      if (!n) break;
      if (n.kind === 'action') {
        const d = defs.get(n.data.variable);
        if (d) {
          const t = varType(d);
          const before = v[d.id];
          let after: VarValue = before;
          if (n.data.op === 'toggle') after = !before;
          else if (n.data.op === 'add') after = Number(before) + Number(parseValue('Integer', n.data.value));
          else if (n.data.op === 'subtract') after = Number(before) - Number(parseValue('Integer', n.data.value));
          else after = parseValue(t, n.data.value);
          v = { ...v, [d.id]: after };
          entries = [...entries, { text: `${d.name}: ${formatValue(before)} → ${formatValue(after)}`, tone: 'set' }];
        }
        at = outs(n.id)[0]?.target ?? null;
        if (!at) entries = [...entries, { text: 'Stopped: nothing after this “Set variable”.', tone: 'no' }];
        continue;
      }
      if (n.kind === 'condition' && n.data.variable && conditionIsAutomatic(n, defs)) {
        const ok = evaluateCondition(n, defs, v);
        const now = [...new Set(conditionChecks(n).map((c) => c.variable!))].map((id) => `${defs.get(id)!.name} is ${formatValue(v[id])}`).join(', ');
        entries = [...entries, { text: `If ${conditionText(n, defs)} → ${ok ? 'Yes' : 'No'} (${now})`, tone: ok ? 'yes' : 'no' }];
        const e = outs(n.id).find((x) => (ok ? x.source_handle !== 'no' : x.source_handle === 'no'));
        at = e?.target ?? null;
        if (!at) entries = [...entries, { text: `Stopped: nothing connected to “${ok ? 'Yes' : 'No'}”.`, tone: 'no' }];
        continue;
      }
      if (n.kind === 'note') {
        at = null;
        continue;
      }
      if (n.kind === 'reroute') {
        at = outs(n.id)[0]?.target ?? null;
        continue;
      }
      break;
    }
    setVars(v);
    setLog(entries);
    setCurrent(at);
    setQuestDone(false);
  };

  const restart = () => {
    setCompleted(new Set());
    setDoneOpts({});
    advance(props.startId, initialVars(), [{ text: 'Started', tone: 'muted' }]);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(restart, []);

  const go = (target: string | null, note?: string) => {
    const entries = note ? [...log, { text: note }] : log;
    if (!target) {
      setLog([...entries, { text: 'Stopped: this path is not connected to anything.', tone: 'no' }]);
      setCurrent(null);
      return;
    }
    advance(target, vars, entries);
  };

  const n = current ? byId.get(current) : undefined;
  const next = n ? outs(n.id) : [];
  const targetName = (id: string) => {
    let t = byId.get(id);
    for (let i = 0; t?.kind === 'reroute' && i < 100; i++) t = byId.get(outs(t.id)[0]?.target ?? '');
    if (!t) return 'Continue';
    if (t.kind === 'quest') return 'Go to quest: ' + questLabel(t);
    if (t.kind === 'end') return 'End: ' + (OUTCOMES.find((o) => o.key === t.data.outcome)?.label ?? 'Success');
    return 'Continue';
  };

  let body: React.ReactNode = null;
  let options: Option[] = [];

  if (!props.startId) {
    body = <p className="muted">Add a Start node to this chain (or select a node) to play it.</p>;
  } else if (!n) {
    body = (
      <p className="muted" style={{ lineHeight: 1.6 }}>
        The path stopped here. Check the log on the right, then fix the missing connection in the editor.
      </p>
    );
  } else if (n.kind === 'start') {
    body = <p style={{ fontSize: 16 }}>{n.data.text || 'The chain begins.'}</p>;
    options = next.map((e) => ({ label: e.label || targetName(e.target), target: e.target }));
  } else if (n.kind === 'dialogue') {
    const sp = defs.get(n.data.speaker);
    body = (
      <>
        <span style={{ fontWeight: 700, fontSize: 14, color: sp?.color ?? 'var(--muted)' }}>{sp?.name ?? 'Someone'}</span>
        <p style={{ fontSize: 18, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{n.data.text || '…'}</p>
      </>
    );
    options = next.map((e) => ({ label: e.label ? '“' + e.label + '”' : targetName(e.target), target: e.target }));
  } else if (n.kind === 'choice') {
    body = <p style={{ fontSize: 18, margin: 0 }}>{n.data.text || 'Make a choice'}</p>;
    const opts = choiceOptions(n);
    const mode = choiceMode(n);
    if (mode !== 'pick') {
      const finished = doneOpts[n.id] ?? [];
      const nextIndex = opts.findIndex((o) => !finished.includes(o.id));
      const choiceNode = n;
      body = (
        <>
          <p style={{ fontSize: 18, margin: 0 }}>{n.data.text || 'Do all of these'}</p>
          <span className="muted" style={{ fontSize: 13 }}>
            {finished.length} of {opts.length} done{mode === 'order' ? ' · in order' : ''}
          </span>
        </>
      );
      if (nextIndex < 0) {
        const exit = next.find((e) => e.source_handle === DONE_HANDLE);
        options = [{ label: '✓ All done → ' + (exit ? targetName(exit.target) : 'not connected'), target: exit?.target ?? null }];
      } else {
        options = opts.map((o, i) => {
          const isDone = finished.includes(o.id);
          const locked = mode === 'order' && i > nextIndex;
          const target = next.find((e) => e.source_handle === o.id)?.target ?? null;
          return {
            label: (o.text || 'Option ' + (i + 1)) + (isDone ? ' · done' : locked ? ' · do the steps above first' : ''),
            target,
            disabled: isDone || locked,
            done: isDone,
            onPick: () => {
              setDoneOpts({ ...doneOpts, [choiceNode.id]: [...finished, o.id] });
              go(target, `→ ${o.text || 'Option ' + (i + 1)} (${finished.length + 1}/${opts.length})`);
            },
          };
        });
      }
    } else
    options = opts.length
      ? opts.map((o, i) => ({ label: o.text || 'Option ' + (i + 1), target: next.find((e) => e.source_handle === o.id)?.target ?? null }))
      : next.map((e) => ({ label: e.label || targetName(e.target), target: e.target }));
  } else if (n.kind === 'condition') {
    body = (
      <>
        <span className="section-label">CONDITION</span>
        <p style={{ fontSize: 16, margin: 0 }}>{n.data.text || 'No rule written'}</p>
        <span className="muted" style={{ fontSize: 13 }}>This condition isn’t tied to a variable, so you decide.</span>
      </>
    );
    const yes = next.find((e) => e.source_handle !== 'no');
    const no = next.find((e) => e.source_handle === 'no');
    options = [
      { label: 'Yes, it’s true', target: yes?.target ?? null },
      { label: 'No', target: no?.target ?? null },
    ];
  } else if (n.kind === 'external') {
    const ref = props.allNodes.get(n.data.ref);
    body = (
      <>
        <span className="section-label">NEEDS A QUEST FROM ANOTHER CHAIN</span>
        <p style={{ fontSize: 16, margin: 0 }}>{questLabel(ref)}</p>
      </>
    );
    options = [
      { label: 'The player has finished it', target: next[0]?.target ?? null },
      { label: 'Not yet (stop here)', target: null },
    ];
  } else if (n.kind === 'quest') {
    const d = n.data as QuestData;
    const giver = defs.get(d.giver_id);
    body = (
      <>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-text)' }}>
          {d.code} · {defs.get(d.type)?.name ?? 'Quest'}
          {d.level ? ' · Lv ' + d.level : ''}
        </span>
        <h2 style={{ fontSize: 24 }}>{d.name || 'Untitled quest'}</h2>
        {!questDone ? (
          <>
            {d.dialogue?.start && (
              <Speech who={giver} text={d.dialogue.start} />
            )}
            {d.description && <p className="muted" style={{ margin: 0 }}>{d.description}</p>}
            {d.objectives?.length > 0 && (
              <div className="card-box">
                <span className="section-label">OBJECTIVES</span>
                {d.objectives.map((o, i) => (
                  <span key={i} style={{ fontSize: 14 }}>
                    ☐ {defs.get(o.type)?.name ?? ''} {o.text} {o.count > 1 ? '×' + o.count : ''}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {d.dialogue?.complete && <Speech who={giver} text={d.dialogue.complete} />}
            {d.rewards?.length > 0 && (
              <div className="card-box">
                <span className="section-label">REWARDS</span>
                {d.rewards.map((r, i) => (
                  <span key={i} style={{ fontSize: 14 }}>
                    {defs.get(r.type)?.name}: {r.item ? props.itemsById.get(r.item)?.name + ' ' : ''}
                    {r.amount !== 1 || !r.item ? r.amount : ''} {r.text}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </>
    );
    options = !questDone
      ? [
          {
            label: 'Accept and complete the quest',
            target: null,
            onPick: () => {
              setQuestDone(true);
              setCompleted(new Set([...completed, n.id]));
              setLog([...log, { text: `Completed ${questLabel(n)}`, tone: 'yes' }]);
            },
          },
        ]
      : next.length
        ? next.map((e) => ({ label: e.label || targetName(e.target), target: e.target }))
        : [{ label: 'Nothing comes after this quest (stop)', target: null }];
  } else if (n.kind === 'end') {
    const o = OUTCOMES.find((x) => x.key === n.data.outcome) ?? OUTCOMES[0];
    body = (
      <>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: o.color }}>END · {o.label.toUpperCase()}</span>
        <p style={{ fontSize: 18, margin: 0 }}>{n.data.text || 'This path ends here.'}</p>
        {n.data.dialogue && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: defs.get(n.data.speaker)?.color ?? 'var(--muted)' }}>{defs.get(n.data.speaker)?.name ?? 'Someone'}</span>
            <p style={{ fontSize: 16, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{n.data.dialogue}</p>
          </div>
        )}
        {Array.isArray(n.data.rewards) && n.data.rewards.length > 0 && (
          <div className="end-rewards" style={{ fontSize: 14 }}>
            {n.data.rewards.map((r: any, i: number) => (
              <span key={i}>+ {rewardText(r, defs, props.itemsById)}</span>
            ))}
          </div>
        )}
      </>
    );
    options = [{ label: 'Play again', target: null, onPick: restart }];
  }

  return (
    <div className="play-backdrop" role="dialog" aria-modal="true" aria-label={'Play ' + props.chainName}>
      <div className="play-window">
        <header className="play-head">
          <span className="brand" style={{ fontSize: 12 }}>PLAY MODE</span>
          <strong>{props.chainName}</strong>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={restart}>
            Restart
          </button>
          <button type="button" className="btn small" onClick={() => props.onClose(current)}>
            <Icon name="x" size={14} /> Close
          </button>
        </header>
        <div className="play-body">
          <section className="play-stage">
            <div className="play-card">{body}</div>
            <div className="play-options">
              {options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  className={'play-option' + (o.done ? ' done' : '')}
                  disabled={o.disabled}
                  onClick={() => (o.onPick ? o.onPick() : go(o.target, n?.kind === 'choice' || n?.kind === 'dialogue' ? '→ ' + o.label : undefined))}
                >
                  <span className="muted" style={{ minWidth: 18 }}>{i + 1}.</span> {o.label}
                </button>
              ))}
              {n && options.length === 0 && n.kind !== 'end' && (
                <span className="warn-box">
                  <Icon name="warn" /> Dead end: nothing is connected after this node.
                </span>
              )}
            </div>
          </section>
          <aside className="play-side">
            <span className="section-label">STORY VARIABLES</span>
            {variables.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No variables yet. Add them under Definitions → Story variables.</span>}
            {variables.map((d) => (
              <VarRow key={d.id} d={d} value={vars[d.id]} onChange={(val) => setVars({ ...vars, [d.id]: val })} />
            ))}
            <span className="section-label" style={{ marginTop: 10 }}>PATH SO FAR</span>
            <ol className="play-log">
              {log.map((l, i) => (
                <li key={i} className={l.tone ?? ''}>
                  {l.text}
                </li>
              ))}
            </ol>
            <span className="muted" style={{ fontSize: 12 }}>Quests completed this run: {completed.size}</span>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Speech({ who, text }: { who?: Definition; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderLeft: '3px solid ' + (who?.color ?? '#6fb3d6'), background: '#15130f', borderRadius: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: who?.color ?? 'var(--muted)' }}>{who?.name ?? 'Quest giver'}</span>
      <span style={{ fontSize: 16, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{text}</span>
    </div>
  );
}

function VarRow({ d, value, onChange }: { d: Definition; value: VarValue | undefined; onChange: (v: VarValue) => void }) {
  const t = varType(d);
  return (
    <label className="list-row" style={{ fontSize: 13 }}>
      <span className="grow" style={{ fontFamily: 'var(--mono)', color: d.color }}>
        {d.name}
      </span>
      {t === 'Boolean' ? (
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} aria-label={d.name} />
      ) : (
        <input
          className="input"
          style={{ width: 110, minHeight: 32 }}
          aria-label={d.name}
          type={t === 'Integer' ? 'number' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(t === 'Integer' ? Number(e.target.value) : e.target.value)}
        />
      )}
    </label>
  );
}

export const ACTION_OP_LABELS = ACTION_OPS;
