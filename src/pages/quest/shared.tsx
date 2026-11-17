import { createContext, useContext } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, getBezierPath, type EdgeProps, type NodeProps } from '@xyflow/react';
import { remove } from '../../lib/db';
import type { useDefinitions, useMembers } from '../../lib/hooks';
import type { Definition, EdgeKind, Item, NodeKind, QuestChain, QuestData, QuestEdge, QuestNode } from '../../lib/types';
import { Icon, MemberBadge } from '../../components/ui';

/*
 * Shared pieces of the quest editor: node look, colours, condition logic and problem checks.
 * Node kinds, roughly following Arcweave / Drafft:
 *   start     – where a chain begins (Play mode starts here)
 *   quest     – a quest with objectives, rewards and its giver's dialogue
 *   dialogue  – one line said by a character; links leaving it are the player's replies
 *   choice    – a story decision; each link is an option
 *   condition – checks a story variable (or a free-text rule); leaves through Yes or No
 *   action    – changes a story variable (“Set variable”)
 *   external  – needs a quest from another chain
 *   end       – where this path ends (success, failure or abandoned)
 *   note      – a sticky note for the team; not part of the flow
 */

export const EDGE_COLORS: Record<EdgeKind, string> = {
  unlocks: '#d9a75e',
  condition: '#c294d6',
  choice: '#e0805d',
  external: '#c294d6',
  response: '#6fb3d6',
};
export const YES = '#8fbf74';
export const NO = '#e0805d';

export const OUTCOMES = [
  { key: 'success', label: 'Success', color: '#8fbf74' },
  { key: 'failure', label: 'Failure', color: '#e0805d' },
  { key: 'abandoned', label: 'Abandoned', color: '#8f897d' },
] as const;

export const OPS = ['==', '!=', '>', '>=', '<', '<='] as const;
export const ACTION_OPS = [
  { key: 'set', label: 'Set to' },
  { key: 'add', label: 'Add' },
  { key: 'subtract', label: 'Subtract' },
  { key: 'toggle', label: 'Toggle (true ↔ false)' },
] as const;

export const NODE_META: Record<Exclude<NodeKind, 'external'> | 'external', { label: string; color: string; hint: string }> = {
  start: { label: 'Start', color: '#8fbf74', hint: 'Where this chain begins' },
  quest: { label: 'Quest', color: '#d9a75e', hint: 'A quest with objectives and rewards' },
  dialogue: { label: 'Dialogue', color: '#6fb3d6', hint: 'A line said by a character' },
  choice: { label: 'Choice', color: '#e0805d', hint: 'A decision the player makes' },
  condition: { label: 'Condition', color: '#c294d6', hint: 'Checks a story variable: Yes / No' },
  action: { label: 'Set variable', color: '#5fb8a8', hint: 'Changes a story variable' },
  external: { label: 'Quest from another chain', color: '#c294d6', hint: 'Needs a quest from another chain' },
  end: { label: 'End', color: '#e0805d', hint: 'Where this path ends' },
  note: { label: 'Note', color: '#c4b04e', hint: 'A sticky note for the team' },
  reroute: { label: 'Reroute', color: '#8f897d', hint: 'A bend point on a link (double-click a link to add one)' },
};

export type Ctx = {
  defs: ReturnType<typeof useDefinitions>;
  members: ReturnType<typeof useMembers>;
  itemsById: Map<string, Item>;
  allNodes: Map<string, QuestNode>;
  allEdges: QuestEdge[];
  chains: Map<string, QuestChain>;
  problems: Map<string, string[]>;
};
export const QuestCtx = createContext<Ctx>(null as unknown as Ctx);

export function questLabel(n: QuestNode | undefined) {
  if (!n) return 'Missing quest';
  return n.data.name || n.data.code || 'Untitled quest';
}

// ---------- variables & conditions ----------
export type VarType = 'Boolean' | 'Integer' | 'Text';
export type VarValue = boolean | number | string;

export function varType(d: Definition | undefined): VarType {
  const t = d?.extra?.type;
  return t === 'Integer' || t === 'Text' ? t : 'Boolean';
}

export function parseValue(type: VarType, raw: string | undefined): VarValue {
  const s = (raw ?? '').trim();
  if (type === 'Boolean') return s.toLowerCase() === 'true' || s === '1' || s.toLowerCase() === 'yes';
  if (type === 'Integer') return Number.parseFloat(s) || 0;
  return s;
}

export function formatValue(v: VarValue | undefined) {
  if (v === undefined) return '—';
  return typeof v === 'string' ? `"${v}"` : String(v);
}

export function evaluate(op: string, left: VarValue, right: VarValue): boolean {
  switch (op) {
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      return left === right;
  }
}

/** One check inside a condition node: variable, comparison, value. */
export type Check = { id: string; variable: string | null; op: string; value: string };

/** All checks of a condition: the first lives on the node itself, extra ones in data.more. */
export function conditionChecks(n: QuestNode): Check[] {
  const first: Check = { id: 'first', variable: n.data.variable ?? null, op: n.data.op || '==', value: String(n.data.value ?? '') };
  const more: Check[] = Array.isArray(n.data.more) ? n.data.more : [];
  return [first, ...more];
}

/** 'or' when any check is enough, 'and' when all must be true. */
export function conditionJoin(n: QuestNode): 'or' | 'and' {
  return n.data.join === 'and' ? 'and' : 'or';
}

export function checkText(c: Check, defs: Ctx['defs']) {
  const v = defs.get(c.variable);
  return v ? `${v.name} ${c.op || '=='} ${c.value ?? ''}`.trim() : '(pick a variable)';
}

export function conditionText(n: QuestNode, defs: Ctx['defs']) {
  const checks = conditionChecks(n);
  if (!defs.get(n.data.variable) && checks.length === 1) return n.data.text || 'Set a condition';
  return checks.map((c) => checkText(c, defs)).join(conditionJoin(n) === 'and' ? ' AND ' : ' OR ');
}

/** True when every check uses an existing variable, so Play mode can decide on its own. */
export function conditionIsAutomatic(n: QuestNode, defs: Ctx['defs']) {
  return conditionChecks(n).every((c) => !!defs.get(c.variable));
}

export function evaluateCondition(n: QuestNode, defs: Ctx['defs'], vars: Record<string, VarValue>): boolean {
  const results = conditionChecks(n).map((c) => {
    const d = defs.get(c.variable);
    return !!d && evaluate(c.op || '==', vars[d.id], parseValue(varType(d), c.value));
  });
  return conditionJoin(n) === 'and' ? results.every(Boolean) : results.some(Boolean);
}

export function actionText(n: QuestNode, defs: Ctx['defs']) {
  const v = defs.get(n.data.variable);
  if (!v) return 'Pick a variable';
  switch (n.data.op) {
    case 'add':
      return `${v.name} + ${n.data.value || 0}`;
    case 'subtract':
      return `${v.name} − ${n.data.value || 0}`;
    case 'toggle':
      return `toggle ${v.name}`;
    default:
      return `${v.name} = ${n.data.value ?? ''}`;
  }
}

// ---------- problem checks ----------
export function findProblems(nodes: QuestNode[], edges: QuestEdge[], items: Item[], defs: Ctx['defs']) {
  const itemIds = new Set(items.map((i) => i.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  edges.forEach((e) => {
    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  });
  const out = new Map<string, string[]>();
  const add = (id: string, msg: string) => out.set(id, [...(out.get(id) ?? []), msg]);
  const startsPerChain = new Map<string, number>();

  for (const n of nodes) {
    const outs = outgoing.get(n.id) ?? 0;
    const ins = incoming.get(n.id) ?? 0;
    switch (n.kind) {
      case 'quest': {
        const d = n.data as QuestData;
        if (!d.name?.trim()) add(n.id, 'Quest has no name');
        if (!d.rewards?.length) add(n.id, 'Quest has no reward');
        if (!d.objectives?.length) add(n.id, 'Quest has no objectives');
        d.required_items?.forEach((r) => !itemIds.has(r.item) && add(n.id, 'A required item was deleted'));
        d.rewards?.forEach((r) => r.item && !itemIds.has(r.item) && add(n.id, 'A reward item was deleted'));
        break;
      }
      case 'external':
        if (!byId.get(n.data.ref)) add(n.id, 'Linked quest no longer exists');
        break;
      case 'start':
        startsPerChain.set(n.chain_id, (startsPerChain.get(n.chain_id) ?? 0) + 1);
        if (!outs) add(n.id, 'Start is not connected to anything');
        break;
      case 'dialogue':
        if (!n.data.speaker) add(n.id, 'Dialogue has no speaker');
        if (!n.data.text?.trim()) add(n.id, 'Dialogue has no text');
        if (!outs) add(n.id, 'Dead end: connect it to the next step or an End node');
        if (!ins) add(n.id, 'Nothing leads to this dialogue');
        break;
      case 'choice': {
        const opts = choiceOptions(n);
        if (opts.length ? opts.length < 2 : outs < 2) add(n.id, 'A choice needs at least two options');
        const used = new Set(edges.filter((e) => e.source === n.id).map((e) => e.source_handle));
        opts.forEach((o, i) => !used.has(o.id) && add(n.id, `Option ${i + 1} (${o.text || 'no text'}) leads nowhere`));
        if (!ins) add(n.id, 'Nothing leads to this choice');
        break;
      }
      case 'condition': {
        if (!n.data.variable && !n.data.text?.trim()) add(n.id, 'Condition is empty');
        const es = edges.filter((e) => e.source === n.id);
        if (!es.some((e) => e.source_handle !== 'no')) add(n.id, 'Nothing connected to “Yes”');
        if (n.data.variable && !defs.get(n.data.variable)) add(n.id, 'Its variable was deleted');
        conditionChecks(n).slice(1).forEach((c, i) => {
          if (!c.variable) add(n.id, `Check ${i + 2} has no variable`);
          else if (!defs.get(c.variable)) add(n.id, `Check ${i + 2}: its variable was deleted`);
        });
        break;
      }
      case 'action':
        if (!n.data.variable) add(n.id, 'Pick the variable to change');
        else if (!defs.get(n.data.variable)) add(n.id, 'Its variable was deleted');
        if (!outs) add(n.id, 'Dead end: connect it to the next step or an End node');
        break;
      case 'end':
        if (!ins) add(n.id, 'Nothing leads to this End');
        break;
      case 'reroute':
        if (!ins || !outs) add(n.id, 'Reroute point is not connected on both sides');
        break;
    }
  }
  for (const n of nodes) if (n.kind === 'start' && (startsPerChain.get(n.chain_id) ?? 0) > 1) add(n.id, 'This chain has more than one Start');
  return out;
}

// ---------- node views ----------
function Warn({ id }: { id: string }) {
  const { problems } = useContext(QuestCtx);
  const w = problems.get(id);
  if (!w) return null;
  return (
    <span style={{ color: 'var(--danger)', display: 'flex' }} title={w.join('\n')}>
      <Icon name="warn" size={13} />
    </span>
  );
}

function QuestNodeView({ data, selected }: NodeProps) {
  const { defs, members } = useContext(QuestCtx);
  const n = data.node as QuestNode;
  const d = n.data as QuestData;
  const status = defs.get(d.status);
  const type = defs.get(d.type);
  const who = members.get(d.assignee);
  const giver = defs.get(d.giver_id);
  const district = defs.get(d.district);
  return (
    <div className={'qnode' + (selected ? ' selected' : '')}>
      <Handle type="target" position={Position.Left} />
      <div className="qhead">
        <span>{d.code || 'NO ID'}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: type?.color ?? 'var(--muted)', fontWeight: 500 }}>
          {type?.name}
          <Warn id={n.id} />
        </span>
      </div>
      <div className="qbody">
        <span className="qname">{d.name || 'Untitled quest'}</span>
        {(giver || district) && (
          <span className="qrow">
            {giver && <span style={{ color: giver.color }}>{giver.name}</span>}
            {giver && district && '·'}
            {district && <span>{district.name}</span>}
          </span>
        )}
        <span className="qrow">
          {d.level ? 'Lv ' + d.level + ' · ' : ''}
          {d.objectives?.length ?? 0} objectives
          {d.dialogue?.start ? ' · dialogue' : ''}
        </span>
        {d.rewards?.length > 0 && (
          <span className="qrow" style={{ gap: 4 }}>
            {d.rewards.slice(0, 4).map((r, i) => {
              const t = defs.get(r.type);
              return (
                <span key={i} className="tag" style={{ height: 18, fontSize: 9, color: t?.color, background: (t?.color ?? '#888') + '26' }}>
                  {t?.name ?? 'Reward'}
                </span>
              );
            })}
            {d.rewards.length > 4 && <span>+{d.rewards.length - 4}</span>}
          </span>
        )}
        <span className="qrow" style={{ color: 'var(--text-2)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: status?.color ?? '#5a544a' }} />
          {status?.name ?? 'No status'}
          <span style={{ flex: 1 }} />
          {who ? <MemberBadge m={who} size={22} /> : <span className="unassigned" style={{ height: 22, fontSize: 10, padding: '0 6px' }}>?</span>}
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function Box(props: { id: string; selected?: boolean; color: string; bg: string; label: string; icon?: React.ReactNode; dashed?: boolean; children?: React.ReactNode; inHandle?: boolean; outHandle?: boolean; width?: number }) {
  return (
    <div className={'snode' + (props.selected ? ' selected' : '')} style={{ borderColor: props.color, background: props.bg, borderStyle: props.dashed ? 'dashed' : 'solid', width: props.width }}>
      {props.inHandle !== false && <Handle type="target" position={Position.Left} />}
      <span className="klabel" style={{ color: props.color, display: 'flex', alignItems: 'center', gap: 6 }}>
        {props.icon}
        {props.label}
        <span style={{ flex: 1 }} />
        <Warn id={props.id} />
      </span>
      {props.children}
      {props.outHandle !== false && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

function StartNode({ data, selected }: NodeProps) {
  const n = data.node as QuestNode;
  return (
    <div className={'snode start-node' + (selected ? ' selected' : '')}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
        <strong>START</strong>
        <Warn id={n.id} />
      </span>
      {n.data.text && <span style={{ fontSize: 12, color: '#d6e9cc' }}>{n.data.text}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function EndNode({ data, selected }: NodeProps) {
  const n = data.node as QuestNode;
  const o = OUTCOMES.find((x) => x.key === n.data.outcome) ?? OUTCOMES[0];
  return (
    <div className={'snode end-node' + (selected ? ' selected' : '')} style={{ borderColor: o.color, background: o.color + '22' }}>
      <Handle type="target" position={Position.Left} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: o.color }}>
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
        <strong>END · {o.label.toUpperCase()}</strong>
        <Warn id={n.id} />
      </span>
      {n.data.text && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{n.data.text}</span>}
    </div>
  );
}

function DialogueNode({ data, selected }: NodeProps) {
  const { defs } = useContext(QuestCtx);
  const n = data.node as QuestNode;
  const sp = defs.get(n.data.speaker);
  return (
    <Box id={n.id} selected={selected} color="#6fb3d6" bg="#151d22" label="DIALOGUE" width={240}>
      <span style={{ fontSize: 12, fontWeight: 700, color: sp?.color ?? 'var(--danger)' }}>{sp?.name ?? 'No speaker'}</span>
      <span className="ktext clamp3" style={{ fontWeight: 400 }}>
        {n.data.text ? '“' + n.data.text + '”' : '…'}
      </span>
    </Box>
  );
}

export type ChoiceOption = { id: string; text: string };
export function choiceOptions(n: QuestNode | undefined): ChoiceOption[] {
  return Array.isArray(n?.data?.options) ? (n!.data.options as ChoiceOption[]) : [];
}

/** A choice lists its options 1, 2, 3… and each option has its own exit dot. */
function ChoiceNode({ data, selected }: NodeProps) {
  const n = data.node as QuestNode;
  const options = choiceOptions(n);
  return (
    <div className={'snode choice-node' + (selected ? ' selected' : '')}>
      <Handle type="target" position={Position.Left} />
      <span className="klabel" style={{ color: '#f0a083', display: 'flex', gap: 6 }}>
        PLAYER CHOICE
        <span style={{ flex: 1 }} />
        <Warn id={n.id} />
      </span>
      <span className="ktext">{n.data.text || '…'}</span>
      {options.length === 0 ? (
        <Handle type="source" position={Position.Right} />
      ) : (
        <div className="choice-options">
          {options.map((o, i) => (
            <div key={o.id} className="choice-option">
              <span className="choice-num">{i + 1}</span>
              <span className="choice-text">{o.text || 'Option ' + (i + 1)}</span>
              <Handle type="source" id={o.id} position={Position.Right} className="choice-handle" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  const { defs } = useContext(QuestCtx);
  const n = data.node as QuestNode;
  return (
    <div className={'snode' + (selected ? ' selected' : '')} style={{ borderColor: '#c294d6', background: '#1d1820', paddingRight: 34, minHeight: 74 }}>
      <Handle type="target" position={Position.Left} />
      <span className="klabel" style={{ color: '#d4b0e3', display: 'flex', gap: 6 }}>
        IF <Warn id={n.id} />
      </span>
      <span className="ktext" style={{ fontFamily: n.data.variable ? 'var(--mono)' : undefined, fontSize: n.data.variable ? 12 : 13 }}>
        {conditionText(n, defs)}
      </span>
      <span className="hlabel" style={{ top: '30%', color: YES }}>Yes</span>
      <span className="hlabel" style={{ top: '72%', color: NO }}>No</span>
      <Handle type="source" id="yes" position={Position.Right} style={{ top: '30%', background: YES }} />
      <Handle type="source" id="no" position={Position.Right} style={{ top: '72%', background: NO }} />
    </div>
  );
}

function ActionNode({ data, selected }: NodeProps) {
  const { defs } = useContext(QuestCtx);
  const n = data.node as QuestNode;
  return (
    <Box id={n.id} selected={selected} color="#5fb8a8" bg="#13201e" label="SET VARIABLE">
      <span className="ktext" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
        {actionText(n, defs)}
      </span>
    </Box>
  );
}

function ExternalNode({ data, selected }: NodeProps) {
  const { allNodes, chains } = useContext(QuestCtx);
  const n = data.node as QuestNode;
  const ref = allNodes.get(n.data.ref);
  const chain = ref ? chains.get(ref.chain_id) : undefined;
  return (
    <Box id={n.id} selected={selected} color="#c294d6" bg="#1d1820" dashed label="NEEDS QUEST · OTHER CHAIN" icon={<Icon name="link" size={12} />}>
      <span className="ktext">{questLabel(ref)}</span>
      <span style={{ fontSize: 11, color: '#b9afc0' }}>{ref ? `${ref.data.code || ''}${ref.data.code ? ' · ' : ''}${chain?.name ?? ''}` : 'Pick a quest in the panel'}</span>
    </Box>
  );
}

function NoteNode({ data, selected }: NodeProps) {
  const n = data.node as QuestNode;
  return (
    <div className={'note-node' + (selected ? ' selected' : '')}>
      <span className="klabel" style={{ color: '#6b5d1c' }}>NOTE</span>
      <span style={{ whiteSpace: 'pre-wrap' }}>{n.data.text || 'Write a note…'}</span>
    </div>
  );
}

export const nodeTypes = {
  reroute: RerouteNode,
  start: StartNode,
  end: EndNode,
  quest: QuestNodeView,
  dialogue: DialogueNode,
  choice: ChoiceNode,
  condition: ConditionNode,
  action: ActionNode,
  external: ExternalNode,
  note: NoteNode,
};

/** Which link kind a new connection gets, based on the node it leaves from. */
/** A reroute point: a draggable bend on a link, like Unreal's reroute node. Links pass straight through it. */
function RerouteNode({ selected }: NodeProps) {
  return (
    <div className={'reroute-node' + (selected ? ' selected' : '')} title="Reroute point (drag to bend the link)">
      <Handle type="target" position={Position.Left} className="reroute-handle" />
      <Handle type="source" position={Position.Right} className="reroute-handle" />
    </div>
  );
}

/** Walks back through reroute points to the link that really starts this path. */
export function originEdge(e: QuestEdge, nodes: Map<string, QuestNode>, edges: QuestEdge[]): QuestEdge {
  let cur = e;
  for (let i = 0; i < 100; i++) {
    if (nodes.get(cur.source)?.kind !== 'reroute') return cur;
    const prev = edges.find((x) => x.target === cur.source);
    if (!prev) return cur;
    cur = prev;
  }
  return cur;
}

/** Follows a link forward through reroute points to the node it really leads to. */
export function finalTarget(targetId: string, nodes: Map<string, QuestNode>, edges: QuestEdge[]): string {
  let id = targetId;
  for (let i = 0; i < 100; i++) {
    if (nodes.get(id)?.kind !== 'reroute') return id;
    const next = edges.find((x) => x.source === id);
    if (!next) return id;
    id = next.target;
  }
  return id;
}

/** Follows a link backward through reroute points to the node it really comes from. */
export function realSource(sourceId: string, nodes: Map<string, QuestNode>, edges: QuestEdge[]): string {
  let id = sourceId;
  for (let i = 0; i < 100; i++) {
    if (nodes.get(id)?.kind !== 'reroute') return id;
    const prev = edges.find((x) => x.target === id);
    if (!prev) return id;
    id = prev.source;
  }
  return id;
}

export function edgeKindFor(source: QuestNode | undefined): EdgeKind {
  switch (source?.kind) {
    case 'condition':
      return 'condition';
    case 'choice':
      return 'choice';
    case 'dialogue':
      return 'response';
    case 'external':
      return 'external';
    default:
      return 'unlocks';
  }
}

export function edgeColor(e: QuestEdge) {
  if (e.kind === 'condition') return e.source_handle === 'no' ? NO : YES;
  return EDGE_COLORS[e.kind] ?? EDGE_COLORS.unlocks;
}

export function edgeLabel(e: QuestEdge) {
  if (e.kind === 'condition') return e.source_handle === 'no' ? 'No' : 'Yes';
  return e.label || undefined;
}

/** A link with its label in the middle and a × to cut it (shown when the link is selected or hovered). */
function LinkEdge(props: EdgeProps) {
  const [path, x, y] = getBezierPath(props);
  const color = (props.data?.color as string) ?? '#d9a75e';
  const label = props.data?.label as string | undefined;
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={props.interactionWidth} />
      <EdgeLabelRenderer>
        <div className={'edge-ui nodrag nopan' + (props.selected ? ' selected' : '')} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
          {label && (
            <span className="edge-label" style={{ color, borderColor: color + '66' }}>
              {label}
            </span>
          )}
          <button
            type="button"
            className="edge-x"
            aria-label="Cut this link"
            title="Cut this link"
            onClick={(e) => {
              e.stopPropagation();
              remove('quest_edges', props.id);
            }}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { link: LinkEdge };
