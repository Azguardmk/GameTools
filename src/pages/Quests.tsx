import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { group, insert, newId, remove, snapshot, update, useTable } from '../lib/db';
import { SWATCHES, download, useDefinitions, useMembers } from '../lib/hooks';
import { enumKey, type Item, type MapEdge, type MapNode, type NodeKind, type QuestChain, type QuestData, type QuestEdge, type QuestNode, type Task, type TaskGroup } from '../lib/types';
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
  conditionChecks,
  conditionJoin,
  type Check,
  edgeColor,
  edgeKindFor,
  edgeLabel,
  choiceOptions,
  choiceMode,
  CHOICE_MODES,
  DONE_HANDLE,
  findProblems,
  finalTarget,
  originEdge,
  realSource,
  type ChoiceOption,
  nodeTypes,
  edgeTypes,
  questLabel,
  varType,
  type Ctx,
} from './quest/shared';
import PlayMode from './quest/Play';
import { DefSelect, Icon, SwatchPicker, TextField } from '../components/ui';
import { LIBRARY_MIME, Library, type LibraryDrop } from './quest/Library';
import { useCanvasSize } from '../lib/canvas';
import { NpcPanel, npcNodes } from './quest/NpcPanel';
import { CharacterProfile } from './CharacterProfile';

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
  // Chains in story order: by chapter (Definitions → Chapters order), then by their own order.
  const chapterOrder = (id?: string | null) => {
    const i = defs.list('chapter').findIndex((c) => c.id === id);
    return i < 0 ? 9999 : i;
  };
  const chains = useMemo(() => [...chainsRaw].sort((a, b) => chapterOrder(a.chapter) - chapterOrder(b.chapter) || a.sort - b.sort), [chainsRaw, defs]); // eslint-disable-line react-hooks/exhaustive-deps
  const members = useMembers();
  const [params, setParams] = useSearchParams();
  const rf = useReactFlow();


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
      allEdges,
      chains: new Map(chains.map((c) => [c.id, c])),
      problems,
    }),
    [defs, members, items, allNodesRaw, allEdges, chains, problems],
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
    if (e.source_handle === DONE_HANDLE) return '✓ All done';
    const i = opts.findIndex((o) => o.id === e.source_handle);
    return i < 0 ? undefined : `${i + 1}. ${opts[i].text || 'Option ' + (i + 1)}`;
  };
  const rfEdges: Edge[] = useMemo(
    () =>
      chainEdges.map((e) => {
        const nodeMap = new Map(chainNodes.map((n) => [n.id, n]));
        const o = originEdge(e, nodeMap, chainEdges);
        const color = edgeColor(o);
        const isOrigin = o.id === e.id;
        return {
        id: e.id,
        type: 'link',
        source: e.source,
        sourceHandle: e.source_handle ?? undefined,
        target: e.target,
        selected: selectedEdges.has(e.id),
        interactionWidth: 26,
        data: { label: isOrigin ? choiceEdgeLabel(e) ?? edgeLabel(e) : undefined, color },
        style: { stroke: color, strokeWidth: selectedEdges.has(e.id) ? 4 : 2.5, strokeDasharray: o.kind === 'external' ? '6 6' : undefined },
        // Only the last piece of a rerouted link gets the arrow.
        markerEnd: nodeMap.get(e.target)?.kind === 'reroute' ? undefined : { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
      }),
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
    if (src?.kind === 'reroute') {
      // Continue the link that runs into this reroute point.
      const into = chainEdges.find((e) => e.target === src.id);
      const o = into ? originEdge(into, new Map(chainNodes.map((n) => [n.id, n])), chainEdges) : undefined;
      insert('quest_edges', { id: newId(), chain_id: chainId, source: c.source, target: c.target, kind: o?.kind ?? 'unlocks', label: '', source_handle: null });
      return;
    }
    const kind = edgeKindFor(src);
    let label = '';
    if (kind === 'choice') {
      const opt = choiceOptions(src).find((o) => o.id === handle);
      if (opt) label = opt.text;
      else if (handle === DONE_HANDLE) label = 'All done';
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
  const duplicateNodes = (ids: string[]) => group(async () => {
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
  });

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

  /** Splits a link with a reroute point at (x, y): the first piece keeps the link's label and type. */
  const addReroute = (e: QuestEdge, x: number, y: number) => group(async () => {
    const id = newId();
    await insert('quest_nodes', { id, chain_id: e.chain_id, kind: 'reroute', x: Math.round(x - 12), y: Math.round(y - 12), data: {} });
    await remove('quest_edges', e.id);
    await insert('quest_edges', [
      { id: newId(), chain_id: e.chain_id, source: e.source, target: id, kind: e.kind, label: e.label, source_handle: e.source_handle },
      { id: newId(), chain_id: e.chain_id, source: id, target: e.target, kind: e.kind, label: '', source_handle: null },
    ]);
    setSelectedEdges(new Set());
  });

  const deleteNodes = (ids: string[]) => group(async () => {
    // Deleting a reroute point joins the link back together instead of cutting it.
    const all = snapshot<QuestEdge>('quest_edges');
    const nodeMap = new Map(snapshot<QuestNode>('quest_nodes').map((n) => [n.id, n]));
    const rejoin: QuestEdge[] = [];
    for (const id of ids) {
      if (nodeMap.get(id)?.kind !== 'reroute') continue;
      const ins = all.filter((e) => e.target === id && !ids.includes(e.source));
      const outsR = all.filter((e) => e.source === id);
      if (ins.length !== 1) continue;
      for (const o of outsR) {
        const target = finalTarget(o.target, new Map([...nodeMap].filter(([k]) => !ids.includes(k) || nodeMap.get(k)?.kind === 'reroute')), all);
        if (ids.includes(target)) continue;
        rejoin.push({ ...ins[0], id: newId(), target });
      }
    }
    const edgeIds = all
      .filter((e) => ids.includes(e.source) || ids.includes(e.target))
      .map((e) => e.id);
    if (edgeIds.length) await remove('quest_edges', edgeIds);
    await remove('quest_nodes', ids);
    if (rejoin.length) await insert('quest_edges', rejoin);
    if (selId && ids.includes(selId)) setSel(null);
  });

  const addNode = (kind: NodeKind, data: Record<string, unknown>) => {
    if (!chainId) return;
    const center = rf.screenToFlowPosition({ x: window.innerWidth * 0.38, y: window.innerHeight * 0.5 });
    const id = newId();
    insert('quest_nodes', { id, chain_id: chainId, kind, x: Math.round(center.x), y: Math.round(center.y), data });
    setSel(id);
  };

  const canvas = useCanvasSize('quests', 300);
  // NPC picked in the library: its info shows on the right and its nodes light up.
  const [focusNpc, setFocusNpc] = useState<string | null>(null);
  const [editNpc, setEditNpc] = useState<string | null>(null);
  const npcHits = useMemo(() => new Set(focusNpc ? npcNodes(focusNpc, chainNodes).map((n) => n.id) : []), [focusNpc, chainNodes]);
  useEffect(() => {
    if (!focusNpc) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editNpc && setFocusNpc(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusNpc, editNpc]);
  const shownNodes = useMemo(
    () => (focusNpc ? rfNodes.map((n) => ({ ...n, className: npcHits.has(n.id) ? 'npc-hl' : 'npc-dim' })) : rfNodes),
    [rfNodes, focusNpc, npcHits],
  );
  // ---- NPC / item library ----
  const [libOpen, setLibOpen] = useState(() => localStorage.getItem('earthlings-tools:library') !== 'closed');
  const toggleLib = () => {
    localStorage.setItem('earthlings-tools:library', libOpen ? 'closed' : 'open');
    setLibOpen(!libOpen);
  };
  const [dropHover, setDropHover] = useState(false);
  const [libNote, setLibNote] = useState<string | null>(null);
  useEffect(() => {
    if (!libNote) return;
    const t = setTimeout(() => setLibNote(null), 3500);
    return () => clearTimeout(t);
  }, [libNote]);
  const selectOnly = (id: string) => {
    pendingSelect.current = new Set([id]);
    setRfNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    setSelectedEdges(new Set());
    setSel(id);
  };
  /** Uses an NPC or item on a node (or on empty space at `at`). */
  const applyLibrary = (d: LibraryDrop, targetId: string | null, at?: { x: number; y: number }) => {
    if (!chainId) return;
    const target = targetId ? chainNodes.find((n) => n.id === targetId) : undefined;
    const setData = (patch: Record<string, unknown>) => target && update('quest_nodes', target.id, { data: { ...target.data, ...patch } });
    if (d.kind === 'npc') {
      const npc = defs.get(d.id);
      if (!npc) return;
      if (target?.kind === 'quest') return setData({ giver_id: npc.id, giver: npc.name }), selectOnly(target.id), setLibNote(`${npc.name} is now the quest giver`);
      if (target && (target.kind === 'dialogue' || target.kind === 'end')) return setData({ speaker: npc.id }), selectOnly(target.id), setLibNote(`${npc.name} now speaks here`);
      if (target) return setLibNote('Drop NPCs on a quest, dialogue or End node, or on empty space');
      const pos = at ?? rf.screenToFlowPosition({ x: window.innerWidth * 0.45, y: window.innerHeight * 0.5 });
      const id = newId();
      insert('quest_nodes', { id, chain_id: chainId, kind: 'dialogue', x: Math.round(pos.x - 90), y: Math.round(pos.y - 30), data: { speaker: npc.id, text: '' } });
      pendingSelect.current = new Set([id]);
      setSel(id);
      return;
    }
    const item = ctx.itemsById.get(d.id);
    if (!item) return;
    if (!target || (target.kind !== 'quest' && target.kind !== 'end')) return setLibNote(target ? 'Items go on a quest or End node as a reward' : 'Drop the item on a quest or End node to add it as a reward');
    const cat = defs.get(item.category)?.name ?? '';
    const types = defs.list('reward_type');
    const want = /currenc|coin|money/i.test(cat) ? /currenc|coin|money/i : /blueprint/i.test(cat) ? /blueprint/i : /item/i;
    const type = (types.find((t) => want.test(t.name)) ?? types.find((t) => /item/i.test(t.name)) ?? types[0])?.id ?? null;
    const rewards = Array.isArray(target.data.rewards) ? target.data.rewards : [];
    const existing = rewards.findIndex((r: { item: string | null }) => r.item === item.id);
    const next = existing >= 0 ? rewards.map((r: { amount: number }, i: number) => (i === existing ? { ...r, amount: (r.amount || 0) + 1 } : r)) : [...rewards, { type, text: '', item: item.id, amount: 1 }];
    setData({ rewards: next });
    selectOnly(target.id);
    setLibNote(`${item.name} added as a reward`);
  };
  const nodeAtPoint = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('.react-flow__node') as HTMLElement | null)?.dataset.id ?? null;
  const lastDropTarget = useRef<HTMLElement | null>(null);
  const markDropTarget = (el: HTMLElement | null) => {
    if (lastDropTarget.current === el) return;
    lastDropTarget.current?.classList.remove('drop-target');
    el?.classList.add('drop-target');
    lastDropTarget.current = el;
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
          .map((last) => {
            const e = originEdge(last, ctx.allNodes, allEdges);
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
          .filter((n) => n.kind !== 'note' && n.kind !== 'reroute')
          .map((n) => {
            const base = { id: n.id, type: n.kind };
            switch (n.kind) {
              case 'quest':
                return { ...base, quest: n.data.code };
              case 'dialogue':
                return { ...base, speaker: name(n.data.speaker), text: n.data.text ?? '' };
              case 'condition':
                return {
                  ...base,
                  variable: name(n.data.variable),
                  op: n.data.op ?? '==',
                  value: n.data.value ?? '',
                  text: n.data.variable ? '' : n.data.text ?? '',
                  join: conditionJoin(n),
                  checks: conditionChecks(n).map((c) => ({ variable: name(c.variable), op: c.op || '==', value: c.value })),
                };
              case 'action':
                return { ...base, variable: name(n.data.variable), op: n.data.op ?? 'set', value: n.data.value ?? '' };
              case 'external':
                return { ...base, quest: ctx.allNodes.get(n.data.ref)?.data.code ?? '' };
              case 'end':
                return {
                  ...base,
                  outcome: n.data.outcome ?? 'success',
                  text: n.data.text ?? '',
                  speaker: name(n.data.speaker),
                  dialogue: n.data.dialogue ?? '',
                  rewards: (Array.isArray(n.data.rewards) ? n.data.rewards : []).map((r: { type: string | null; text: string; item: string | null; amount: number }) => ({ type: name(r.type), text: r.text, item: code(r.item), amount: r.amount })),
                };
              case 'choice':
                return { ...base, text: n.data.text ?? '', mode: choiceMode(n), options: choiceOptions(n).map((o, i) => ({ option: i + 1, text: o.text })) };
              default:
                return { ...base, text: n.data.text ?? '' };
            }
          }),
        // Reroute points are only for layout: links are written from real node to real node.
        links: es.filter((e) => ctx.allNodes.get(e.source)?.kind !== 'reroute').map((e) => ({
          from: e.source,
          to: finalTarget(e.target, ctx.allNodes, allEdges),
          type: e.kind,
          label: e.label,
          output: e.kind === 'condition' ? (e.source_handle === 'no' ? 'No' : 'Yes') : undefined,
          option:
            e.kind === 'choice' && e.source_handle
              ? e.source_handle === DONE_HANDLE
                ? 'done'
                : choiceOptions(ctx.allNodes.get(e.source)).findIndex((o) => o.id === e.source_handle) + 1 || undefined
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
    insert('quest_chains', { id, name: name.trim(), color: '#6fb3d6', sort: chains.length ? Math.max(...chains.map((c) => c.sort)) + 1 : 0, chapter: chains.find((c) => c.id === chainId)?.chapter ?? null });
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
        {chains.map((c, i) => (
          <span key={c.id} style={{ display: 'contents' }}>
          {(i === 0 || chains[i - 1].chapter !== c.chapter) && (
            <span className="chapter-label" style={{ color: defs.get(c.chapter)?.color }} title={defs.get(c.chapter)?.extra?.summary || undefined}>
              {defs.get(c.chapter)?.name ?? 'No chapter'}
              {defs.get(c.chapter)?.extra?.levels && <span className="muted"> · Lv {defs.get(c.chapter)!.extra.levels}</span>}
            </span>
          )}
          <button type="button" aria-current={c.id === chainId ? 'page' : undefined} onClick={() => openChain(c.id)}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color }} />
            {c.name}
            <span className="muted" style={{ fontSize: 12 }}>
              {allNodesRaw.filter((n) => n.chain_id === c.id && n.kind === 'quest').length}
            </span>
          </button>
          </span>
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
        <div ref={canvas.wrapRef} className={'canvas-area ' + canvas.className} style={canvas.style}>
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
            {canvas.maxButton}
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
              <div className="quest-work">
              <Library
                open={libOpen}
                onToggle={toggleLib}
                activeNpc={focusNpc}
                onPick={(d) => {
                  if (d.kind === 'npc') {
                    // Clicking an NPC shows who they are and highlights their nodes.
                    setFocusNpc(focusNpc === d.id ? null : d.id);
                    setRfNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
                    setSelectedEdges(new Set());
                    setShowProblems(false);
                    setSel(null);
                  } else applyLibrary(d, selId);
                }}
              />
              <div
                className={'flow-wrap' + (dropHover ? ' drop-hover' : '')}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(LIBRARY_MIME)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setDropHover(true);
                  markDropTarget((document.elementFromPoint(e.clientX, e.clientY)?.closest('.react-flow__node') as HTMLElement | null) ?? null);
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as globalThis.Node | null)) {
                    setDropHover(false);
                    markDropTarget(null);
                  }
                }}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData(LIBRARY_MIME);
                  setDropHover(false);
                  markDropTarget(null);
                  if (!raw) return;
                  e.preventDefault();
                  applyLibrary(JSON.parse(raw) as LibraryDrop, nodeAtPoint(e.clientX, e.clientY), rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
                }}
              >
                {libNote && <div className="lib-note" role="status">{libNote}</div>}
                <ReactFlow
                  key={chainId}
                  nodes={shownNodes}
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
                  onDelete={({ nodes: ns, edges: es }) => {
                    // One handler for the Delete key, so reroute points can rejoin their link before anything is removed.
                    if (ns.length) deleteNodes(ns.map((n) => n.id));
                    else if (es.length) remove('quest_edges', es.map((e) => e.id));
                  }}
                  onEdgeDoubleClick={(ev, edge) => {
                    const e = chainEdges.find((x) => x.id === edge.id);
                    if (!e) return;
                    const at = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
                    addReroute(e, at.x, at.y);
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
              </div>
              {canvas.grip}
              <div className="legend">
                <span><i style={{ borderColor: EDGE_COLORS.unlocks }} />Unlocks</span>
                <span><i style={{ borderColor: EDGE_COLORS.response }} />Dialogue reply</span>
                <span><i style={{ borderColor: YES }} />Yes</span>
                <span><i style={{ borderColor: NO }} />No</span>
                <span><i style={{ borderColor: EDGE_COLORS.external, borderTopStyle: 'dashed' }} />Quest from another chain</span>
                <span><i style={{ borderColor: EDGE_COLORS.choice }} />Choice</span>
                <span className="muted">Drag from a node’s right dot to another node to link them · Click a link and press its × to cut it · Drag on empty space to box-select · Move around with the right or middle mouse button, or hold Space and drag · Double-click a link to add a reroute point (drag it to bend the link) · Press Play to test the chain</span>
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
                  onReroute={(e) => {
                    const a = chainNodes.find((n) => n.id === e.source);
                    const b = chainNodes.find((n) => n.id === e.target);
                    if (a && b) addReroute(e, (a.x + b.x) / 2 + 100, (a.y + b.y) / 2 + 40);
                  }}
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
              ) : focusNpc && defs.get(focusNpc) ? (
                <NpcPanel
                  npcId={focusNpc}
                  chainNodes={chainNodes}
                  onSelectNode={(id) => {
                    pendingSelect.current = new Set([id]);
                    setRfNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
                    setSel(id);
                    const n = chainNodes.find((x) => x.id === id);
                    if (n) rf.setCenter(n.x + 120, n.y + 60, { zoom: Math.max(rf.getZoom(), 0.9), duration: 300 });
                  }}
                  onOpenChain={openChain}
                  onEdit={() => setEditNpc(focusNpc)}
                  onClose={() => setFocusNpc(null)}
                />
              ) : (
                <ChainPanel key={chain.id} chain={chain} onDeleted={() => setParams({})} />
              )}
              {editNpc && defs.get(editNpc) && <CharacterProfile key={editNpc} c={defs.get(editNpc)!} onClose={() => setEditNpc(null)} onOpen={setEditNpc} />}
            </aside>
          </div>
        </div>
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
      <ChapterField chain={chain} />
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
          const mapNodes = snapshot<MapNode>('map_nodes').filter((m) => m.chain_id === chain.id).map((m) => m.id);
          const mapEdges = snapshot<MapEdge>('map_edges').filter((e) => mapNodes.includes(e.source) || mapNodes.includes(e.target)).map((e) => e.id);
          await group(async () => {
            if (mapEdges.length) await remove('map_edges', mapEdges);
            if (mapNodes.length) await remove('map_nodes', mapNodes);
            if (es.length) await remove('quest_edges', es.map((e) => e.id));
            if (ns.length) await remove('quest_nodes', ns.map((n) => n.id));
            await remove('quest_chains', chain.id);
          });
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
        {chains.get(node.chain_id) && (
          <label className="field">
            <span className="field-label">Quest type of this chain</span>
            <DefSelect options={defs.list('quest_type')} value={chains.get(node.chain_id)!.type} onChange={(v) => update('quest_chains', node.chain_id, { type: v })} label="Quest type of this chain" allowEmpty />
            <span className="muted" style={{ fontSize: 12 }}>Colours this chain on the Quest map (Main, Side…).</span>
          </label>
        )}
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
        <div className="card-box">
          <span className="section-label">DIALOGUE</span>
          <label className="field">
            <span className="field-label">Speaker</span>
            <CharacterField value={node.data.speaker ?? null} label="Speaker" onChange={(v) => set({ speaker: v })} />
          </label>
          <label className="field">
            <span className="field-label">What they say</span>
            <TextField multiline rows={4} value={node.data.dialogue ?? ''} label="End dialogue" placeholder="e.g. Well done, the Guild owes you one." onCommit={(v) => set({ dialogue: v })} />
          </label>
        </div>
        <RewardsEditor rewards={Array.isArray(node.data.rewards) ? node.data.rewards : []} onChange={(rewards) => set({ rewards })} />
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
    const checks = conditionChecks(node);
    const join = conditionJoin(node);
    const more = checks.slice(1);
    const setCheck = (i: number, patch: Partial<Check>) => {
      if (i === 0) {
        const p: Record<string, any> = { ...patch };
        if ('variable' in patch) p.value = varType(defs.get(patch.variable ?? null)) === 'Boolean' ? 'true' : '';
        set(p);
      } else {
        const next = more.map((c, j) => {
          if (j !== i - 1) return c;
          const c2 = { ...c, ...patch };
          if ('variable' in patch) c2.value = varType(defs.get(patch.variable ?? null)) === 'Boolean' ? 'true' : '';
          return c2;
        });
        set({ more: next });
      }
    };
    const addCheck = () => set({ more: [...more, { id: newId(), variable: null, op: '==', value: 'true' }], join });
    const removeCheck = (i: number) => {
      if (i === 0) {
        const [nextFirst, ...rest] = more;
        set({ variable: nextFirst.variable, op: nextFirst.op, value: nextFirst.value, more: rest });
      } else set({ more: more.filter((_, j) => j !== i - 1) });
    };
    return (
      <>
        <span className="section-label" style={{ color: NODE_META.condition.color }}>CONDITION</span>
        {help('Checks story variables. The flow leaves through the green “Yes” dot or the red “No” dot. Add more checks with OR (any one is enough) or AND (all must be true).')}
        {checks.length > 1 && (
          <div className="seg" role="radiogroup" aria-label="How checks combine">
            <button type="button" role="radio" aria-checked={join === 'or'} className={join === 'or' ? 'on' : ''} onClick={() => set({ join: 'or' })}>
              OR · any is true
            </button>
            <button type="button" role="radio" aria-checked={join === 'and'} className={join === 'and' ? 'on' : ''} onClick={() => set({ join: 'and' })}>
              AND · all are true
            </button>
          </div>
        )}
        {checks.map((c, i) => {
          const t = varType(defs.get(c.variable));
          return (
            <div key={c.id} className="check-block">
              {i > 0 && <span className="check-join">{join.toUpperCase()}</span>}
              <div className="check-row">
                <DefSelect options={variables} value={c.variable} onChange={(v) => setCheck(i, { variable: v })} label={`Check ${i + 1} variable`} allowEmpty />
                {checks.length > 1 && (
                  <button type="button" className="icon-btn" aria-label={`Remove check ${i + 1}`} onClick={() => removeCheck(i)}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
              {c.variable && (
                <div className="grid2">
                  <span className="select-wrap">
                    <select aria-label={`Check ${i + 1} comparison`} value={c.op || '=='} onChange={(e) => setCheck(i, { op: e.target.value })} style={{ paddingLeft: 10 }}>
                      {OPS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </span>
                  {t === 'Boolean' ? (
                    <span className="select-wrap">
                      <select aria-label={`Check ${i + 1} value`} value={c.value || 'true'} onChange={(e) => setCheck(i, { value: e.target.value })} style={{ paddingLeft: 10 }}>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </span>
                  ) : (
                    <TextField value={c.value} label={`Check ${i + 1} value`} placeholder="e.g. 5" type={t === 'Integer' ? 'number' : 'text'} onCommit={(v) => setCheck(i, { value: v })} />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {node.data.variable && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn small" onClick={() => (checks.length === 1 ? set({ more: [{ id: newId(), variable: null, op: '==', value: 'true' }], join: 'or' }) : addCheck())}>
              <Icon name="plus" size={14} /> {checks.length === 1 ? 'Add OR variable' : `Add ${join.toUpperCase()} variable`}
            </button>
            {checks.length === 1 && (
              <button type="button" className="btn small" onClick={() => set({ more: [{ id: newId(), variable: null, op: '==', value: 'true' }], join: 'and' })}>
                <Icon name="plus" size={14} /> Add AND variable
              </button>
            )}
          </div>
        )}
        {!node.data.variable && checks.length === 1 && (
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
  const { defs, members, itemsById, allNodes, allEdges } = useContext(QuestCtx);
  const d = node.data as QuestData;
  const set = (patch: Partial<QuestData>) => update('quest_nodes', node.id, { data: { ...node.data, ...patch } });
  const items = [...itemsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  const objTypes = defs.list('objective_type');

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

      <RewardsEditor rewards={d.rewards} onChange={(rewards) => set({ rewards })} emptyWarning="This quest has no reward yet" />

      <div className="grid2">
        <div className="field">
          <span className="section-label">NEEDS</span>
          {needs.map((e) => {
            const s = allNodes.get(realSource(e.source, allNodes, allEdges));
            const oe = originEdge(e, allNodes, allEdges);
            const target = s?.kind === 'external' ? allNodes.get(s.data.ref) : s?.kind === 'quest' ? s : undefined;
            return (
              <div key={e.id} className="list-row">
                {target ? (
                  <button type="button" className="btn ghost small grow" style={{ justifyContent: 'flex-start', color: '#d4b0e3', padding: 0, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => onOpen(target.chain_id, target.id)}>
                    {describe(s, oe)}
                  </button>
                ) : (
                  <span className="grow" style={{ color: '#d4b0e3', fontSize: 13 }}>
                    {describe(s, oe)}
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
                {describe(allNodes.get(finalTarget(e.target, allNodes, allEdges)))}
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

/**
 * Pick a character from the full list, or type a new name to add one to Definitions → Characters / NPCs.
 * The list always shows every character, even when one is already chosen.
 */
function CharacterField({ value, fallback, label, onChange }: { value: string | null; fallback?: string; label: string; onChange: (id: string | null, name: string) => void }) {
  const { defs } = useContext(QuestCtx);
  const chars = defs.list('character');
  const cur = defs.get(value);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const shown = chars.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = chars.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  type Opt = { key: string; label: string; run: () => void; color?: string; current?: boolean };
  const opts: Opt[] = [
    ...shown.map((c) => ({ key: c.id, label: c.name, color: c.color, current: c.id === value, run: () => pick(c.id, c.name) })),
    ...(q.trim() && !exact ? [{ key: '__new', label: `+ Add “${q.trim()}” as a new character`, run: () => addNew(q.trim()) }] : []),
    ...(value || fallback ? [{ key: '__none', label: 'No quest giver / speaker', run: () => pick(null, '') }] : []),
  ];

  function pick(id: string | null, name: string) {
    onChange(id, name);
    setOpen(false);
  }
  function addNew(name: string) {
    const id = newId();
    insert('definitions', {
      id,
      list: 'character',
      name,
      color: SWATCHES[chars.length % SWATCHES.length],
      sort: chars.length ? Math.max(...chars.map((c) => c.sort)) + 1 : 0,
      extra: { district: '', role: '' },
    });
    pick(id, name);
  }

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) });
    setQ('');
    setHi(Math.max(0, chars.findIndex((c) => c.id === value)));
    const onDown = (e: MouseEvent) => {
      const t = e.target as globalThis.Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onScroll = (e: Event) => !menu.current?.contains(e.target as globalThis.Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className="combo" aria-haspopup="listbox" aria-expanded={open} aria-label={label + ': ' + (cur?.name ?? fallback ?? 'none')} onClick={() => setOpen(!open)}>
        <span className="dot" style={{ background: cur?.color ?? 'transparent', borderColor: cur ? 'transparent' : '#5a544a' }} />
        <span className="grow" style={{ color: cur || fallback ? 'var(--text)' : '#7a7469', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cur?.name ?? fallback ?? 'Pick or type a name'}
        </span>
        <Icon name="down" size={14} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={menu} className="popover combo-menu" style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}>
            <input
              className="input"
              autoFocus
              placeholder="Search or type a new name"
              aria-label="Search characters"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHi((h) => Math.min(opts.length - 1, h + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHi((h) => Math.max(0, h - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  opts[hi]?.run();
                } else if (e.key === 'Escape') setOpen(false);
              }}
            />
            <div role="listbox" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflow: 'auto' }}>
              {opts.map((o, i) => (
                <button
                  key={o.key}
                  type="button"
                  role="option"
                  aria-selected={!!o.current}
                  className={'combo-opt' + (i === hi ? ' hi' : '') + (o.key.startsWith('__') ? ' special' : '')}
                  onMouseEnter={() => setHi(i)}
                  onClick={o.run}
                >
                  {o.color && <span className="dot" style={{ background: o.color, position: 'static' }} />}
                  <span className="grow">{o.label}</span>
                  {o.current && <span className="muted" style={{ fontSize: 11 }}>current</span>}
                </button>
              ))}
              {opts.length === 0 && <span className="empty" style={{ padding: 8 }}>No characters yet. Type a name to add one.</span>}
            </div>
          </div>,
          document.body,
        )}
    </>
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

function LinkPanel({ edges, onRemove, onReroute }: { edges: QuestEdge[]; onRemove: () => void; onReroute: (e: QuestEdge) => void }) {
  const { allNodes, allEdges } = useContext(QuestCtx);
  const name = (rawId: string) => {
    const id = allNodes.get(rawId)?.kind === 'reroute' ? (rawId === edges[0]?.source ? realSource(rawId, allNodes, allEdges) : finalTarget(rawId, allNodes, allEdges)) : rawId;
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {edges.length === 1 && (
          <button type="button" className="btn" onClick={() => onReroute(edges[0])}>
            <span className="reroute-dot" /> Add reroute point
          </button>
        )}
        <button type="button" className="btn warn" onClick={onRemove}>
          <Icon name="x" /> Cut {edges.length === 1 ? 'this link' : 'these links'}
        </button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>You can also press Delete, or click the × on the link. Double-click a link to drop a reroute point exactly where you click.</span>
    </>
  );
}

export function newOption(text: string) {
  return { id: 'opt_' + newId().slice(0, 8), text };
}

/** Options 1, 2, 3… for a choice. Each option has its own exit dot on the node. */
function ChoicePanel({ node, edges, onDelete }: { node: QuestNode; edges: QuestEdge[]; onDelete: () => void }) {
  const { allNodes, allEdges, defs } = useContext(QuestCtx);
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
  const mode = choiceMode(node);
  const doAll = mode !== 'pick';
  const doneLinks = edges.filter((e) => e.source_handle === DONE_HANDLE);
  /** “All done” exit: creates an End (Complete) or a next quest and links it. */
  const createDoneExit = (kind: 'end' | 'quest') =>
    group(() => {
      const id = newId();
      const data =
        kind === 'end'
          ? { outcome: 'success', text: 'Quest complete' }
          : {
              code: '', name: 'Next quest', description: '', level: '', giver: '', type: defs.list('quest_type')[0]?.id ?? null, region: null, district: null,
              status: defs.list('quest_status')[0]?.id ?? null, assignee: null, objectives: [], required_items: [], rewards: [],
            };
      insert('quest_nodes', { id, chain_id: node.chain_id, kind, x: Math.round(node.x + 360), y: Math.round(node.y + (options.length / 2 + 0.5) * 170), data });
      insert('quest_edges', { id: newId(), chain_id: node.chain_id, source: node.id, target: id, kind: 'choice', label: 'All done', source_handle: DONE_HANDLE });
    });
  /** Creates a new node to the right of the choice and connects this option to it. */
  const createExit = (o: ChoiceOption, i: number, kind: 'dialogue' | 'quest' | 'end' | 'action') => group(() => {
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
    // In “Do all” mode the step leads back to this node, so the player can do the next one.
    if (doAll && kind !== 'end') {
      const back = kind === 'dialogue' ? 'response' : 'unlocks';
      insert('quest_edges', { id: newId(), chain_id: node.chain_id, source: id, target: node.id, kind: back, label: kind === 'dialogue' ? 'Back' : '', source_handle: null });
    }
  });
  const targetName = (id: string) => {
    const t = allNodes.get(finalTarget(id, allNodes, allEdges));
    if (!t) return '?';
    if (t.kind === 'quest') return questLabel(t);
    if (t.kind === 'dialogue') return 'Dialogue' + (defs.get(t.data.speaker) ? ': ' + defs.get(t.data.speaker)!.name : '');
    if (t.kind === 'end') return 'End · ' + (OUTCOMES.find((x) => x.key === t.data.outcome)?.label ?? 'Success');
    return NODE_META[t.kind]?.label ?? t.kind;
  };

  return (
    <>
      <span className="section-label" style={{ color: NODE_META.choice.color }}>{doAll ? 'DO ALL' : 'PLAYER CHOICE'}</span>
      <div className="seg" role="radiogroup" aria-label="How the options work">
        {CHOICE_MODES.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} className={mode === m.key ? 'on choice-on' : ''} onClick={() => setData({ mode: m.key })}>
            {m.label}
          </button>
        ))}
      </div>
      {doAll && (
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
          The player has to do {mode === 'order' ? 'option 1, then 2, then 3…' : 'every option, in any order'}. Each option’s path must lead back into this node. When all are done the flow leaves through <b style={{ color: 'var(--text)' }}>✓ All done</b>.
        </p>
      )}
      <TextField multiline value={node.data.text ?? ''} label="Question" placeholder={doAll ? 'e.g. Find the three missing gears' : 'e.g. Protect or expose the Guild?'} onCommit={(v) => setData({ text: v })} />

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
        {doAll && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div className="list-row">
              <span className="choice-num" style={{ position: 'static' }}>✓</span>
              <strong className="grow" style={{ fontSize: 13 }}>All done</strong>
            </div>
            {doneLinks.length > 0 ? (
              doneLinks.map((e) => (
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
                <button type="button" className="btn small" onClick={() => createDoneExit('end')}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: NODE_META.end.color }} /> End · Quest complete
                </button>
                <button type="button" className="btn small" onClick={() => createDoneExit('quest')}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: NODE_META.quest.color }} /> Next quest
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <button type="button" className="btn warn" style={{ alignSelf: 'flex-start' }} onClick={onDelete}>
        <Icon name="trash" /> Delete node
      </button>
    </>
  );
}

type Reward = { type: string | null; text: string; item: string | null; amount: number };
/** Rewards list (XP, currency, item, blueprint…) used by quests and End nodes. */
function RewardsEditor({ rewards, onChange, emptyWarning }: { rewards: Reward[]; onChange: (r: Reward[]) => void; emptyWarning?: string }) {
  const { defs, itemsById } = useContext(QuestCtx);
  const items = [...itemsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  const rewardTypes = defs.list('reward_type');
  return (
    <div className="card-box">
      <span className="section-label">REWARDS</span>
      {rewards.map((r, i) => {
        const patch = (p: Partial<Reward>) => onChange(rewards.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <div className="list-row">
              <span className="grow">
                <DefSelect options={rewardTypes} value={r.type} onChange={(v) => patch({ type: v })} label="Reward type" />
              </span>
              <input className="input" type="number" aria-label="Amount" value={r.amount} style={{ width: 84 }} onChange={(e) => patch({ amount: parseInt(e.target.value) || 0 })} />
              <button type="button" className="icon-btn danger" aria-label="Remove reward" onClick={() => onChange(rewards.filter((_, j) => j !== i))}>
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
      {rewards.length === 0 &&
        (emptyWarning ? (
          <div className="warn-box">
            <Icon name="warn" /> {emptyWarning}
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>No rewards</span>
        ))}
      <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...rewards, { type: rewardTypes[0]?.id ?? null, text: '', item: null, amount: 1 }])}>
        <Icon name="plus" size={14} /> Add reward
      </button>
    </div>
  );
}

/** Chapter of a chain; chains are grouped by chapter in the tabs and on the Quest map. */
function ChapterField({ chain }: { chain: QuestChain }) {
  const { defs } = useContext(QuestCtx);
  const chapters = defs.list('chapter');
  return (
    <label className="field">
      <span className="field-label">Chapter</span>
      <DefSelect options={chapters} value={chain.chapter ?? null} allowEmpty label="Chapter" onChange={(v) => update('quest_chains', chain.id, { chapter: v })} />
      {chapters.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Add chapters under Definitions → Chapters.</span>}
    </label>
  );
}
