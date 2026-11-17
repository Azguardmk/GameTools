import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { useTable } from '../lib/db';
import type { QuestChain, QuestEdge, QuestNode } from '../lib/types';

/*
 * Read-only overview: every quest by name, grouped in one lane per chain.
 * Solid grey lines = next quest in the same chain (choices are folded in).
 * Dashed lines = a quest needs a quest from another chain.
 */

function MapQuest({ data }: NodeProps) {
  return (
    <div className="mapnode" style={{ borderColor: data.color as string }} title={data.title as string}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {data.label as string}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

function Lane({ data }: NodeProps) {
  return (
    <span className="maplane">
      <span style={{ width: 9, height: 9, borderRadius: 3, background: data.color as string }} />
      {(data.label as string).toUpperCase()}
    </span>
  );
}

const nodeTypes = { q: MapQuest, lane: Lane };
const COL = 240;
const ROW = 58;

export default function QuestMapPage() {
  const { rows: chainsRaw } = useTable<QuestChain>('quest_chains');
  const { rows: nodes } = useTable<QuestNode>('quest_nodes');
  const { rows: edges } = useTable<QuestEdge>('quest_edges');
  const navigate = useNavigate();

  const { rfNodes, rfEdges, count } = useMemo(() => {
    const chains = [...chainsRaw].sort((a, b) => a.sort - b.sort);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const quests = nodes.filter((n) => n.kind === 'quest');

    // Resolve quest → quest links, folding choices and external references.
    const links: { from: string; to: string; cross: boolean }[] = [];
    const seen = new Set<string>();
    const addLink = (from: string, to: string) => {
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b || from === to || seen.has(from + to)) return;
      seen.add(from + to);
      links.push({ from, to, cross: a.chain_id !== b.chain_id });
    };
    const questSources = (id: string, guard = new Set<string>()): string[] => {
      const n = byId.get(id);
      if (!n || guard.has(id)) return [];
      guard.add(id);
      if (n.kind === 'quest') return [id];
      if (n.kind === 'external') return n.data.ref && byId.get(n.data.ref)?.kind === 'quest' ? [n.data.ref] : [];
      if (n.kind === 'choice') return edges.filter((e) => e.target === id).flatMap((e) => questSources(e.source, guard));
      return [];
    };
    for (const e of edges) {
      const t = byId.get(e.target);
      if (t?.kind !== 'quest') continue;
      questSources(e.source).forEach((s) => addLink(s, e.target));
    }

    // Column = longest chain of prerequisites (across all chains), so the map reads left to right.
    const incoming = new Map<string, string[]>();
    links.forEach((l) => incoming.set(l.to, [...(incoming.get(l.to) ?? []), l.from]));
    const depth = new Map<string, number>();
    const visit = (id: string, guard: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (guard.has(id)) return 0;
      guard.add(id);
      const d = Math.max(-1, ...(incoming.get(id) ?? []).map((s) => visit(s, guard))) + 1;
      depth.set(id, d);
      return d;
    };
    quests.forEach((q) => visit(q.id, new Set()));

    const rfNodes: Node[] = [];
    let y = 0;
    for (const ch of chains) {
      const qs = quests.filter((q) => q.chain_id === ch.id).sort((a, b) => a.y - b.y);
      if (!qs.length) continue;
      const rowsUsed = new Map<number, number>();
      const minDepth = Math.min(...qs.map((q) => depth.get(q.id) ?? 0));
      rfNodes.push({ id: 'lane-' + ch.id, type: 'lane', position: { x: minDepth * COL, y }, data: { label: ch.name, color: ch.color }, draggable: false, selectable: false });
      let maxRow = 0;
      for (const q of qs) {
        const d = depth.get(q.id) ?? 0;
        const row = rowsUsed.get(d) ?? 0;
        rowsUsed.set(d, row + 1);
        maxRow = Math.max(maxRow, row);
        rfNodes.push({
          id: q.id,
          type: 'q',
          position: { x: d * COL, y: y + 28 + row * ROW },
          data: { label: q.data.name || q.data.code || 'Untitled quest', title: `${q.data.code ?? ''} ${q.data.name ?? ''}`.trim(), color: ch.color, chain: ch.id },
          draggable: false,
        });
      }
      y += 28 + (maxRow + 1) * ROW + 44;
    }

    const rfEdges: Edge[] = links.map((l) => ({
      id: l.from + '-' + l.to,
      source: l.from,
      target: l.to,
      type: 'default',
      style: l.cross ? { stroke: '#d9a75e', strokeWidth: 2, strokeDasharray: '6 6' } : { stroke: '#5a544a', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: l.cross ? '#d9a75e' : '#5a544a', width: 14, height: 14 },
    }));
    return { rfNodes, rfEdges, count: quests.length };
  }, [chainsRaw, nodes, edges]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 30 }}>Quest map</h1>
        <span className="muted">{count} quests</span>
      </div>
      <div className="flow-wrap" style={{ height: 'calc(100vh - 200px)' }}>
        {count === 0 ? (
          <div className="empty">No quests yet. Create some in the Quests editor.</div>
        ) : (
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            nodesDraggable={false}
            elementsSelectable={false}
            onNodeClick={(_e, n) => n.type === 'q' && navigate(`/quests?chain=${n.data.chain}&node=${n.id}`)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.15}
            colorMode="dark"
          >
            <Background color="#24221f" gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
      <div className="legend">
        <span>
          <i style={{ borderColor: '#5a544a' }} />
          Next quest in the same chain
        </span>
        <span>
          <i style={{ borderColor: '#d9a75e', borderTopStyle: 'dashed' }} />
          Link to another chain
        </span>
        <span className="muted">Click a quest to open it in the editor</span>
      </div>
    </>
  );
}
