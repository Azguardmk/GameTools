import { useContext } from 'react';
import { Icon, NpcIcon } from '../../components/ui';
import type { QuestNode } from '../../lib/types';
import { NODE_META, QuestCtx, questLabel } from './shared';

/** Which nodes involve this NPC: quests they give, dialogue lines and endings they speak. */
export function npcNodes(npcId: string, nodes: QuestNode[]) {
  return nodes.filter((n) => (n.kind === 'quest' && n.data.giver_id === npcId) || ((n.kind === 'dialogue' || n.kind === 'end') && n.data.speaker === npcId));
}

/** Right-hand panel in the quest editor when an NPC is picked in the library. */
export function NpcPanel(props: { npcId: string; chainNodes: QuestNode[]; onSelectNode: (id: string) => void; onOpenChain: (chainId: string, node?: string) => void; onEdit: () => void; onClose: () => void }) {
  const { defs, allNodes, chains } = useContext(QuestCtx);
  const c = defs.get(props.npcId);
  if (!c) return null;
  const here = npcNodes(c.id, props.chainNodes).sort((a, b) => a.x - b.x || a.y - b.y);
  const elsewhere = npcNodes(c.id, [...allNodes.values()]).filter((n) => !props.chainNodes.some((x) => x.id === n.id));
  const relations: { id: string; other: string | null; kind: string; note: string }[] = Array.isArray(c.extra?.relations) ? c.extra.relations : [];
  const district = defs.get(c.extra?.district);
  const region = defs.get(c.extra?.region) ?? defs.get(district?.extra?.region);
  const label = (n: QuestNode) => (n.kind === 'quest' ? questLabel(n) : n.kind === 'end' ? 'Ending' + (n.data.dialogue ? ': “' + String(n.data.dialogue).slice(0, 40) + '…”' : '') : '“' + (String(n.data.text || '…').slice(0, 50)) + (String(n.data.text || '').length > 50 ? '…' : '') + '”');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="section-label" style={{ color: c.color, flex: 1 }}>NPC</span>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Stop highlighting this NPC" title="Close (Esc)">
          <Icon name="x" />
        </button>
      </div>
      <div className="npc-card" style={{ borderColor: c.color + '88' }}>
        {c.extra?.image ? <img className="npc-portrait" src={c.extra.image} alt={'Portrait of ' + c.name} style={{ borderColor: c.color }} /> : <NpcIcon name={c.name} color={c.color} size={64} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <strong style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, color: c.color }}>{c.name}</strong>
          {c.extra?.role && <span style={{ fontSize: 13 }}>{c.extra.role}</span>}
          {(district || region) && <span className="muted" style={{ fontSize: 12 }}>{[district?.name, region?.name].filter(Boolean).join(' · ')}</span>}
        </div>
      </div>
      <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={props.onEdit}>
        Edit profile
      </button>

      <div className="card-box">
        <span className="section-label">IN THIS CHAIN ({here.length})</span>
        {here.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Not in this chain. Drag them onto a quest, dialogue or End to add them.</span>}
        {here.map((n) => (
          <button key={n.id} type="button" className="list-row link-row" onClick={() => props.onSelectNode(n.id)}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: NODE_META[n.kind].color, flex: 'none' }} />
            <span className="grow">
              <span className="muted" style={{ fontSize: 11 }}>{n.kind === 'quest' ? 'Gives quest' : n.kind === 'end' ? 'Speaks at' : 'Says'} </span>
              {label(n)}
            </span>
          </button>
        ))}
        {elsewhere.length > 0 && (
          <>
            <span className="field-label" style={{ marginTop: 4 }}>In other chains</span>
            {elsewhere.map((n) => (
              <button key={n.id} type="button" className="list-row link-row" onClick={() => props.onOpenChain(n.chain_id, n.id)}>
                <span className="grow">
                  {label(n)} <span className="muted" style={{ fontSize: 11 }}>· {chains.get(n.chain_id)?.name}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>

      {c.extra?.looks && (
        <div className="field">
          <span className="field-label">Visual description</span>
          <p className="npc-text">{c.extra.looks}</p>
        </div>
      )}
      {c.extra?.story && (
        <div className="field">
          <span className="field-label">Background story</span>
          <p className="npc-text">{c.extra.story}</p>
        </div>
      )}
      {relations.length > 0 && (
        <div className="field">
          <span className="field-label">Relations</span>
          {relations.map((r) => {
            const o = defs.get(r.other);
            return (
              <span key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                {o && <NpcIcon name={o.name} color={o.color} image={o.extra?.image} size={20} />}
                <span>
                  <strong style={{ color: o?.color }}>{o?.name ?? '?'}</strong> · {r.kind || 'related'}
                  {r.note && <span className="muted"> — {r.note}</span>}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {!c.extra?.looks && !c.extra?.story && relations.length === 0 && (
        <span className="muted" style={{ fontSize: 13 }}>No profile details yet. Use “Edit profile” to add looks, background story and relations.</span>
      )}
    </>
  );
}
