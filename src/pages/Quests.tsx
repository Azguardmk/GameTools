import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  SelectionMode,
} from '@xyflow/react';
import { insert, newId, remove, snapshot, update, useTable } from '../lib/db';
import { SWATCHES, download, useDefinitions, useMembers } from '../lib/hooks';
import { enumKey, type Item, type NodeKind, type QuestChain, type QuestData, type QuestEdge, type QuestNode, type Task, type TaskGroup } from '../lib/types';
import {
  ACTION_OPS,
  EDGE_COLORS,
  NODE_META,
  NO,
  OPS,
  OUTCOMES,
  QuestCtx,
  YES,
  actionText,
  conditionText,
  edgeColor,
  edgeKindFor,
  edgeLabel,
  choiceOptions,
  findProblems,
  type ChoiceOption,
  nodeTypes,
  edgeTypes,
  questLabel,
  varType,
  type Ctx,
} from './quest/shared';
import PlayMode from './quest/Play';
import { DefSelect, Icon, SwatchPicker, TextField } from '../components/ui';

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
  const problems = useMemo(() => findProblems(allNodesRaw, allEdges, items, defs), [allNodesRaw, allEdges, items, defs]);
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
  // Keeps the current selection (one or many nodes) when the data refreshes.
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const pendingSelect = useRef<Set<string> | null>(null);
  useEffect(() => {
    setRfNodes((prev) => {
      // Right after duplicating, select the copies instead of the originals.
      const pending = pendingSelect.current;
      if (pending && chainNodes.some((n) => pending.has(n.id))) {
        pendingSelect.current = null;
        return chainNodes.map((n) => ({ id: n.id, type: n.kind, position: { x: n.x, y: n.y }, data: { node: n }, selected: pending.has(n.id) }));
      }
      const was = new Set(prev.filter((p) => p.selected).map((p) => p.id));
      return chainNodes.map((n) => ({ id: n.id, type: n.kind, position: { x: n.x, y: n.y }, data: { node: n }, selected: was.has(n.id) || n.id === selId }));
    });
  }, [chainNodes, selId]);
  const selectedIds = rfNodes.filter((n) => n.selected).map((n) => n.id);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());

  const choiceEdgeLabel = (e: QuestEdge) => {
    if (e.kind !== 'choice' || !e.source_handle) return undefined;
    const opts = choiceOptions(chainNodes.find((n) => n.id === e.source));
    const i = opts.findIndex((o) => o.id === e.source_handle);
    return i < 0 ? undefined : `${i + 1}. ${opts[i].text || 'Option ' + (i + 1)}`;
  };
  const rfEdges: Edge[] = useMemo(
    () =>
      chainEdges.map((e) => ({
        id: e.id,
        type: 'link',
        source: e.source,
        sourceHandle: e.source_handle ?? undefined,
        target: e.target,
        selected: selectedEdges.has(e.id),
        interactionWidth: 26,
        data: { label: choiceEdgeLabel(e) ?? edgeLabel(e), color: edgeColor(e) },
        style: { stroke: edgeColor(e), strokeWidth: selectedEdges.has(e.id) ? 4 : 2.5, strokeDasharray: e.kind === 'external' ? '6 6' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(e), width: 16, height: 16 },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainEdges, selectedEdges, chainNodes],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((ns) => applyNodeChanges(changes, ns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // One node selected → show it in the side panel. Several → the panel shows the group.
  useEffect(() => {
    if (selectedIds.length === 1 && selectedIds[0] !== selId) setSel(selectedIds[0]);
    if (selectedIds.length > 1 && selId) setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(',')]);
  const onEdgesChange = (changes: EdgeChange[]) => {
    const next = new Set(selectedEdges);
    let changed = false;
    for (const c of changes) {
      if (c.type === 'select') {
        changed = true;
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
    }
    if (changed) setSelectedEdges(next);
  };

  const onConnect = (c: Connection) => {
    if (!chainId || !c.source || !c.target || c.source === c.target) return;
    const handle = c.sourceHandle ?? null;
    if (chainEdges.some((e) => e.source === c.source && e.target === c.target && (e.source_handle ?? null) === handle)) return;
    const src = chainNodes.find((n) => n.id === c.source);
    const kind = edgeKindFor(src);
    let label = '';
    if (kind === 'choice') {
      const opt = choiceOptions(src).find((o) => o.id === handle);
      if (opt) label = opt.text;
      else {
        const l = prompt('What does the player choose on this path? (e.g. Protect the Guild)');
        if (l === null) return;
        label = l;
      }
    }
    if (kind === 'response') {
      const l = prompt('The player’s reply on this path (leave empty for a plain “Continue”)');
      if (l === null) return;
      label = l;
    }
    insert('quest_edges', { id: newId(), chain_id: chainId, source: c.source, target: c.target, kind, label, source_handle: kind === 'condition' ? handle ?? 'yes' : kind === 'choice' ? handle : null });
  };

  /** Copies nodes (and the links between them) a little down and to the right, then selects the copies. */
  const duplicateNodes = async (ids: string[]) => {
    const src = chainNodes.filter((n) => ids.includes(n.id));
    if (!src.length) return;
    const idMap = new Map<string, string>();
    const handleMap = new Map<string, string>();
    const takenCodes = new Set(snapshot<QuestNode>('quest_nodes').map((n) => n.data?.code).filter(Boolean));
    const copies = src.map((n) => {
      const id = newId();
      idMap.set(n.id, id);
      const data = JSON.parse(JSON.stringify(n.data ?? {}));
      if (n.kind === 'quest' && data.code) {
        let code = data.code + '_COPY';
        for (let i = 2; takenCodes.has(code); i++) code = `${data.code}_COPY${i}`;
        takenCodes.add(code);
        data.code = code;
      }
      if (n.kind === 'choice' && Array.isArray(data.options)) {
        data.options = data.options.map((o: ChoiceOption) => {
          const copy = newOption(o.text);
          handleMap.set(o.id, copy.id);
          return copy;
        });
      }
      return { id, chain_id: n.chain_id, kind: n.kind, x: Math.round(n.x + 50), y: Math.round(n.y + 50), data };
    });
    const links = chainEdges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        id: newId(),
        chain_id: e.chain_id,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        kind: e.kind,
        label: e.label,
        source_handle: e.source_handle ? handleMap.get(e.source_handle) ?? e.source_handle : null,
      }));
    pendingSelect.current = new Set(copies.map((c) => c.id));
    setSelectedEdges(new Set());
    if (copies.length === 1) setSel(copies[0].id);
    else setSel(null);
    await insert('quest_nodes', copies);
    if (links.length) await insert('quest_edges', links);
  };

  // Ctrl+D / Cmd+D duplicates the selection (unless you're typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'd') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (!selectedIds.length) return;
      e.preventDefault();
      duplicateNodes(selectedIds);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
            if (s.kind === 'condition') return { type: 'Condition', condition: conditionText(s, defs), output: e.source_handle === 'no' ? 'No' : 'Yes' };
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
              id: d.code, name: d.name, description: d.description, level: d.level, giver: name(d.giver_id) || d.giver,
              type: name(d.type), region: name(d.region ?? defs.get(d.district)?.extra.region), district: name(d.district), devStatus: name(d.status),
              objectives: d.objectives.map((o) => ({ type: name(o.type), text: o.text, count: o.count })),
              requiredItems: d.required_items.map((r) => ({ item: code(r.item), qty: r.qty })),
              rewards: d.rewards.map((r) => ({ type: name(r.type), text: r.text, item: code(r.item), amount: r.amount })),
              dialogue: { start: d.dialogue?.start ?? '', progress: d.dialogue?.progress ?? '', complete: d.dialogue?.complete ?? '' },
              prerequisites: prereqs(n.id),
            };
          }),
        // The full flow, node by node, for a dialogue / quest-flow runner in Unreal.
        nodes: ns
          .filter((n) => n.kind !== 'note')
          .map((n) => {
            const base = { id: n.id, type: n.kind };
            switch (n.kind) {
              case 'quest':
                return { ...base, quest: n.data.code };
              case 'dialogue':
                return { ...base, speaker: name(n.data.speaker), text: n.data.text ?? '' };
              case 'condition':
                return { ...base, variable: name(n.data.variable), op: n.data.op ?? '==', value: n.data.value ?? '', text: n.data.variable ? '' : n.data.text ?? '' };
              case 'action':
                return { ...base, variable: name(n.data.variable), op: n.data.op ?? 'set', value: n.data.value ?? '' };
              case 'external':
                return { ...base, quest: ctx.allNodes.get(n.data.ref)?.data.code ?? '' };
              case 'end':
                return { ...base, outcome: n.data.outcome ?? 'success', text: n.data.text ?? '' };
              case 'choice':
                return { ...base, text: n.data.text ?? '', options: choiceOptions(n).map((o, i) => ({ option: i + 1, text: o.text })) };
              default:
                return { ...base, text: n.data.text ?? '' };
            }
          }),
        links: es.map((e) => ({
          from: e.source,
          to: e.target,
          type: e.kind,
          label: e.label,
          output: e.kind === 'condition' ? (e.source_handle === 'no' ? 'No' : 'Yes') : undefined,
          option:
            e.kind === 'choice' && e.source_handle
              ? choiceOptions(ctx.allNodes.get(e.source)).findIndex((o) => o.id === e.source_handle) + 1 || undefined
              : undefined,
        })),
      };
    });
    const variables = defs.list('variable').map((v) => ({ key: enumKey(v.name), name: v.name, type: varType(v), default: v.extra?.default ?? '' }));
    download('earthlings-quests.json', JSON.stringify({ variables, chains: out }, null, 2), 'application/json');
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
  const [playing, setPlaying] = useState(false);
  const playStart = (() => {
    const start = chainNodes.find((n) => n.kind === 'start');
    if (start) return start.id;
    if (selected && selected.kind !== 'note') return selected.id;
    const targets = new Set(chainEdges.map((e) => e.target));
    return chainNodes.find((n) => n.kind !== 'note' && !targets.has(n.id))?.id ?? null;
  })();

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
            {(
              [
                ['start', () => addNode('start', { text: '' })],
                ['quest', addQuest],
                ['dialogue', () => addNode('dialogue', { speaker: null, text: '' })],
                ['choice', () => addNode('choice', { text: '', options: [newOption('Option 1'), newOption('Option 2')] })],
                ['condition', () => addNode('condition', { variable: null, op: '==', value: 'true', text: '' })],
                ['action', () => addNode('action', { variable: null, op: 'set', value: 'true' })],
                ['external', () => addNode('external', { ref: null })],
                ['end', () => addNode('end', { outcome: 'success', text: '' })],
                ['note', () => addNode('note', { text: '' })],
              ] as [NodeKind, () => void][]
            ).map(([k, fn]) => (
              <button key={k} type="button" className="btn small" onClick={fn} title={NODE_META[k].hint}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: k === 'external' ? 'transparent' : NODE_META[k].color, border: k === 'external' ? '1.5px dashed #c294d6' : undefined }} />
                {NODE_META[k].label}
              </button>
            ))}
            <div className="spacer" />
            <button type="button" className="btn small" onClick={autoLayout}>
              Auto-layout
            </button>
            {problemCount > 0 && (
              <button type="button" className="btn small warn" aria-pressed={showProblems} onClick={() => { setShowProblems(!showProblems); setSel(null); }}>
                <Icon name="warn" size={14} /> {problemCount} problem{problemCount === 1 ? '' : 's'}
              </button>
            )}
            <button type="button" className="btn small play-btn" onClick={() => setPlaying(true)}>
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg> Play
            </button>
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
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  selectionOnDrag
                  panOnDrag={[1, 2]}
                  panActivationKeyCode="Space"
                  selectionMode={SelectionMode.Partial}
                  multiSelectionKeyCode={['Control', 'Meta']}
                  onNodeDragStop={(_e, _n, moved) => moved.forEach((m) => update('quest_nodes', m.id, { x: Math.round(m.position.x), y: Math.round(m.position.y) }))}
                  onNodesDelete={(ns) => deleteNodes(ns.map((n) => n.id))}
                  onEdgesDelete={(es) => remove('quest_edges', es.map((e) => e.id))}
                  onEdgeDoubleClick={(_e, edge) => {
                    const e = chainEdges.find((x) => x.id === edge.id);
                    if (e?.kind !== 'choice' && e?.kind !== 'response') return;
                    if (e.kind === 'choice' && e.source_handle) {
                      setSel(e.source);
                      return;
                    }
                    const label = prompt(e.kind === 'choice' ? 'Option text' : 'Player’s reply (empty = Continue)', e.label);
                    if (label !== null) update('quest_edges', e.id, { label });
                  }}
                  onPaneClick={() => {
                    setSel(null);
                    setSelectedEdges(new Set());
                  }}
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
                  <MiniMap pannable zoomable nodeColor={(n) => NODE_META[(n.type ?? 'quest') as NodeKind]?.color ?? '#c294d6'} maskColor="rgba(15,14,13,0.7)" />
                </ReactFlow>
              </div>
              <div className="legend">
                <span><i style={{ borderColor: EDGE_COLORS.unlocks }} />Unlocks</span>
                <span><i style={{ borderColor: EDGE_COLORS.response }} />Dialogue reply</span>
                <span><i style={{ borderColor: YES }} />Yes</span>
                <span><i style={{ borderColor: NO }} />No</span>
                <span><i style={{ borderColor: EDGE_COLORS.external, borderTopStyle: 'dashed' }} />Quest from another chain</span>
                <span><i style={{ borderColor: EDGE_COLORS.choice }} />Choice</span>
                <span className="muted">Drag from a node’s right dot to another node to link them · Click a link and press its × to cut it · Drag on empty space to box-select · Move around with the right or middle mouse button, or hold Space and drag · Double-click a choice or reply line to edit its text · Press Play to test the chain</span>
              </div>
            </div>

            <aside className="panel side" aria-label="Details">
              {selectedIds.length > 1 ? (
                <MultiPanel
                  count={selectedIds.length}
                  onDuplicate={() => duplicateNodes(selectedIds)}
                  onDelete={() => confirm(`Delete these ${selectedIds.length} nodes and their links?`) && deleteNodes(selectedIds)}
                  onClear={() => setRfNodes((ns) => ns.map((n) => ({ ...n, selected: false })))}
                />
              ) : selectedEdges.size > 0 && !selected ? (
                <LinkPanel
                  edges={chainEdges.filter((e) => selectedEdges.has(e.id))}
                  onRemove={() => {
                    remove('quest_edges', [...selectedEdges]);
                    setSelectedEdges(new Set());
                  }}
                />
              ) : showProblems && !selected ? (
                <ProblemList problems={problems} onOpen={(n) => { setShowProblems(false); openChain(n.chain_id, n.id); }} />
              ) : null}
              {selected && selectedIds.length <= 1 && (
                <div className="list-row" style={{ justifyContent: 'flex-end', marginBottom: -8 }}>
                  <button type="button" className="btn small" onClick={() => duplicateNodes([selected.id])} title="Duplicate (Ctrl+D)">
                    <Icon name="copy" size={14} /> Duplicate
                  </button>
                </div>
              )}
              {selectedIds.length > 1 || (selectedEdges.size > 0 && !selected) || (showProblems && !selected) ? null : selected?.kind === 'quest' ? (
                <QuestPanel key={selected.id} node={selected} edges={chainEdges} onDelete={() => deleteNodes([selected.id])} onOpen={openChain} />
              ) : selected ? (
                <OtherPanel key={selected.id} node={selected} chainId={chainId!} edges={chainEdges} onDelete={() => deleteNodes([selected.id])} onOpen={openChain} />
              ) : (
                <ChainPanel key={chain.id} chain={chain} onDeleted={() => setParams({})} />
              )}
            </aside>
          </div>
        </>
      )}
      {playing && chain && (
        <PlayMode
          chainName={chain.name}
          startId={playStart}
          nodes={chainNodes}
          edges={chainEdges}
          allNodes={ctx.allNodes}
          defs={defs}
          itemsById={ctx.itemsById}
          onClose={(last) => {
            setPlaying(false);
            if (last) setSel(last);
          }}
        />
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
        Click a node to edit it. Use the Add buttons above to build the flow: Start, quests, dialogue lines, player choices, conditions on story variables, Set variable, links to other chains and End. Press Play to test it like a player.
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

function OtherPanel({ node, chainId, edges, onDelete, onOpen }: { node: QuestNode; chainId: string; edges: QuestEdge[]; onDelete: () => void; onOpen: (chain: string, node?: string) => void }) {
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
  const { defs } = useContext(QuestCtx);
  const del = (
    <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={onDelete}>
      <Icon name="trash" /> Delete node
    </button>
  );
  const help = (t: string) => (
    <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
      {t}
    </p>
  );
  const variables = defs.list('variable');
  const varPicker = (
    <label className="field">
      <span className="field-label">Story variable</span>
      <DefSelect options={variables} value={node.data.variable} onChange={(v) => set({ variable: v })} label="Story variable" allowEmpty />
    </label>
  );
  const valueField = (placeholder: string) => {
    const t = varType(defs.get(node.data.variable));
    return t === 'Boolean' ? (
      <span className="select-wrap">
        <select aria-label="Value" value={String(node.data.value ?? 'true')} onChange={(e) => set({ value: e.target.value })} style={{ paddingLeft: 10 }}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </span>
    ) : (
      <TextField value={String(node.data.value ?? '')} label="Value" placeholder={placeholder} type={t === 'Integer' ? 'number' : 'text'} onCommit={(v) => set({ value: v })} />
    );
  };
  const outs = edges.filter((e) => e.source === node.id);

  if (node.kind === 'start') {
    return (
      <>
        <span className="section-label" style={{ color: NODE_META.start.color }}>START</span>
        {help('Where this chain begins. Play mode starts here. Connect it to the first dialogue or quest.')}
        <label className="field">
          <span className="field-label">How the chain begins (optional)</span>
          <TextField multiline value={node.data.text ?? ''} label="Start text" placeholder="e.g. The player arrives at the Tramyard for the first time" onCommit={(v) => set({ text: v })} />
        </label>
        {del}
      </>
    );
  }

  if (node.kind === 'end') {
    return (
      <>
        <span className="section-label" style={{ color: NODE_META.end.color }}>END</span>
        {help('Where this path of the chain ends. A chain can have several Ends, e.g. one per outcome.')}
        <div className="field">
          <span className="field-label">Outcome</span>
          <div role="radiogroup" aria-label="Outcome" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {OUTCOMES.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={(node.data.outcome ?? 'success') === o.key}
                className="chip"
                aria-pressed={(node.data.outcome ?? 'success') === o.key}
                style={{ borderColor: (node.data.outcome ?? 'success') === o.key ? o.color : undefined }}
                onClick={() => set({ outcome: o.key })}
              >
                <span style={{ width: 9, height: 9, borderRadius: 3, background: o.color }} /> {o.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">Ending text (optional)</span>
          <TextField multiline value={node.data.text ?? ''} label="Ending text" placeholder="What happens at this ending" onCommit={(v) => set({ text: v })} />
        </label>
        {del}
      </>
    );
  }

  if (node.kind === 'dialogue') {
    return (
      <>
        <span className="section-label" style={{ color: NODE_META.dialogue.color }}>DIALOGUE</span>
        <label className="field">
          <span className="field-label">Speaker</span>
          <CharacterField value={node.data.speaker ?? null} label="Speaker" onChange={(v) => set({ speaker: v })} />
        </label>
        <label className="field">
          <span className="field-label">What they say</span>
          <TextField multiline rows={6} value={node.data.text ?? ''} label="Dialogue line" placeholder="Write the line…" onCommit={(v) => set({ text: v })} />
        </label>
        <div className="card-box">
          <span className="section-label">PLAYER REPLIES</span>
          {outs.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Drag from the dot on the right to the next node. Each link is one reply.</span>}
          {outs.map((e, i) => (
            <div key={e.id} className="list-row">
              <span className="muted" style={{ width: 18 }}>{i + 1}.</span>
              <span className="grow">
                <TextField value={e.label} label={'Reply ' + (i + 1)} placeholder="Continue" onCommit={(v) => update('quest_edges', e.id, { label: v })} />
              </span>
              <button type="button" className="icon-btn danger" aria-label="Cut this link" title="Cut this link" onClick={() => remove('quest_edges', e.id)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
        {del}
      </>
    );
  }

  if (node.kind === 'condition') {
    return (
      <>
        <span className="section-label" style={{ color: NODE_META.condition.color }}>CONDITION</span>
        {help('Checks a story variable. The flow leaves through the green “Yes” dot or the red “No” dot.')}
        {varPicker}
        {node.data.variable ? (
          <div className="grid2">
            <label className="field">
              <span className="field-label">Is</span>
              <span className="select-wrap">
                <select aria-label="Comparison" value={node.data.op ?? '=='} onChange={(e) => set({ op: e.target.value })} style={{ paddingLeft: 10 }}>
                  {OPS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </span>
            </label>
            <label className="field">
              <span className="field-label">Value</span>
              {valueField('e.g. 5')}
            </label>
          </div>
        ) : (
          <label className="field">
            <span className="field-label">Or describe the rule in words</span>
            <TextField multiline value={node.data.text ?? ''} label="Condition text" placeholder="e.g. Level ≥ 5, Reputation ≥ Friendly" onCommit={(v) => set({ text: v })} />
          </label>
        )}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#d4b0e3' }}>IF {conditionText(node, defs)}</span>
        {variables.length === 0 && help('Add story variables under Definitions → Story variables to make conditions that Play mode can check.')}
        {del}
      </>
    );
  }

  if (node.kind === 'action') {
    return (
      <>
        <span className="section-label" style={{ color: NODE_META.action.color }}>SET VARIABLE</span>
        {help('Changes a story variable when the flow passes through, e.g. remember that the player helped the Guild.')}
        {varPicker}
        <div className="grid2">
          <label className="field">
            <span className="field-label">Change</span>
            <span className="select-wrap">
              <select aria-label="Change" value={node.data.op ?? 'set'} onChange={(e) => set({ op: e.target.value })} style={{ paddingLeft: 10 }}>
                {ACTION_OPS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
          {node.data.op !== 'toggle' && (
            <label className="field">
              <span className="field-label">Value</span>
              {valueField('e.g. 1')}
            </label>
          )}
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#7fd3c4' }}>{actionText(node, defs)}</span>
        {variables.length === 0 && help('Add story variables under Definitions → Story variables first.')}
        {del}
      </>
    );
  }

  if (node.kind === 'note') {
    return (
      <>
        <span className="section-label" style={{ color: NODE_META.note.color }}>NOTE</span>
        {help('A sticky note for the team. It is not part of the flow and is not exported.')}
        <TextField multiline rows={6} value={node.data.text ?? ''} label="Note" placeholder="Write a note…" onCommit={(v) => set({ text: v })} />
        {del}
      </>
    );
  }

  // choice
  return <ChoicePanel node={node} edges={outs} onDelete={onDelete} />;
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
    if (n.kind === 'external') return questLabel(allNodes.get(n.data.ref)) + ' (other chain)';
    if (n.kind === 'start') return 'Start of the chain';
    if (n.kind === 'end') return 'End';
    if (n.kind === 'dialogue') return `${defs.get(n.data.speaker)?.name ?? 'Dialogue'}${e?.label ? ': “' + e.label + '”' : ''}`;
    if (n.kind === 'action') return 'Set ' + (defs.get(n.data.variable)?.name ?? 'variable');
    return NODE_META[n.kind]?.label ?? n.kind;
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
        <TextField multiline value={d.description} label="Description" placeholder="Short description" onCommit={(v) => set({ description: v })} />
      </div>

      <div className="grid2">
        <label className="field">
          <span className="field-label">Quest giver</span>
          <CharacterField value={d.giver_id ?? null} fallback={d.giver} label="Quest giver" onChange={(v, name) => set({ giver_id: v, giver: name })} />
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
        <span className="section-label">DIALOGUE</span>
        {(
          [
            ['start', 'When offering the quest', 'What the quest giver says to start the quest'],
            ['progress', 'While the quest is in progress', 'What they say if the player comes back before finishing'],
            ['complete', 'When handing in the quest', 'What they say when the player completes it'],
          ] as const
        ).map(([key, label, placeholder]) => (
          <label key={key} className="field">
            <span className="field-label">{label}</span>
            <TextField
              multiline
              rows={key === 'start' ? 5 : 3}
              value={d.dialogue?.[key] ?? ''}
              label={'Dialogue: ' + label}
              placeholder={placeholder}
              onCommit={(v) => set({ dialogue: { start: '', progress: '', complete: '', ...d.dialogue, [key]: v } })}
            />
          </label>
        ))}
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
            return (
              <div key={e.id} className="list-row">
                {target ? (
                  <button type="button" className="btn ghost small grow" style={{ justifyContent: 'flex-start', color: '#d4b0e3', padding: 0, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => onOpen(target.chain_id, target.id)}>
                    {describe(s, e)}
                  </button>
                ) : (
                  <span className="grow" style={{ color: '#d4b0e3', fontSize: 13 }}>
                    {describe(s, e)}
                  </span>
                )}
                <button type="button" className="icon-btn danger" aria-label="Cut this link" title="Cut this link" onClick={() => remove('quest_edges', e.id)}>
                <Icon name="x" size={14} />
              </button>
              </div>
            );
          })}
          {needs.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Nothing — available from the start</span>}
        </div>
        <div className="field">
          <span className="section-label">UNLOCKS</span>
          {unlocks.map((e) => (
            <div key={e.id} className="list-row">
              <span className="grow" style={{ color: 'var(--accent-text)', fontSize: 13 }}>
                {describe(allNodes.get(e.target))}
              </span>
              <button type="button" className="icon-btn danger" aria-label="Cut this link" title="Cut this link" onClick={() => remove('quest_edges', e.id)}>
                <Icon name="x" size={14} />
              </button>
            </div>
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

// ---------- small helpers ----------

/** Type a character's name, or pick one from the list. A new name is added to Definitions → Characters. */
function CharacterField({ value, fallback, label, onChange }: { value: string | null; fallback?: string; label: string; onChange: (id: string | null, name: string) => void }) {
  const { defs } = useContext(QuestCtx);
  const listId = useId();
  const chars = defs.list('character');
  const cur = defs.get(value);
  return (
    <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {cur && <span style={{ position: 'absolute', left: 10, width: 10, height: 10, borderRadius: 3, background: cur.color, pointerEvents: 'none' }} />}
      <TextField
        value={cur?.name ?? fallback ?? ''}
        label={label}
        placeholder="Type a name or pick one"
        list={listId}
        style={{ paddingLeft: cur ? 28 : undefined }}
        onCommit={(raw) => {
          const name = raw.trim();
          if (!name) return onChange(null, '');
          const match = chars.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (match) return onChange(match.id, match.name);
          const id = newId();
          insert('definitions', {
            id,
            list: 'character',
            name,
            color: SWATCHES[chars.length % SWATCHES.length],
            sort: chars.length ? Math.max(...chars.map((c) => c.sort)) + 1 : 0,
            extra: { district: '', role: '' },
          });
          onChange(id, name);
        }}
      />
      <datalist id={listId}>
        {chars.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </span>
  );
}

function MultiPanel({ count, onDuplicate, onDelete, onClear }: { count: number; onDuplicate: () => void; onDelete: () => void; onClear: () => void }) {
  return (
    <>
      <span className="section-label">{count} NODES SELECTED</span>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        Drag any of them to move them all together. Duplicating also copies the links between them. Ctrl-click (Cmd-click on Mac) a node to add it to or remove it from the selection.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={onDuplicate} title="Duplicate (Ctrl+D)">
          <Icon name="copy" /> Duplicate {count} nodes
        </button>
        <button type="button" className="btn warn" onClick={onDelete}>
          <Icon name="trash" /> Delete {count} nodes
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Clear selection
        </button>
      </div>
    </>
  );
}

function LinkPanel({ edges, onRemove }: { edges: QuestEdge[]; onRemove: () => void }) {
  const { allNodes } = useContext(QuestCtx);
  const name = (id: string) => {
    const n = allNodes.get(id);
    if (!n) return '?';
    if (n.kind === 'quest') return questLabel(n);
    if (n.kind === 'dialogue' || n.kind === 'choice' || n.kind === 'condition' || n.kind === 'start' || n.kind === 'end') return NODE_META[n.kind].label + (n.data.text ? ': ' + String(n.data.text).slice(0, 40) : '');
    return NODE_META[n.kind]?.label ?? n.kind;
  };
  return (
    <>
      <span className="section-label">{edges.length === 1 ? 'LINK' : edges.length + ' LINKS'} SELECTED</span>
      {edges.map((e) => (
        <div key={e.id} className="card-box" style={{ gap: 4 }}>
          <span style={{ fontSize: 13 }}>{name(e.source)}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            ↓ {e.kind === 'condition' ? (e.source_handle === 'no' ? 'No' : 'Yes') : e.label || 'leads to'}
          </span>
          <span style={{ fontSize: 13 }}>{name(e.target)}</span>
        </div>
      ))}
      <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>
        <Icon name="x" /> Cut {edges.length === 1 ? 'this link' : 'these links'}
      </button>
      <span className="muted" style={{ fontSize: 12 }}>You can also press Delete, or click the × on the link.</span>
    </>
  );
}

export function newOption(text: string) {
  return { id: 'opt_' + newId().slice(0, 8), text };
}

/** Options 1, 2, 3… for a choice. Each option has its own exit dot on the node. */
function ChoicePanel({ node, edges, onDelete }: { node: QuestNode; edges: QuestEdge[]; onDelete: () => void }) {
  const { allNodes, defs } = useContext(QuestCtx);
  const options = choiceOptions(node);
  const setData = (patch: Record<string, unknown>) => update('quest_nodes', node.id, { data: { ...node.data, ...patch } });
  const legacy = options.length === 0 ? edges : [];

  const setOptions = (next: ChoiceOption[]) => setData({ options: next });
  const rename = (id: string, text: string) => {
    setOptions(options.map((o) => (o.id === id ? { ...o, text } : o)));
    edges.filter((e) => e.source_handle === id).forEach((e) => update('quest_edges', e.id, { label: text }));
  };
  const removeOption = (id: string) => {
    const linked = edges.filter((e) => e.source_handle === id);
    if (linked.length && !confirm('This option is connected. Remove it and its link?')) return;
    if (linked.length) remove('quest_edges', linked.map((e) => e.id));
    setOptions(options.filter((o) => o.id !== id));
  };
  const move = (i: number, dir: -1 | 1) => {
    const next = [...options];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOptions(next);
  };
  /** Creates a new node to the right of the choice and connects this option to it. */
  const createExit = (o: ChoiceOption, i: number, kind: 'dialogue' | 'quest' | 'end' | 'action') => {
    const id = newId();
    const x = node.x + 360;
    const y = node.y + (i - (options.length - 1) / 2) * 170;
    const data =
      kind === 'dialogue'
        ? { speaker: null, text: '' }
        : kind === 'end'
          ? { outcome: 'success', text: o.text }
          : kind === 'action'
            ? { variable: null, op: 'set', value: 'true' }
            : {
                code: '', name: o.text, description: '', level: '', giver: '', type: defs.list('quest_type')[0]?.id ?? null, region: null, district: null,
                status: defs.list('quest_status')[0]?.id ?? null, assignee: null, objectives: [], required_items: [], rewards: [],
              };
    insert('quest_nodes', { id, chain_id: node.chain_id, kind, x: Math.round(x), y: Math.round(y), data });
    insert('quest_edges', { id: newId(), chain_id: node.chain_id, source: node.id, target: id, kind: 'choice', label: o.text, source_handle: o.id });
  };
  const targetName = (id: string) => {
    const t = allNodes.get(id);
    if (!t) return '?';
    if (t.kind === 'quest') return questLabel(t);
    if (t.kind === 'dialogue') return 'Dialogue' + (defs.get(t.data.speaker) ? ': ' + defs.get(t.data.speaker)!.name : '');
    if (t.kind === 'end') return 'End · ' + (OUTCOMES.find((x) => x.key === t.data.outcome)?.label ?? 'Success');
    return NODE_META[t.kind]?.label ?? t.kind;
  };

  return (
    <>
      <span className="section-label" style={{ color: NODE_META.choice.color }}>PLAYER CHOICE</span>
      <TextField multiline value={node.data.text ?? ''} label="Question" placeholder="e.g. Protect or expose the Guild?" onCommit={(v) => setData({ text: v })} />

      <div className="card-box">
        <span className="section-label">OPTIONS</span>
        {options.map((o, i) => {
          const linked = edges.filter((e) => e.source_handle === o.id);
          return (
            <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
              <div className="list-row">
                <span className="choice-num" style={{ position: 'static' }}>{i + 1}</span>
                <span className="grow">
                  <TextField value={o.text} label={'Option ' + (i + 1)} placeholder={'Option ' + (i + 1)} onCommit={(v) => rename(o.id, v)} />
                </span>
                <button type="button" className="icon-btn" aria-label={'Move option ' + (i + 1) + ' up'} disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label={'Move option ' + (i + 1) + ' down'} disabled={i === options.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" size={14} />
                </button>
                <button type="button" className="icon-btn danger" aria-label={'Remove option ' + (i + 1)} onClick={() => removeOption(o.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {linked.length > 0 ? (
                linked.map((e) => (
                  <div key={e.id} className="list-row" style={{ paddingLeft: 30, fontSize: 13 }}>
                    <span className="grow" style={{ color: 'var(--accent-text)' }}>→ {targetName(e.target)}</span>
                    <button type="button" className="icon-btn danger" aria-label="Cut this link" title="Cut this link" onClick={() => remove('quest_edges', e.id)}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="list-row" style={{ paddingLeft: 30, flexWrap: 'wrap', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Exit to a new</span>
                  {(
                    [
                      ['dialogue', 'Dialogue'],
                      ['quest', 'Quest'],
                      ['action', 'Set variable'],
                      ['end', 'End'],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} type="button" className="btn small" onClick={() => createExit(o, i, k)}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: NODE_META[k].color }} /> {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {legacy.map((e, i) => (
          <div key={e.id} className="list-row">
            <span className="muted" style={{ width: 18 }}>{i + 1}.</span>
            <span className="grow">
              <TextField value={e.label} label={'Option ' + (i + 1)} placeholder="Option text" onCommit={(v) => update('quest_edges', e.id, { label: v })} />
            </span>
          </div>
        ))}
        <button
          type="button"
          className="btn ghost small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            // Older choices kept their options on the links: turn those into numbered options first.
            if (!options.length && legacy.length) {
              const converted = legacy.map((e) => newOption(e.label));
              legacy.forEach((e, i) => update('quest_edges', e.id, { source_handle: converted[i].id }));
              setOptions([...converted, newOption('Option ' + (converted.length + 1))]);
            } else setOptions([...options, newOption('Option ' + (options.length + 1))]);
          }}
        >
          <Icon name="plus" size={14} /> Add option
        </button>
        <span className="muted" style={{ fontSize: 12 }}>Each option has its own exit dot on the node. Drag from it, or use the buttons above to create the next step.</span>
      </div>
      <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={onDelete}>
        <Icon name="trash" /> Delete node
      </button>
    </>
  );
}
