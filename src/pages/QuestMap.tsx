import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyNodeChanges,
  getBezierPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { group, insert, newId, remove, update, useTable } from '../lib/db';
import { download, useDefinitions } from '../lib/hooks';
import type { Item, MapEdge, MapEdgeKind, MapNode, MapNodeKind, QuestChain, QuestEdge, QuestNode } from '../lib/types';
import { DefSelect, Icon, ItemIcon, TextField } from '../components/ui';
import { useCanvasSize } from '../lib/canvas';

/*
 * Quest map: a flow chart of the whole story.
 * One node per quest chain (coloured by its quest type: Main, Side, Guild…),
 * plus flow nodes – Start, End, AND, OR, Pick one, Go back and Note – to direct the flow.
 * Links have a direction arrow and a colour by what they mean.
 */

export const LINK_KINDS: { key: MapEdgeKind; label: string; color: string; dash?: string }[] = [
  { key: 'main', label: 'Main story', color: '#d9a75e' },
  { key: 'side', label: 'Side / optional', color: '#6fb3d6' },
  { key: 'unlock', label: 'Unlocks / required', color: '#c294d6', dash: '3 6' },
  { key: 'fail', label: 'Fail / alternative', color: '#e0705d', dash: '9 6' },
];
const BACK_COLOR = '#a59f94';
const linkKind = (k: string) => LINK_KINDS.find((x) => x.key === k) ?? LINK_KINDS[0];

const FLOW_META: Record<Exclude<MapNodeKind, 'chain'>, { label: string; color: string; hint: string }> = {
  start: { label: 'Start', color: '#8fbf74', hint: 'Where a story line begins (e.g. start of the game or an act).' },
  end: { label: 'End', color: '#e0705d', hint: 'Where a story line ends (e.g. end of an act or the game).' },
  and: { label: 'AND', color: '#e6c36a', hint: 'Continues only when ALL incoming paths are done.' },
  or: { label: 'OR', color: '#6fd6c2', hint: 'Continues when ANY ONE incoming path is done.' },
  split: { label: 'Pick one', color: '#e0805d', hint: 'The player goes down only ONE of the outgoing paths.' },
  back: { label: 'Go back', color: BACK_COLOR, hint: 'Sends the flow back to an earlier point on the map (a loop).' },
  note: { label: 'Note', color: '#d6c36a', hint: 'A comment for the team. Not part of the flow.' },
};

// ---------- rewards ----------
type Reward = { type: string | null; text: string; item: string | null; amount: number };
/** One line of a reward total, e.g. "1,250 XP" or "3× Brass Gear". */
export type RewardLine = { key: string; label: string; amount: number; color: string; item?: Item; numeric: boolean };
export type RewardSource = { name: string; kind: 'quest' | 'end'; lines: RewardLine[] };
type Defs = ReturnType<typeof useDefinitions>;

const isCurrencyName = (s: string) => /currenc|coin|money|gold/i.test(s);

function addLine(into: Map<string, RewardLine>, r: Reward, defs: Defs, items: Map<string, Item>) {
  const amount = Number(r.amount) || 0;
  const item = r.item ? items.get(r.item) : undefined;
  const type = defs.get(r.type);
  let line: RewardLine;
  if (item) {
    const currency = isCurrencyName(defs.get(item.category)?.name ?? '') || isCurrencyName(type?.name ?? '');
    line = { key: 'item:' + item.id, label: item.name, amount, color: defs.get(item.rarity)?.color ?? '#8f897d', item, numeric: currency };
  } else {
    const label = (type?.name ?? 'Reward') + (r.text ? ` (${r.text})` : '');
    // XP, currency, reputation… add up; titles, cosmetics and unlocks are counted as "other" rewards.
    const numeric = !/title|cosmetic|blueprint|unlock|item/i.test(type?.name ?? '');
    line = { key: 'type:' + (r.type ?? '') + ':' + (r.text ?? ''), label, amount, color: type?.color ?? '#8f897d', numeric };
  }
  const had = into.get(line.key);
  into.set(line.key, had ? { ...had, amount: had.amount + amount } : line);
}

/** All rewards in a chain: from its quests and from its End nodes. */
export function chainRewards(chainId: string, qNodes: QuestNode[], defs: Defs, items: Map<string, Item>) {
  const total = new Map<string, RewardLine>();
  const sources: RewardSource[] = [];
  const nodes = qNodes.filter((n) => n.chain_id === chainId && (n.kind === 'quest' || n.kind === 'end')).sort((a, b) => a.x - b.x || a.y - b.y);
  for (const n of nodes) {
    const list: Reward[] = Array.isArray(n.data.rewards) ? n.data.rewards : [];
    if (!list.length) continue;
    const own = new Map<string, RewardLine>();
    list.forEach((r) => {
      addLine(own, r, defs, items);
      addLine(total, r, defs, items);
    });
    const name = n.kind === 'quest' ? n.data.name || n.data.code || 'Untitled quest' : 'End · ' + (n.data.outcome === 'fail' ? 'Fail' : n.data.outcome === 'neutral' ? 'Neutral' : 'Success') + (n.data.text ? ': ' + String(n.data.text).slice(0, 30) : '');
    sources.push({ name, kind: n.kind as 'quest' | 'end', lines: sortLines([...own.values()]) });
  }
  const endings = nodes.filter((n) => n.kind === 'end' && Array.isArray(n.data.rewards) && n.data.rewards.length).length;
  return { lines: sortLines([...total.values()]), sources, endings };
}
function sortLines(l: RewardLine[]) {
  const xp = (x: RewardLine) => (/^xp\b|experience/i.test(x.label) ? 0 : 1);
  return l.sort((a, b) => Number(b.numeric) - Number(a.numeric) || xp(a) - xp(b) || (a.item ? 1 : 0) - (b.item ? 1 : 0) || b.amount - a.amount);
}
const fmt = (n: number) => n.toLocaleString('en-US');
function lineText(l: RewardLine) {
  if (l.numeric) return `${fmt(l.amount)} ${l.label}`;
  return l.amount > 1 ? `${l.amount}× ${l.label}` : l.label;
}

// ---------- nodes ----------
type ChainData = { name: string; typeName: string; color: string; count: number; first: string; last: string; missing: boolean; rewards?: RewardLine[] };

function ChainMapNode({ data, selected }: NodeProps) {
  const d = data as unknown as ChainData;
  return (
    <div className={'mchain' + (selected ? ' selected' : '')} style={{ borderColor: d.color, ['--c' as string]: d.color }}>
      <Handle type="target" position={Position.Left} />
      <span className="mchain-type" style={{ background: d.color }}>
        {d.typeName ? d.typeName.toUpperCase() : 'NO TYPE'}
      </span>
      <strong className="mchain-name">{d.missing ? 'Deleted chain' : d.name}</strong>
      <span className="mchain-sub">
        {d.count} quest{d.count === 1 ? '' : 's'}
        {d.first && ` · ${d.first}${d.last && d.last !== d.first ? ' → ' + d.last : ''}`}
      </span>
      {d.rewards && (
        <span className="mchain-rewards">
          {d.rewards.length === 0 ? (
            <span className="muted">No rewards</span>
          ) : (
            <>
              {d.rewards.filter((l) => l.numeric).slice(0, 3).map((l) => (
                <span key={l.key} style={{ color: l.color }}>
                  {fmt(l.amount)} {l.label}
                </span>
              ))}
              {d.rewards.some((l) => !l.numeric) && (
                <span title={d.rewards.filter((l) => !l.numeric).map(lineText).join(', ')}>
                  +{d.rewards.filter((l) => !l.numeric).length} item{d.rewards.filter((l) => !l.numeric).length === 1 ? '' : 's'} / other
                </span>
              )}
            </>
          )}
        </span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function FlowMapNode({ data, selected, type }: NodeProps) {
  const kind = type as Exclude<MapNodeKind, 'chain'>;
  const m = FLOW_META[kind];
  const label = (data.label as string) || '';
  const sel = selected ? ' selected' : '';
  if (kind === 'note')
    return (
      <div className={'mnote' + sel}>
        <span className="klabel" style={{ color: m.color }}>NOTE</span>
        {(data.text as string) || 'Write a note…'}
      </div>
    );
  if (kind === 'and' || kind === 'or')
    return (
      <div className={'mgate' + sel} style={{ borderColor: m.color, color: m.color }} title={m.hint}>
        <Handle type="target" position={Position.Left} />
        <strong>{m.label}</strong>
        <span>{(data.sub as string) ?? ''}</span>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  if (kind === 'split')
    return (
      <div className={'msplit' + sel} title={m.hint}>
        <Handle type="target" position={Position.Left} />
        <div className="msplit-shape" style={{ borderColor: m.color }} />
        <span className="msplit-text" style={{ color: m.color }}>
          {label || 'Pick one'}
        </span>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  return (
    <div className={'mpill' + sel} style={{ borderColor: m.color }} title={m.hint}>
      {kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <span className="klabel" style={{ color: m.color }}>
        {kind === 'back' ? '↺ GO BACK' : m.label.toUpperCase()}
      </span>
      <span className="mpill-text">{kind === 'back' ? 'to ' + ((data.refName as string) || '…') : label || (kind === 'start' ? 'Begin' : 'Finish')}</span>
      {kind === 'start' && <Handle type="source" position={Position.Right} />}
      {kind === 'back' && <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />}
    </div>
  );
}

const nodeTypes = { chain: ChainMapNode, start: FlowMapNode, end: FlowMapNode, and: FlowMapNode, or: FlowMapNode, split: FlowMapNode, back: FlowMapNode, note: FlowMapNode };

// ---------- links ----------
function MapLinkEdge(props: EdgeProps) {
  const [path, x, y] = getBezierPath(props);
  const color = (props.data?.color as string) ?? '#d9a75e';
  const label = props.data?.label as string | undefined;
  const virtual = !!props.data?.virtual;
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={props.interactionWidth} />
      {!virtual && (
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
                remove('map_edges', props.id);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { mlink: MapLinkEdge };

// ---------- page ----------
export default function QuestMapPage() {
  return (
    <ReactFlowProvider>
      <QuestMapInner />
    </ReactFlowProvider>
  );
}

function QuestMapInner() {
  const { rows: chainsRaw } = useTable<QuestChain>('quest_chains');
  const { rows: qNodes } = useTable<QuestNode>('quest_nodes');
  const { rows: qEdges } = useTable<QuestEdge>('quest_edges');
  const { rows: nodes } = useTable<MapNode>('map_nodes');
  const { rows: edges } = useTable<MapEdge>('map_edges');
  const defs = useDefinitions();
  const { rows: itemRows } = useTable<Item>('items');
  const itemsById = useMemo(() => new Map(itemRows.map((i) => [i.id, i])), [itemRows]);
  const [showRewards, setShowRewards] = useState(() => localStorage.getItem('earthlings-tools:map-rewards') !== 'off');
  const toggleRewards = () => {
    localStorage.setItem('earthlings-tools:map-rewards', showRewards ? 'off' : 'on');
    setShowRewards(!showRewards);
  };
  const navigate = useNavigate();
  const rf = useReactFlow();
  const canvas = useCanvasSize('quest-map', 250);

  const chains = useMemo(() => [...chainsRaw].sort((a, b) => a.sort - b.sort), [chainsRaw]);
  const chainById = useMemo(() => new Map(chains.map((c) => [c.id, c])), [chains]);
  const rewardsByChain = useMemo(() => new Map(chains.map((c) => [c.id, chainRewards(c.id, qNodes, defs, itemsById)])), [chains, qNodes, defs, itemsById]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const typeColor = (c?: QuestChain) => defs.get(c?.type ?? '')?.color ?? c?.color ?? '#5a544a';
  const questsOf = (chainId: string) => qNodes.filter((n) => n.chain_id === chainId && n.kind === 'quest').sort((a, b) => a.x - b.x || a.y - b.y);
  const nodeName = (n?: MapNode): string => {
    if (!n) return '';
    if (n.kind === 'chain') return chainById.get(n.chain_id ?? '')?.name ?? 'Deleted chain';
    if (n.kind === 'note') return 'Note';
    return n.data.label || FLOW_META[n.kind].label;
  };

  const built: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const base = { id: n.id, type: n.kind, position: { x: n.x, y: n.y } };
        if (n.kind === 'chain') {
          const c = chainById.get(n.chain_id ?? '');
          const qs = c ? questsOf(c.id) : [];
          const qName = (q?: QuestNode) => (q ? q.data.name || q.data.code || 'Untitled' : '');
          const data: ChainData = {
            name: c?.name ?? '', typeName: defs.get(c?.type ?? '')?.name ?? '', color: typeColor(c), count: qs.length, first: qName(qs[0]), last: qName(qs[qs.length - 1]), missing: !c,
            rewards: showRewards && c ? rewardsByChain.get(c.id)?.lines ?? [] : undefined,
          };
          return { ...base, data };
        }
        if (n.kind === 'and' || n.kind === 'or') {
          const ins = edges.filter((e) => e.target === n.id).length;
          return { ...base, data: { sub: n.kind === 'and' ? `all ${ins}` : `any of ${ins}` } };
        }
        if (n.kind === 'back') return { ...base, data: { refName: nodeName(nodeById.get(n.data.ref ?? '')) } };
        return { ...base, data: { label: n.data.label ?? '', text: n.data.text ?? '' } };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, chains, qNodes, defs, showRewards, rewardsByChain],
  );

  // React Flow keeps selection and drag state locally; the database keeps everything else.
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  useEffect(() => {
    setRfNodes((prev) => {
      if (prev.length === 0 && built.length === 0) return prev;
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return built.map((n) => ({ ...n, selected: sel.has(n.id) }));
    });
  }, [built]);
  const onNodesChange = (changes: NodeChange[]) => setRfNodes((ns) => applyNodeChanges(changes, ns));
  const selectedIds = rfNodes.filter((n) => n.selected).map((n) => n.id);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const onEdgesChange = (changes: EdgeChange[]) => {
    const next = new Set(selectedEdges);
    let changed = false;
    for (const c of changes)
      if (c.type === 'select') {
        changed = true;
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
    if (changed) setSelectedEdges(next);
  };

  const rfEdges: Edge[] = useMemo(() => {
    const list: Edge[] = edges.map((e) => {
      const k = linkKind(e.kind);
      const sel = selectedEdges.has(e.id);
      return {
        id: e.id,
        type: 'mlink',
        source: e.source,
        target: e.target,
        selected: sel,
        interactionWidth: 24,
        data: { label: e.label, color: k.color },
        style: { stroke: k.color, strokeWidth: sel ? 4.5 : 3, strokeDasharray: k.dash },
        markerEnd: { type: MarkerType.ArrowClosed, color: k.color, width: 18, height: 18 },
      };
    });
    // "Go back" nodes draw a dashed loop to where they return.
    for (const n of nodes)
      if (n.kind === 'back' && n.data.ref && nodeById.has(n.data.ref))
        list.push({
          id: 'back-' + n.id,
          type: 'mlink',
          source: n.id,
          target: n.data.ref,
          targetHandle: null,
          selectable: false,
          focusable: false,
          animated: true,
          data: { virtual: true, color: BACK_COLOR },
          style: { stroke: BACK_COLOR, strokeWidth: 2, strokeDasharray: '5 6' },
          markerEnd: { type: MarkerType.ArrowClosed, color: BACK_COLOR, width: 16, height: 16 },
        });
    return list;
  }, [edges, nodes, nodeById, selectedEdges]);

  // ---------- actions ----------
  const centre = () => {
    const el = document.querySelector('.qmap .flow-wrap')?.getBoundingClientRect();
    const p = el ? rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 }) : { x: 0, y: 0 };
    const jitter = () => Math.round((Math.random() - 0.5) * 60);
    return { x: Math.round(p.x - 100) + jitter(), y: Math.round(p.y - 40) + jitter() };
  };
  const select = (id: string) => {
    setSelectedEdges(new Set());
    setRfNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  };
  const addFlowNode = (kind: Exclude<MapNodeKind, 'chain'>) => {
    const id = newId();
    const { x, y } = centre();
    insert('map_nodes', { id, kind, chain_id: null, x, y, data: kind === 'note' ? { text: '' } : kind === 'back' ? { ref: null } : { label: '' } });
    setTimeout(() => select(id), 50);
  };
  const addChain = (c: QuestChain, at?: { x: number; y: number }) => {
    const id = newId();
    const { x, y } = at ?? centre();
    insert('map_nodes', { id, kind: 'chain', chain_id: c.id, x, y, data: {} });
    return id;
  };
  const onMap = new Set(nodes.filter((n) => n.kind === 'chain').map((n) => n.chain_id));
  const missing = chains.filter((c) => !onMap.has(c.id));
  const addAllMissing = () =>
    group(async () => {
      const maxX = nodes.length ? Math.max(...nodes.map((n) => n.x)) + 320 : 0;
      missing.forEach((c, i) => addChain(c, { x: maxX, y: i * 130 }));
    });

  const deleteNodes = (ids: string[]) =>
    group(async () => {
      const es = edges.filter((e) => ids.includes(e.source) || ids.includes(e.target)).map((e) => e.id);
      if (es.length) await remove('map_edges', es);
      // "Go back" nodes that pointed at a removed node lose their target.
      for (const n of nodes) if (n.kind === 'back' && n.data.ref && ids.includes(n.data.ref) && !ids.includes(n.id)) await update('map_nodes', n.id, { data: { ...n.data, ref: null } });
      await remove('map_nodes', ids);
    });

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    if (edges.some((e) => e.source === c.source && e.target === c.target)) return;
    const t = nodeById.get(c.target);
    const typeName = t?.kind === 'chain' ? defs.get(chainById.get(t.chain_id ?? '')?.type ?? '')?.name ?? '' : '';
    const kind: MapEdgeKind = t?.kind === 'chain' && typeName && !/main/i.test(typeName) ? 'side' : 'main';
    insert('map_edges', { id: newId(), source: c.source, target: c.target, kind, label: '' });
  };

  /** Turns "Quest from another chain" references in the quest editor into links between chains. */
  const importLinks = () => {
    const qById = new Map(qNodes.map((n) => [n.id, n]));
    const mapOf = new Map(nodes.filter((n) => n.kind === 'chain').map((n) => [n.chain_id, n.id]));
    const found: { from: string; to: string; label: string }[] = [];
    for (const n of qNodes) {
      if (n.kind !== 'external' || !n.data.ref) continue;
      const ref = qById.get(n.data.ref);
      if (!ref || !ref.chain_id || ref.chain_id === n.chain_id) continue;
      const from = mapOf.get(ref.chain_id);
      const to = mapOf.get(n.chain_id);
      if (!from || !to) continue;
      if (edges.some((e) => e.source === from && e.target === to) || found.some((f) => f.from === from && f.to === to)) continue;
      // Only if the reference actually leads somewhere in its chain.
      if (!qEdges.some((e) => e.source === n.id)) continue;
      found.push({ from, to, label: ref.data.name || ref.data.code || '' });
    }
    if (!found.length) {
      alert('No new links found. Links come from “Quest from another chain” nodes, and both chains must be on the map.');
      return;
    }
    group(() => insert('map_edges', found.map((f) => ({ id: newId(), source: f.from, target: f.to, kind: 'unlock', label: f.label }))));
  };

  /** Lays the flow out left to right by depth (longest path from the start). */
  const autoLayout = () => {
    const flow = nodes.filter((n) => n.kind !== 'note');
    const incoming = new Map<string, string[]>();
    edges.forEach((e) => incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]));
    const depth = new Map<string, number>();
    const visit = (id: string, guard: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (guard.has(id)) return 0;
      guard.add(id);
      const d = Math.max(-1, ...(incoming.get(id) ?? []).map((s) => visit(s, guard))) + 1;
      depth.set(id, d);
      return d;
    };
    flow.forEach((n) => visit(n.id, new Set()));
    const cols = new Map<number, MapNode[]>();
    flow.forEach((n) => cols.set(depth.get(n.id)!, [...(cols.get(depth.get(n.id)!) ?? []), n]));
    group(async () => {
      for (const [d, list] of cols) {
        list.sort((a, b) => a.y - b.y);
        const h = list.length * 140;
        for (let i = 0; i < list.length; i++) await update('map_nodes', list[i].id, { x: d * 320, y: Math.round(i * 140 - h / 2) });
      }
    });
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 120);
  };

  const exportJson = () => {
    const out = {
      nodes: nodes.map((n) => {
        const c = chainById.get(n.chain_id ?? '');
        return {
          id: n.id,
          type: n.kind,
          chain: c?.name,
          questType: c ? defs.get(c.type ?? '')?.name ?? '' : undefined,
          quests: c ? questsOf(c.id).map((q) => q.data.code).filter(Boolean) : undefined,
          label: n.kind === 'chain' ? undefined : n.data.label || n.data.text || undefined,
          backTo: n.kind === 'back' ? n.data.ref ?? null : undefined,
        };
      }),
      links: edges.map((e) => ({ from: e.source, to: e.target, type: e.kind, label: e.label })),
    };
    download('earthlings-quest-map.json', JSON.stringify(out, null, 2), 'application/json');
  };

  const openInEditor = (chainId: string) => navigate(`/quests?chain=${chainId}`);
  const selNode = selectedIds.length === 1 ? nodeById.get(selectedIds[0]) : undefined;
  const selEdges = edges.filter((e) => selectedEdges.has(e.id));
  const types = defs.list('quest_type');

  return (
    <div className="qmap" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="page-head" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 30 }}>Quest map</h1>
        <span className="muted">
          {onMap.size} of {chains.length} chains on the map
        </span>
      </div>
      <div ref={canvas.wrapRef} className={'canvas-area ' + canvas.className} style={canvas.style}>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>
          Add
        </span>
        {(['start', 'and', 'or', 'split', 'back', 'end', 'note'] as const).map((k) => (
          <button key={k} type="button" className="btn small" title={FLOW_META[k].hint} onClick={() => addFlowNode(k)}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: FLOW_META[k].color }} /> {FLOW_META[k].label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn small" onClick={importLinks} title="Create links from “Quest from another chain” nodes in the quest editor">
          <Icon name="link" size={14} /> Import links from quests
        </button>
        <button type="button" className="btn small" aria-pressed={showRewards} onClick={toggleRewards} title="Show the total rewards of each chain on the map">
          {showRewards ? '✓ ' : ''}Rewards
        </button>
        {canvas.maxButton}
        <button type="button" className="btn small" onClick={autoLayout}>
          Auto-layout
        </button>
        <button type="button" className="btn small primary" onClick={exportJson}>
          Export map (JSON)
        </button>
      </div>

      <div className="split">
        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="flow-wrap">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              selectionOnDrag
              panOnDrag={[1, 2]}
              panActivationKeyCode="Space"
              selectionMode={SelectionMode.Partial}
              multiSelectionKeyCode={['Control', 'Meta']}
              onNodeDragStop={(_e, _n, moved) => moved.forEach((m) => update('map_nodes', m.id, { x: Math.round(m.position.x), y: Math.round(m.position.y) }))}
              onNodeDoubleClick={(_e, n) => {
                const m = nodeById.get(n.id);
                if (m?.kind === 'chain' && m.chain_id && chainById.has(m.chain_id)) openInEditor(m.chain_id);
              }}
              onDelete={({ nodes: ns, edges: es }) => {
                if (ns.length) deleteNodes(ns.map((n) => n.id));
                else {
                  const real = es.map((e) => e.id).filter((id) => !id.startsWith('back-'));
                  if (real.length) remove('map_edges', real);
                }
              }}
              onPaneClick={() => setSelectedEdges(new Set())}
              onConnect={onConnect}
              deleteKeyCode={['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.15}
              colorMode="dark"
            >
              <Background color="#2a2723" gap={22} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) => (n.type === 'chain' ? ((n.data as unknown as ChainData).color ?? '#5a544a') : FLOW_META[n.type as Exclude<MapNodeKind, 'chain'>]?.color ?? '#5a544a')}
                maskColor="rgba(15,14,13,0.7)"
              />
            </ReactFlow>
          </div>
          {canvas.grip}
          <div className="legend">
            {LINK_KINDS.map((k) => (
              <span key={k.key}>
                <i style={{ borderColor: k.color, borderTopStyle: k.dash ? 'dashed' : 'solid' }} />
                {k.label}
              </span>
            ))}
            <span>
              <i style={{ borderColor: BACK_COLOR, borderTopStyle: 'dashed' }} />
              Go back
            </span>
            <span style={{ width: 12 }} />
            {types.map((t) => (
              <span key={t.id}>
                <b style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: t.color }} />
                {t.name}
              </span>
            ))}
            <span className="muted">
              Drag from a node’s right dot to another node to link them · Double-click a chain to open it in the quest editor · Drag on empty space to box-select · Move around with the right or middle mouse button, or hold Space and drag
            </span>
          </div>
        </div>

        <aside className="panel side" aria-label="Details">
          {selectedIds.length > 1 ? (
            <>
              <span className="section-label">{selectedIds.length} NODES SELECTED</span>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Drag one of them to move them together. Removing chains from the map doesn’t delete the chains.
              </p>
              <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={() => deleteNodes(selectedIds)}>
                <Icon name="trash" /> Remove from map
              </button>
            </>
          ) : selNode ? (
            <NodePanel
              key={selNode.id}
              node={selNode}
              chain={chainById.get(selNode.chain_id ?? '')}
              quests={selNode.chain_id ? questsOf(selNode.chain_id) : []}
              rewards={selNode.chain_id ? rewardsByChain.get(selNode.chain_id) : undefined}
              edges={edges}
              allNodes={nodes}
              nodeName={nodeName}
              onOpen={openInEditor}
              onSelect={select}
              onDelete={() => deleteNodes([selNode.id])}
            />
          ) : selEdges.length ? (
            <LinkPanel links={selEdges} nodeName={(id) => nodeName(nodeById.get(id))} onDone={() => setSelectedEdges(new Set())} />
          ) : (
            <>
              <span className="section-label">QUEST CHAINS</span>
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                Each chain is one node, coloured by its quest type. Link them in the order the player meets them, and use AND, OR, Pick one and Go back to shape the flow.
              </p>
              {missing.length > 1 && (
                <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={addAllMissing}>
                  <Icon name="plus" size={14} /> Add all {missing.length} missing chains
                </button>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {chains.map((c) => {
                  const mapNode = nodes.find((n) => n.kind === 'chain' && n.chain_id === c.id);
                  return (
                    <div key={c.id} className="list-row" style={{ gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: typeColor(c), flex: 'none' }} />
                      <span className="grow" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</strong>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {defs.get(c.type ?? '')?.name ?? 'No type'} · {questsOf(c.id).length} quests
                        </span>
                      </span>
                      {mapNode ? (
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => {
                            select(mapNode.id);
                            rf.fitView({ nodes: [{ id: mapNode.id }], padding: 1.2, duration: 300, maxZoom: 1.2 });
                          }}
                        >
                          Show
                        </button>
                      ) : (
                        <button type="button" className="btn small" onClick={() => select(addChain(c))}>
                          <Icon name="plus" size={14} /> Add
                        </button>
                      )}
                    </div>
                  );
                })}
                {chains.length === 0 && <span className="muted">No quest chains yet. Create them in the Quests editor.</span>}
              </div>
              <RewardBalance
                rows={nodes
                  .filter((n) => n.kind === 'chain' && n.chain_id && chainById.has(n.chain_id))
                  .sort((a, b) => a.x - b.x || a.y - b.y)
                  .map((n) => ({ id: n.id, chain: chainById.get(n.chain_id!)!, color: typeColor(chainById.get(n.chain_id!)), r: rewardsByChain.get(n.chain_id!)! }))}
                onSelect={select}
              />
            </>
          )}
        </aside>
      </div>
      </div>
    </div>
  );
}

// ---------- side panels ----------
function NodePanel(props: {
  node: MapNode;
  chain?: QuestChain;
  quests: QuestNode[];
  rewards?: ReturnType<typeof chainRewards>;
  edges: MapEdge[];
  allNodes: MapNode[];
  nodeName: (n?: MapNode) => string;
  onOpen: (chainId: string) => void;
  onSelect: (id: string) => void;
  onDelete: () => void;
}) {
  const { node, chain, quests, edges } = props;
  const defs = useDefinitions();
  const setData = (patch: Record<string, unknown>) => update('map_nodes', node.id, { data: { ...node.data, ...patch } });
  const byId = new Map(props.allNodes.map((n) => [n.id, n]));
  const ins = edges.filter((e) => e.target === node.id);
  const outs = edges.filter((e) => e.source === node.id);
  const linkList = (title: string, list: MapEdge[], other: (e: MapEdge) => string) =>
    list.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="field-label">{title}</span>
        {list.map((e) => (
          <button key={e.id} type="button" className="list-row link-row" onClick={() => props.onSelect(other(e))}>
            <span style={{ width: 16, height: 3, borderRadius: 2, background: linkKind(e.kind).color, flex: 'none' }} />
            <span className="grow">{props.nodeName(byId.get(other(e)))}</span>
            {e.label && <span className="muted" style={{ fontSize: 11 }}>{e.label}</span>}
          </button>
        ))}
      </div>
    );

  if (node.kind === 'chain') {
    const color = defs.get(chain?.type ?? '')?.color ?? chain?.color ?? '#5a544a';
    return (
      <>
        <span className="section-label" style={{ color }}>QUEST CHAIN</span>
        {!chain ? (
          <p className="muted">This chain was deleted in the quest editor.</p>
        ) : (
          <>
            <TextField value={chain.name} label="Chain name" onCommit={(v) => v.trim() && update('quest_chains', chain.id, { name: v.trim() })} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700 }} />
            <label className="field">
              <span className="field-label">Quest type</span>
              <DefSelect options={defs.list('quest_type')} value={chain.type} onChange={(v) => update('quest_chains', chain.id, { type: v })} label="Quest type" allowEmpty />
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="field-label">Quests ({quests.length})</span>
              {quests.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No quests yet.</span>}
              {quests.map((q, i) => (
                <span key={q.id} style={{ fontSize: 13, display: 'flex', gap: 8 }}>
                  <span className="muted" style={{ width: 16 }}>{i + 1}.</span>
                  {q.data.name || 'Untitled'}
                  <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>{q.data.code}</span>
                </span>
              ))}
            </div>
            <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => props.onOpen(chain.id)}>
              Open in quest editor →
            </button>
            {props.rewards && <ChainRewardsBox r={props.rewards} />}
          </>
        )}
        {linkList('Comes after', ins, (e) => e.source)}
        {linkList('Leads to', outs, (e) => e.target)}
        <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={props.onDelete}>
          <Icon name="trash" /> Remove from map
        </button>
        <span className="muted" style={{ fontSize: 12 }}>Removing it from the map doesn’t delete the chain or its quests.</span>
      </>
    );
  }

  const m = FLOW_META[node.kind];
  return (
    <>
      <span className="section-label" style={{ color: m.color }}>{m.label.toUpperCase()}</span>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{m.hint}</p>
      {node.kind === 'note' ? (
        <TextField multiline rows={5} value={node.data.text ?? ''} label="Note" placeholder="Write a note for the team" onCommit={(v) => setData({ text: v })} />
      ) : node.kind === 'back' ? (
        <label className="field">
          <span className="field-label">Go back to</span>
          <span className="select-wrap">
            <select aria-label="Go back to" value={node.data.ref ?? ''} onChange={(e) => setData({ ref: e.target.value || null })} style={{ paddingLeft: 10 }}>
              <option value="">Pick a point on the map…</option>
              {props.allNodes
                .filter((n) => n.id !== node.id && n.kind !== 'note' && n.kind !== 'back')
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {props.nodeName(n)}
                  </option>
                ))}
            </select>
          </span>
        </label>
      ) : (
        <label className="field">
          <span className="field-label">Label (optional)</span>
          <TextField
            value={node.data.label ?? ''}
            label="Label"
            placeholder={node.kind === 'start' ? 'e.g. Act I begins' : node.kind === 'end' ? 'e.g. End of Act I' : node.kind === 'split' ? 'e.g. Join a faction' : 'e.g. Both guilds helped'}
            onCommit={(v) => setData({ label: v })}
          />
        </label>
      )}
      {linkList('Comes from', ins, (e) => e.source)}
      {linkList('Leads to', outs, (e) => e.target)}
      <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={props.onDelete}>
        <Icon name="trash" /> Delete node
      </button>
    </>
  );
}

function LinkPanel({ links, nodeName, onDone }: { links: MapEdge[]; nodeName: (id: string) => string; onDone: () => void }) {
  const one = links.length === 1 ? links[0] : null;
  const kind = one ? one.kind : links.every((l) => l.kind === links[0].kind) ? links[0].kind : null;
  return (
    <>
      <span className="section-label">{one ? 'LINK' : `${links.length} LINKS`}</span>
      {one && (
        <span style={{ fontSize: 14 }}>
          {nodeName(one.source)} <span className="muted">→</span> {nodeName(one.target)}
        </span>
      )}
      <div className="field">
        <span className="field-label">Type of link</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {LINK_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={'link-kind' + (kind === k.key ? ' on' : '')}
              aria-pressed={kind === k.key}
              onClick={() => group(() => links.forEach((l) => update('map_edges', l.id, { kind: k.key })))}
            >
              <svg width="34" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="26" y2="5" stroke={k.color} strokeWidth="3" strokeDasharray={k.dash} />
                <path d="M25 1 L33 5 L25 9 Z" fill={k.color} />
              </svg>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {one && (
        <label className="field">
          <span className="field-label">Label (optional)</span>
          <TextField value={one.label} label="Link label" placeholder="e.g. Requires Sworn to the Watch" onCommit={(v) => update('map_edges', one.id, { label: v })} />
        </label>
      )}
      <button
        type="button"
        className="btn warn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          remove('map_edges', links.map((l) => l.id));
          onDone();
        }}
      >
        <Icon name="trash" /> Cut {one ? 'link' : 'links'}
      </button>
    </>
  );
}

/** Rewards of one chain: totals, then per quest / ending. */
function ChainRewardsBox({ r }: { r: ReturnType<typeof chainRewards> }) {
  return (
    <div className="card-box" style={{ gap: 10 }}>
      <span className="section-label">TOTAL REWARDS</span>
      {r.lines.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>No rewards in this chain yet.</span>
      ) : (
        <div className="reward-lines">
          {r.lines.map((l) => (
            <RewardLineView key={l.key} l={l} big />
          ))}
        </div>
      )}
      {r.endings > 1 && (
        <span className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
          Includes the rewards of all {r.endings} endings. A player only reaches one of them, so the real total is lower.
        </span>
      )}
      {r.sources.length > 0 && (
        <details>
          <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Per quest and ending</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {r.sources.map((s, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: s.kind === 'end' ? '#e0a083' : 'var(--text)' }}>{s.name}</span>
                <div className="reward-lines">
                  {s.lines.map((l) => (
                    <RewardLineView key={l.key} l={l} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RewardLineView({ l, big }: { l: RewardLine; big?: boolean }) {
  return (
    <span className={'reward-line' + (big ? ' big' : '')}>
      {l.item ? <ItemIcon name={l.item.name} icon={l.item.icon_url} color={l.color} edge={l.color} size={big ? 18 : 14} /> : <i style={{ background: l.color }} />}
      {lineText(l)}
    </span>
  );
}

/** Every chain on the map (left to right) with its totals per reward, as bars, to compare and balance them. */
function RewardBalance({ rows, onSelect }: { rows: { id: string; chain: QuestChain; color: string; r: ReturnType<typeof chainRewards> }[]; onSelect: (id: string) => void }) {
  if (!rows.length) return null;
  const kinds = new Map<string, RewardLine>();
  rows.forEach((row) => row.r.lines.filter((l) => l.numeric).forEach((l) => !kinds.has(l.key) && kinds.set(l.key, l)));
  const list = sortLines([...kinds.values()]);
  const others = (r: ReturnType<typeof chainRewards>) => r.lines.filter((l) => !l.numeric);
  return (
    <div className="card-box" style={{ gap: 12, padding: 12 }}>
      <span className="section-label">REWARD BALANCE</span>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>Each chain on the map, left to right. Click a chain to see its rewards per quest.</span>
      {list.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No XP, currency or reputation rewards yet.</span>}
      {list.map((k) => {
        const vals = rows.map((row) => row.r.lines.find((l) => l.key === k.key)?.amount ?? 0);
        const max = Math.max(1, ...vals.map(Math.abs));
        const total = vals.reduce((a, b) => a + b, 0);
        return (
          <div key={k.key} className="bal-group">
            <div className="bal-head">
              <span style={{ color: k.color }}>{k.item ? <ItemIcon name={k.item.name} icon={k.item.icon_url} color={k.color} size={14} /> : null} {k.label}</span>
              <span>total {fmt(total)}</span>
            </div>
            {rows.map((row, i) => (
              <button key={row.id} type="button" className="bal-row" onClick={() => onSelect(row.id)}>
                <span className="bal-name">
                  <i style={{ background: row.color }} />
                  {row.chain.name}
                </span>
                <span className="bal-track">
                  <span style={{ width: `${(Math.abs(vals[i]) / max) * 100}%`, background: vals[i] < 0 ? '#e0705d' : k.color }} />
                </span>
                <span className="bal-val">{vals[i] ? fmt(vals[i]) : '—'}</span>
              </button>
            ))}
          </div>
        );
      })}
      {rows.some((row) => others(row.r).length) && (
        <div className="bal-group">
          <div className="bal-head">
            <span>Items and other rewards</span>
          </div>
          {rows
            .filter((row) => others(row.r).length)
            .map((row) => (
              <button key={row.id} type="button" className="bal-row other" onClick={() => onSelect(row.id)}>
                <span className="bal-name">
                  <i style={{ background: row.color }} />
                  {row.chain.name}
                </span>
                <span className="reward-lines">
                  {others(row.r).map((l) => (
                    <RewardLineView key={l.key} l={l} />
                  ))}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
