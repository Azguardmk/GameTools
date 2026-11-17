import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { insert, newId, remove, snapshot, update, useTable } from '../lib/db';
import { download, useDefinitions, useMembers } from '../lib/hooks';
import { enumKey, type EdgeKind, type Item, type NodeKind, type QuestChain, type QuestData, type QuestEdge, type QuestNode, type Task, type TaskGroup } from '../lib/types';
import { DefSelect, Icon, MemberBadge, SwatchPicker, TextField } from '../components/ui';

export const EDGE_COLORS: Record<EdgeKind, string> = {
  unlocks: '#d9a75e',
  condition: '#c294d6',
  choice: '#e0805d',
  external: '#c294d6',
};

type Ctx = {
  defs: ReturnType<typeof useDefinitions>;
  members: ReturnType<typeof useMembers>;
  itemsById: Map<string, Item>;
  allNodes: Map<string, QuestNode>;
  chains: Map<string, QuestChain>;
  problems: Map<string, string[]>;
};
const QuestCtx = createContext<Ctx>(null as unknown as Ctx);

export function questLabel(n: QuestNode | undefined) {
  if (!n) return 'Missing quest';
  return n.data.name || n.data.code || 'Untitled quest';
}

// ---------- problem checks ----------
function findProblems(nodes: QuestNode[], items: Item[]) {
  const itemIds = new Set(items.map((i) => i.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const add = (id: string, msg: string) => out.set(id, [...(out.get(id) ?? []), msg]);
  for (const n of nodes) {
    if (n.kind === 'quest') {
      const d = n.data as QuestData;
      if (!d.name?.trim()) add(n.id, 'Quest has no name');
      if (!d.rewards?.length) add(n.id, 'Quest has no reward');
      if (!d.objectives?.length) add(n.id, 'Quest has no objectives');
      d.required_items?.forEach((r) => !itemIds.has(r.item) && add(n.id, 'A required item was deleted'));
      d.rewards?.forEach((r) => r.item && !itemIds.has(r.item) && add(n.id, 'A reward item was deleted'));
    }
    if (n.kind === 'external') {
      const ref = byId.get(n.data.ref);
      if (!ref) add(n.id, 'Linked quest no longer exists');
    }
  }
  return out;
}

// ---------- custom nodes ----------
function QuestNodeView({ data, selected }: NodeProps) {
  const { defs, members, problems } = useContext(QuestCtx);
  const n = data.node as QuestNode;
  const d = n.data as QuestData;
  const status = defs.get(d.status);
  const type = defs.get(d.type);
  const who = members.get(d.assignee);
  const warn = problems.get(n.id);
  return (
    <div className={'qnode' + (selected ? ' selected' : '')}>
      <Handle type="target" position={Position.Left} />
      <div className="qhead">
        <span>{d.code || 'NO ID'}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: type?.color ?? 'var(--muted)', fontWeight: 500 }}>
          {type?.name}
          {warn && (
            <span style={{ color: 'var(--danger)', display: 'flex' }} title={warn.join('\n')}>
              <Icon name="warn" size={13} />
            </span>
          )}
        </span>
      </div>
      <div className="qbody">
        <span className="qname">{d.name || 'Untitled quest'}</span>
        <span className="qrow">
          {d.level ? 'Lv ' + d.level + ' · ' : ''}
          {d.objectives?.length ?? 0} objectives
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

function SimpleNode({ data, selected, kind }: NodeProps & { kind: 'condition' | 'choice' }) {
  const n = data.node as QuestNode;
  const c = kind === 'condition' ? { line: '#c294d6', bg: '#1d1820', label: 'CONDITION', lc: '#d4b0e3' } : { line: '#e0805d', bg: '#211714', label: 'PLAYER CHOICE', lc: '#f0a083' };
  return (
    <div className={'snode' + (selected ? ' selected' : '')} style={{ borderColor: c.line, background: c.bg }}>
      <Handle type="target" position={Position.Left} />
      <span className="klabel" style={{ color: c.lc }}>
        {c.label}
      </span>
      <span className="ktext">{n.data.text || '…'}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ExternalNode({ data, selected }: NodeProps) {
  const { allNodes, chains, problems } = useContext(QuestCtx);
  const n = data.node as QuestNode;
  const ref = allNodes.get(n.data.ref);
  const chain = ref ? chains.get(ref.chain_id) : undefined;
  return (
    <div className={'snode' + (selected ? ' selected' : '')} style={{ borderColor: '#c294d6', borderStyle: 'dashed', background: '#1d1820' }}>
      <Handle type="target" position={Position.Left} />
      <span className="klabel" style={{ color: '#d4b0e3', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="link" size={12} /> NEEDS QUEST · OTHER CHAIN
      </span>
      <span className="ktext">{questLabel(ref)}</span>
      <span style={{ fontSize: 11, color: problems.get(n.id) ? 'var(--danger)' : '#b9afc0' }}>
        {ref ? `${ref.data.code || ''}${ref.data.code ? ' · ' : ''}${chain?.name ?? ''}` : 'Pick a quest in the panel'}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = {
  quest: QuestNodeView,
  condition: (p: NodeProps) => <SimpleNode {...p} kind="condition" />,
  choice: (p: NodeProps) => <SimpleNode {...p} kind="choice" />,
  external: ExternalNode,
};

// ---------- page ----------
export default function QuestsPage() {
  return (
    <ReactFlowProvider>
      <QuestsInner />
    </ReactFlowProvider>
  );
}

function QuestsInner() {
  const { rows: chainsRaw } = useTable<QuestChain>('quest_chains');
  const { rows: allNodesRaw } = useTable<QuestNode>('quest_nodes');
  const { rows: allEdges } = useTable<QuestEdge>('quest_edges');
  const { rows: items } = useTable<Item>('items');
  const defs = useDefinitions();
  const members = useMembers();
  const [params, setParams] = useSearchParams();
  const rf = useReactFlow();

  const chains = useMemo(() => [...chainsRaw].sort((a, b) => a.sort - b.sort), [chainsRaw]);
  const chainId = params.get('chain') && chains.some((c) => c.id === params.get('chain')) ? params.get('chain')! : chains[0]?.id;
  const selId = params.get('node');
  const setSel = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('node', id);
      else n.delete('node');
      return n;
    }, { replace: true });
  const openChain = (id: string, node?: string) => setParams(node ? { chain: id, node } : { chain: id });

  const chainNodes = useMemo(() => allNodesRaw.filter((n) => n.chain_id === chainId), [allNodesRaw, chainId]);
  const chainEdges = useMemo(() => allEdges.filter((e) => e.chain_id === chainId), [allEdges, chainId]);
  const problems = useMemo(() => findProblems(allNodesRaw, items), [allNodesRaw, items]);
  const ctx: Ctx = useMemo(
    () => ({
      defs,
      members,
      itemsById: new Map(items.map((i) => [i.id, i])),
      allNodes: new Map(allNodesRaw.map((n) => [n.id, n])),
      chains: new Map(chains.map((c) => [c.id, c])),
      problems,
    }),
    [defs, members, items, allNodesRaw, chains, problems],
  );

  // React Flow keeps its own node list while dragging; rebuild it whenever the data changes.
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  useEffect(() => {
    setRfNodes(chainNodes.map((n) => ({ id: n.id, type: n.kind, position: { x: n.x, y: n.y }, data: { node: n }, selected: n.id === selId })));
  }, [chainNodes, selId]);

  const rfEdges: Edge[] = useMemo(
    () =>
      chainEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label || undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 5,
        style: { stroke: EDGE_COLORS[e.kind], strokeWidth: 2.5, strokeDasharray: e.kind === 'external' ? '6 6' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[e.kind], width: 16, height: 16 },
      })),
    [chainEdges],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) if (c.type === 'select' && c.selected) setSel(c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConnect = (c: Connection) => {
    if (!chainId || !c.source || !c.target || c.source === c.target) return;
    if (chainEdges.some((e) => e.source === c.source && e.target === c.target)) return;
    const src = chainNodes.find((n) => n.id === c.source);
    const kind: EdgeKind = src?.kind === 'condition' ? 'condition' : src?.kind === 'choice' ? 'choice' : src?.kind === 'external' ? 'external' : 'unlocks';
    const label = kind === 'choice' ? prompt('What does the player choose on this path? (e.g. Protect)') ?? '' : '';
    insert('quest_edges', { id: newId(), chain_id: chainId, source: c.source, target: c.target, kind, label });
  };

  const deleteNodes = async (ids: string[]) => {
    const edgeIds = snapshot<QuestEdge>('quest_edges')
      .filter((e) => ids.includes(e.source) || ids.includes(e.target))
      .map((e) => e.id);
    if (edgeIds.length) await remove('quest_edges', edgeIds);
    await remove('quest_nodes', ids);
    if (selId && ids.includes(selId)) setSel(null);
  };

  const addNode = (kind: NodeKind, data: Record<string, unknown>) => {
    if (!chainId) return;
    const center = rf.screenToFlowPosition({ x: window.innerWidth * 0.38, y: window.innerHeight * 0.5 });
    const id = newId();
    insert('quest_nodes', { id, chain_id: chainId, kind, x: Math.round(center.x), y: Math.round(center.y), data });
    setSel(id);
  };

  const addQuest = () => {
    const prefix = chains.find((c) => c.id === chainId)?.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'XX';
    const count = chainNodes.filter((n) => n.kind === 'quest').length + 1;
    const data: QuestData = {
      code: `Q_${prefix}_${String(count).padStart(3, '0')}`, name: '', description: '', level: '', giver: '',
      type: defs.list('quest_type')[0]?.id ?? null, region: null, district: null, status: defs.list('quest_status')[0]?.id ?? null, assignee: null,
      objectives: [], required_items: [], rewards: [],
    };
    addNode('quest', data as unknown as Record<string, unknown>);
  };

  const autoLayout = () => {
    const ids = chainNodes.map((n) => n.id);
    const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
    chainEdges.forEach((e) => incoming.get(e.target)?.push(e.source));
    const depth = new Map<string, number>();
    const visit = (id: string, guard: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (guard.has(id)) return 0;
      guard.add(id);
      const d = Math.max(-1, ...(incoming.get(id) ?? []).map((s) => visit(s, guard))) + 1;
      depth.set(id, d);
      return d;
    };
    ids.forEach((id) => visit(id, new Set()));
    const cols = new Map<number, string[]>();
    ids.forEach((id) => cols.set(depth.get(id)!, [...(cols.get(depth.get(id)!) ?? []), id]));
    cols.forEach((col, d) =>
      col.forEach((id, i) => update('quest_nodes', id, { x: d * 290, y: (i - (col.length - 1) / 2) * 190 })),
    );
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50);
  };

  const exportJson = () => {
    const name = (id: string | null | undefined) => enumKey(defs.get(id)?.name ?? '');
    const code = (id: string | null | undefined) => (id ? ctx.itemsById.get(id)?.code ?? '' : '');
    const out = chains.map((ch) => {
      const ns = allNodesRaw.filter((n) => n.chain_id === ch.id);
      const es = allEdges.filter((e) => e.chain_id === ch.id);
      const prereqs = (id: string) =>
        es
          .filter((e) => e.target === id)
          .map((e) => {
            const s = ctx.allNodes.get(e.source);
            if (!s) return null;
            if (s.kind === 'quest') return { type: 'QuestComplete', quest: s.data.code };
            if (s.kind === 'external') return { type: 'QuestComplete', quest: ctx.allNodes.get(s.data.ref)?.data.code ?? '' };
            if (s.kind === 'condition') return { type: 'Condition', text: s.data.text };
            if (s.kind === 'choice') {
              const before = es.filter((x) => x.target === s.id).map((x) => ctx.allNodes.get(x.source)?.data.code);
              return { type: 'Choice', choice: s.data.text, option: e.label, after: before };
            }
            return null;
          })
          .filter(Boolean);
      return {
        chain: ch.name,
        quests: ns
          .filter((n) => n.kind === 'quest')
          .map((n) => {
            const d = n.data as QuestData;
            return {
              id: d.code, name: d.name, description: d.description, level: d.level, giver: d.giver,
              type: name(d.type), region: name(d.region ?? defs.get(d.district)?.extra.region), district: name(d.district), devStatus: name(d.status),
              objectives: d.objectives.map((o) => ({ type: name(o.type), text: o.text, count: o.count })),
              requiredItems: d.required_items.map((r) => ({ item: code(r.item), qty: r.qty })),
              rewards: d.rewards.map((r) => ({ type: name(r.type), text: r.text, item: code(r.item), amount: r.amount })),
              prerequisites: prereqs(n.id),
            };
          }),
      };
    });
    download('earthlings-quests.json', JSON.stringify(out, null, 2), 'application/json');
  };

  const newChain = () => {
    const name = prompt('Name of the new quest chain');
    if (!name?.trim()) return;
    const id = newId();
    insert('quest_chains', { id, name: name.trim(), color: '#6fb3d6', sort: chains.length ? Math.max(...chains.map((c) => c.sort)) + 1 : 0 });
    openChain(id);
  };

  const selected = chainNodes.find((n) => n.id === selId) ?? null;
  const chain = chains.find((c) => c.id === chainId);
  const problemCount = problems.size;
  const [showProblems, setShowProblems] = useState(false);

  return (
    <QuestCtx.Provider value={ctx}>
      <div className="chain-tabs" role="navigation" aria-label="Quest chains">
        {chains.map((c) => (
          <button key={c.id} type="button" aria-current={c.id === chainId ? 'page' : undefined} onClick={() => openChain(c.id)}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color }} />
            {c.name}
            <span className="muted" style={{ fontSize: 12 }}>
              {allNodesRaw.filter((n) => n.chain_id === c.id && n.kind === 'quest').length}
            </span>
          </button>
        ))}
        <button type="button" style={{ color: 'var(--accent-text)', fontWeight: 600 }} onClick={newChain}>
          <Icon name="plus" size={14} /> New chain
        </button>
      </div>

      {!chain ? (
        <div className="panel empty" style={{ padding: 24 }}>
          No quest chains yet. Press “New chain” to start.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>
              Add
            </span>
            <button type="button" className="btn small" onClick={addQuest}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: '#d9a75e' }} /> Quest
            </button>
            <button type="button" className="btn small" onClick={() => addNode('condition', { text: '' })}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: '#c294d6' }} /> Condition
            </button>
            <button type="button" className="btn small" onClick={() => addNode('external', { ref: null })}>
              <span style={{ width: 10, height: 10, borderRadius: 3, border: '1.5px dashed #c294d6' }} /> Quest from another chain
            </button>
            <button type="button" className="btn small" onClick={() => addNode('choice', { text: '' })}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: '#e0805d' }} /> Choice
            </button>
            <div className="spacer" />
            <button type="button" className="btn small" onClick={autoLayout}>
              Auto-layout
            </button>
            {problemCount > 0 && (
              <button type="button" className="btn small warn" aria-pressed={showProblems} onClick={() => { setShowProblems(!showProblems); setSel(null); }}>
                <Icon name="warn" size={14} /> {problemCount} problem{problemCount === 1 ? '' : 's'}
              </button>
            )}
            <button type="button" className="btn small primary" onClick={exportJson}>
              <Icon name="download" size={14} /> Export to Unreal (JSON)
            </button>
          </div>

          <div className="split">
            <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="flow-wrap">
                <ReactFlow
                  key={chainId}
                  nodes={rfNodes}
                  edges={rfEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onNodeDragStop={(_e, _n, moved) => moved.forEach((m) => update('quest_nodes', m.id, { x: Math.round(m.position.x), y: Math.round(m.position.y) }))}
                  onNodesDelete={(ns) => deleteNodes(ns.map((n) => n.id))}
                  onEdgesDelete={(es) => remove('quest_edges', es.map((e) => e.id))}
                  onEdgeDoubleClick={(_e, edge) => {
                    const e = chainEdges.find((x) => x.id === edge.id);
                    if (e?.kind !== 'choice') return;
                    const label = prompt('Choice label', e.label);
                    if (label !== null) update('quest_edges', e.id, { label });
                  }}
                  onPaneClick={() => setSel(null)}
                  onConnect={onConnect}
                  deleteKeyCode={['Backspace', 'Delete']}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  minZoom={0.2}
                  colorMode="dark"
                  proOptions={{ hideAttribution: false }}
                >
                  <Background color="#2a2723" gap={22} />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'quest' ? '#d9a75e' : n.type === 'choice' ? '#e0805d' : '#c294d6')} maskColor="rgba(15,14,13,0.7)" />
                </ReactFlow>
              </div>
              <div className="legend">
                <span><i style={{ borderColor: EDGE_COLORS.unlocks }} />Unlocks</span>
                <span><i style={{ borderColor: EDGE_COLORS.condition }} />Condition</span>
                <span><i style={{ borderColor: EDGE_COLORS.external, borderTopStyle: 'dashed' }} />Quest from another chain</span>
                <span><i style={{ borderColor: EDGE_COLORS.choice }} />Choice</span>
                <span className="muted">Drag from a node’s right dot to another node to link them · Select and press Delete to remove · Double-click a choice line to rename it</span>
              </div>
            </div>

            <aside className="panel side" aria-label="Details">
              {showProblems && !selected ? (
                <ProblemList problems={problems} onOpen={(n) => { setShowProblems(false); openChain(n.chain_id, n.id); }} />
              ) : selected?.kind === 'quest' ? (
                <QuestPanel key={selected.id} node={selected} edges={chainEdges} onDelete={() => deleteNodes([selected.id])} onOpen={openChain} />
              ) : selected ? (
                <OtherPanel key={selected.id} node={selected} chainId={chainId!} onDelete={() => deleteNodes([selected.id])} onOpen={openChain} />
              ) : (
                <ChainPanel key={chain.id} chain={chain} onDeleted={() => setParams({})} />
              )}
            </aside>
          </div>
        </>
      )}
    </QuestCtx.Provider>
  );
}

// ---------- side panels ----------
function ChainPanel({ chain, onDeleted }: { chain: QuestChain; onDeleted: () => void }) {
  return (
    <>
      <span className="section-label">QUEST CHAIN</span>
      <TextField value={chain.name} label="Chain name" onCommit={(v) => v.trim() && update('quest_chains', chain.id, { name: v.trim() })} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700 }} />
      <div className="field">
        <span className="field-label">Colour</span>
        <SwatchPicker value={chain.color} onChange={(c) => update('quest_chains', chain.id, { color: c })} label="Chain colour" />
      </div>
      <p className="muted" style={{ margin: 0, lineHeight: 1.5, fontSize: 13 }}>
        Click a node to edit it. Use the Add buttons above to create quests, conditions, choices and links to quests in other chains.
      </p>
      <button
        type="button"
        className="btn warn"
        style={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          const ns = snapshot<QuestNode>('quest_nodes').filter((n) => n.chain_id === chain.id);
          if (!confirm(ns.length ? `Delete "${chain.name}" and its ${ns.length} nodes?` : `Delete "${chain.name}"?`)) return;
          const es = snapshot<QuestEdge>('quest_edges').filter((e) => e.chain_id === chain.id || ns.some((n) => n.id === e.source || n.id === e.target));
          if (es.length) await remove('quest_edges', es.map((e) => e.id));
          if (ns.length) await remove('quest_nodes', ns.map((n) => n.id));
          await remove('quest_chains', chain.id);
          onDeleted();
        }}
      >
        <Icon name="trash" /> Delete chain
      </button>
    </>
  );
}

function ProblemList({ problems, onOpen }: { problems: Map<string, string[]>; onOpen: (n: QuestNode) => void }) {
  const { allNodes, chains } = useContext(QuestCtx);
  return (
    <>
      <span className="section-label">PROBLEMS IN ALL CHAINS</span>
      {[...problems.entries()].map(([id, msgs]) => {
        const n = allNodes.get(id);
        if (!n) return null;
        return (
          <button key={id} type="button" className="card-box" style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }} onClick={() => onOpen(n)}>
            <strong>{n.kind === 'quest' ? questLabel(n) : 'Link to another chain'}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{chains.get(n.chain_id)?.name}</span>
            {msgs.map((m) => (
              <span key={m} style={{ color: 'var(--danger)', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                <Icon name="warn" size={13} /> {m}
              </span>
            ))}
          </button>
        );
      })}
    </>
  );
}

function OtherPanel({ node, chainId, onDelete, onOpen }: { node: QuestNode; chainId: string; onDelete: () => void; onOpen: (chain: string, node?: string) => void }) {
  const { allNodes, chains } = useContext(QuestCtx);
  const set = (data: Record<string, unknown>) => update('quest_nodes', node.id, { data: { ...node.data, ...data } });
  if (node.kind === 'external') {
    const options = [...allNodes.values()].filter((n) => n.kind === 'quest' && n.chain_id !== chainId);
    const ref = allNodes.get(node.data.ref);
    return (
      <>
        <span className="section-label">NEEDS A QUEST FROM ANOTHER CHAIN</span>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Connect this node to the quests that need it. The player must finish the chosen quest first.
        </p>
        <label className="field">
          <span className="field-label">Quest</span>
          <span className="select-wrap">
            <select aria-label="Quest from another chain" value={node.data.ref ?? ''} onChange={(e) => set({ ref: e.target.value || null })} style={{ paddingLeft: 10 }}>
              <option value="">— choose a quest —</option>
              {options.map((q) => (
                <option key={q.id} value={q.id}>
                  {chains.get(q.chain_id)?.name} · {q.data.code} {q.data.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        {ref && (
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => onOpen(ref.chain_id, ref.id)}>
            Open “{questLabel(ref)}”
          </button>
        )}
        <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={onDelete}>
          <Icon name="trash" /> Delete node
        </button>
      </>
    );
  }
  return (
    <>
      <span className="section-label">{node.kind === 'condition' ? 'CONDITION' : 'PLAYER CHOICE'}</span>
      <TextField
        multiline
        value={node.data.text ?? ''}
        label="Text"
        placeholder={node.kind === 'condition' ? 'e.g. Level ≥ 5, Reputation ≥ Friendly' : 'e.g. Protect or expose the Guild?'}
        onCommit={(v) => set({ text: v })}
      />
      {node.kind === 'choice' && (
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Connect the choice to one quest per option. You'll be asked for the option's label, and you can double-click a line to rename it.
        </p>
      )}
      <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={onDelete}>
        <Icon name="trash" /> Delete node
      </button>
    </>
  );
}

function QuestPanel({ node, edges, onDelete, onOpen }: { node: QuestNode; edges: QuestEdge[]; onDelete: () => void; onOpen: (chain: string, node?: string) => void }) {
  const { defs, members, itemsById, allNodes } = useContext(QuestCtx);
  const d = node.data as QuestData;
  const set = (patch: Partial<QuestData>) => update('quest_nodes', node.id, { data: { ...node.data, ...patch } });
  const items = [...itemsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  const objTypes = defs.list('objective_type');
  const rewardTypes = defs.list('reward_type');

  const describe = (n: QuestNode | undefined, e?: QuestEdge) => {
    if (!n) return '?';
    if (n.kind === 'quest') return questLabel(n);
    if (n.kind === 'condition') return n.data.text || 'Condition';
    if (n.kind === 'choice') return `${n.data.text || 'Choice'}${e?.label ? ' → ' + e.label : ''}`;
    return questLabel(allNodes.get(n.data.ref)) + ' (other chain)';
  };
  const needs = edges.filter((e) => e.target === node.id);
  const unlocks = edges.filter((e) => e.source === node.id);

  const createTask = async () => {
    const groups = snapshot<TaskGroup>('task_groups');
    let group = groups.find((g) => g.name.toLowerCase() === 'quests');
    if (!group) {
      group = { id: newId(), name: 'Quests', color: '#d9a75e', sort: groups.length ? Math.max(...groups.map((g) => g.sort)) + 1 : 0, collapsed: false };
      await insert('task_groups', group);
    }
    const tasks = snapshot<Task>('tasks');
    await insert('tasks', {
      id: newId(), group_id: group.id, title: `Build quest ${d.code} ${d.name}`.trim(), notes: 'Created from the quest editor',
      assignees: d.assignee ? [d.assignee] : [], priority: defs.list('task_priority')[1]?.id ?? null, status: defs.list('task_status')[0]?.id ?? null,
      done: false, done_by: null, done_at: null, sort: tasks.length,
    });
    alert('Task added to the "Quests" group on the task board.');
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <TextField value={d.code} label="Quest ID" onCommit={(v) => set({ code: v.replace(/\s+/g, '') })} style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent-text)' }} />
        <TextField value={d.name} label="Quest name" placeholder="Quest name" onCommit={(v) => set({ name: v })} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700 }} autoFocus={!d.name} />
        <TextField multiline value={d.description} label="Description" placeholder="Short description / dialogue notes" onCommit={(v) => set({ description: v })} />
      </div>

      <div className="grid2">
        <label className="field">
          <span className="field-label">Quest giver</span>
          <TextField value={d.giver} label="Quest giver" onCommit={(v) => set({ giver: v })} />
        </label>
        <label className="field">
          <span className="field-label">Level</span>
          <TextField value={d.level} label="Level range" placeholder="e.g. 5–7" onCommit={(v) => set({ level: v })} />
        </label>
        <label className="field">
          <span className="field-label">Type</span>
          <DefSelect options={defs.list('quest_type')} value={d.type} onChange={(v) => set({ type: v })} label="Quest type" />
        </label>
        <label className="field">
          <span className="field-label">Region</span>
          <DefSelect
            options={defs.list('region')}
            value={d.region ?? defs.get(d.district)?.extra.region ?? null}
            onChange={(v) => set({ region: v, district: v && defs.get(d.district)?.extra.region === v ? d.district : null })}
            label="Region"
            allowEmpty
          />
        </label>
        <label className="field">
          <span className="field-label">District</span>
          <DefSelect
            options={defs.list('district').filter((x) => !(d.region ?? defs.get(d.district)?.extra.region) || x.extra.region === (d.region ?? defs.get(d.district)?.extra.region))}
            value={d.district}
            onChange={(v) => set({ district: v, region: v ? defs.get(v)?.extra.region ?? d.region : d.region })}
            label="District"
            allowEmpty
          />
        </label>
        <label className="field">
          <span className="field-label">Status</span>
          <DefSelect options={defs.list('quest_status')} value={d.status} onChange={(v) => set({ status: v })} label="Status" />
        </label>
        <label className="field">
          <span className="field-label">Assigned to</span>
          <span className="select-wrap">
            <select aria-label="Assigned to" value={d.assignee ?? ''} onChange={(e) => set({ assignee: e.target.value || null })} style={{ paddingLeft: 10 }}>
              <option value="">Unassigned</option>
              {members.list.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <div className="card-box">
        <span className="section-label">OBJECTIVES</span>
        {d.objectives.map((o, i) => (
          <div key={i} className="list-row" style={{ flexWrap: 'wrap' }}>
            <span style={{ width: 22, color: 'var(--accent-text)', fontWeight: 700 }}>{i + 1}</span>
            <span style={{ width: 120 }}>
              <DefSelect options={objTypes} value={o.type} onChange={(v) => set({ objectives: d.objectives.map((x, j) => (j === i ? { ...x, type: v } : x)) })} label="Objective type" />
            </span>
            <span className="grow" style={{ minWidth: 120 }}>
              <TextField value={o.text} label="Objective" placeholder="What to do" onCommit={(v) => set({ objectives: d.objectives.map((x, j) => (j === i ? { ...x, text: v } : x)) })} />
            </span>
            <input className="input" type="number" min={1} aria-label="Count" value={o.count} style={{ width: 64 }} onChange={(e) => set({ objectives: d.objectives.map((x, j) => (j === i ? { ...x, count: Math.max(1, parseInt(e.target.value) || 1) } : x)) })} />
            <button type="button" className="icon-btn danger" aria-label="Remove objective" onClick={() => set({ objectives: d.objectives.filter((_, j) => j !== i) })}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ objectives: [...d.objectives, { type: objTypes[0]?.id ?? null, text: '', count: 1 }] })}>
          <Icon name="plus" size={14} /> Add objective
        </button>
      </div>

      <div className="card-box">
        <span className="section-label">REQUIRED ITEMS</span>
        {d.required_items.map((r, i) => (
          <div key={i} className="list-row">
            <input className="input" type="number" min={1} aria-label="Quantity" value={r.qty} style={{ width: 64 }} onChange={(e) => set({ required_items: d.required_items.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x)) })} />
            <span className="select-wrap grow">
              <select aria-label="Required item" value={r.item} style={{ paddingLeft: 10 }} onChange={(e) => set({ required_items: d.required_items.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)) })}>
                {!itemsById.has(r.item) && <option value={r.item}>Deleted item</option>}
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </span>
            <button type="button" className="icon-btn danger" aria-label="Remove required item" onClick={() => set({ required_items: d.required_items.filter((_, j) => j !== i) })}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        {d.required_items.length === 0 && <span className="muted" style={{ fontSize: 13 }}>None</span>}
        <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} disabled={!items.length} onClick={() => set({ required_items: [...d.required_items, { item: items[0].id, qty: 1 }] })}>
          <Icon name="plus" size={14} /> Add required item
        </button>
      </div>

      <div className="card-box">
        <span className="section-label">REWARDS</span>
        {d.rewards.map((r, i) => {
          const patch = (p: Partial<typeof r>) => set({ rewards: d.rewards.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
              <div className="list-row">
                <span className="grow">
                  <DefSelect options={rewardTypes} value={r.type} onChange={(v) => patch({ type: v })} label="Reward type" />
                </span>
                <input className="input" type="number" aria-label="Amount" value={r.amount} style={{ width: 84 }} onChange={(e) => patch({ amount: parseInt(e.target.value) || 0 })} />
                <button type="button" className="icon-btn danger" aria-label="Remove reward" onClick={() => set({ rewards: d.rewards.filter((_, j) => j !== i) })}>
                  <Icon name="x" />
                </button>
              </div>
              <div className="list-row">
                <span className="select-wrap grow">
                  <select aria-label="Reward item (optional)" value={r.item ?? ''} style={{ paddingLeft: 10 }} onChange={(e) => patch({ item: e.target.value || null })}>
                    <option value="">No item</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="grow">
                  <TextField value={r.text} label="Reward note" placeholder="Note, e.g. faction or title" onCommit={(v) => patch({ text: v })} />
                </span>
              </div>
            </div>
          );
        })}
        {d.rewards.length === 0 && (
          <div className="warn-box">
            <Icon name="warn" /> This quest has no reward yet
          </div>
        )}
        <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ rewards: [...d.rewards, { type: rewardTypes[0]?.id ?? null, text: '', item: null, amount: 1 }] })}>
          <Icon name="plus" size={14} /> Add reward
        </button>
      </div>

      <div className="grid2">
        <div className="field">
          <span className="section-label">NEEDS</span>
          {needs.map((e) => {
            const s = allNodes.get(e.source);
            const target = s?.kind === 'external' ? allNodes.get(s.data.ref) : s?.kind === 'quest' ? s : undefined;
            return target ? (
              <button key={e.id} type="button" className="btn ghost small" style={{ justifyContent: 'flex-start', color: '#d4b0e3', padding: 0 }} onClick={() => onOpen(target.chain_id, target.id)}>
                {describe(s, e)}
              </button>
            ) : (
              <span key={e.id} style={{ color: '#d4b0e3', fontSize: 13 }}>
                {describe(s, e)}
              </span>
            );
          })}
          {needs.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Nothing — available from the start</span>}
        </div>
        <div className="field">
          <span className="section-label">UNLOCKS</span>
          {unlocks.map((e) => (
            <span key={e.id} style={{ color: 'var(--accent-text)', fontSize: 13 }}>
              {describe(allNodes.get(e.target))}
            </span>
          ))}
          {unlocks.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Nothing yet</span>}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <button type="button" className="btn" onClick={createTask}>
          Create task on board
        </button>
        <button type="button" className="btn warn" onClick={() => confirm(`Delete quest "${questLabel(node)}"?`) && onDelete()}>
          <Icon name="trash" /> Delete quest
        </button>
      </div>
    </>
  );
}
