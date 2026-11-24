import type { ReactNode } from 'react';
import type { GameData } from '../lib/gameData';
import { useDefinitions } from '../lib/hooks';
import type { Item } from '../lib/types';
import { ItemIcon } from './ui';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const UE_HELP = 'Imported from Unreal, but no written quest gives it as a reward or asks for it.';

/** Small badge on an item: imported from Unreal and not used in any questline (or removed from Unreal). */
export function UeBadge({ item, gd }: { item: Item; gd: GameData }) {
  if (!item.ue_asset) return null;
  if (item.ue?.removed) return <span className="ue-pill gone" title="Not in the last Unreal import: the asset was deleted or renamed.">Removed from UE</span>;
  if (gd.notInQuests(item)) return <span className="ue-pill" title={UE_HELP}>UE · not in quests</span>;
  return <span className="ue-pill ok" title={'In Unreal (' + item.ue_asset + ') and used by a quest'}>UE</span>;
}

/** An item named by its Unreal asset, as used inside recipes, drop tables, loot tables and shops. */
export function UeItemChip({ asset, gd, suffix }: { asset: string | null | undefined; gd: GameData; suffix?: string }) {
  const defs = useDefinitions();
  if (!asset) return <span className="muted">—</span>;
  const it = gd.byAsset.get(asset);
  const unused = !it || !gd.questUse.has(it.id);
  const cat = defs.get(it?.category);
  const rar = defs.get(it?.rarity);
  return (
    <span className={'ue-chip' + (unused ? ' unused' : '')} title={(it ? it.name : asset) + ' · ' + asset + (unused ? '\n' + UE_HELP : '\nUsed in: ' + gd.questUse.get(it!.id)!.join(', '))}>
      <ItemIcon name={it?.name ?? asset} icon={it?.icon_url} color={cat?.color} edge={rar?.color} size={18} />
      <span>{it?.name ?? asset}</span>
      {suffix && <em>{suffix}</em>}
      {unused && <span className="ue-dot" aria-label="not in questlines" />}
    </span>
  );
}

function Row({ label, value, warn }: { label: string; value: ReactNode; warn?: string }) {
  return (
    <div className="ue-kv">
      <span className="muted">{label}</span>
      <span>
        {value}
        {warn && <em className="ue-diff" title={warn}> ≠ tool</em>}
      </span>
    </div>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(show).join(', ') || '—';
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${show(x)}`)
      .join(' · ');
  return String(v);
}

/** The Unreal side of an item, shown in the item editor. */
export function UeItemPanel({ item, gd }: { item: Item; gd: GameData }) {
  const defs = useDefinitions();
  const ue = item.ue;
  if (!item.ue_asset || !ue)
    return (
      <div className="card-box ue-box missing">
        <span className="section-label">UNREAL</span>
        <span className="muted" style={{ fontSize: 13 }}>No Unreal asset for this item yet.</span>
      </div>
    );
  const unused = gd.notInQuests(item);
  const rarName = defs.get(item.rarity)?.name;
  const catName = defs.get(item.category)?.name;
  const props = Object.entries(ue.props ?? {}).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  return (
    <div className={'card-box ue-box' + (unused ? ' unused' : '')}>
      <div className="list-row">
        <span className="section-label grow">IN UNREAL</span>
        <code style={{ fontSize: 12, color: 'var(--accent-text)' }}>{item.ue_asset}</code>
      </div>
      {ue.removed && <div className="warn-box">Not in the last import: the asset was deleted or renamed in Unreal.</div>}
      {unused ? (
        <div className="ue-note">
          <span className="ue-dot" /> Not used in any questline yet. Add it to a quest's rewards or required items, or leave it if it only comes from drops, loot or shops.
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>Used in: {gd.questUse.get(item.id)?.join(', ')}</div>
      )}
      <Row label="Name" value={ue.name} warn={norm(ue.name) !== norm(item.name) ? `Tool name: ${item.name}` : undefined} />
      <Row label="Type" value={`${ue.class.replace(/DataAsset$/, '')} · ${ue.ue_category}`} warn={catName && catName !== ue.category ? `Import would put it in ${ue.category}` : undefined} />
      <Row label="Rarity / tier" value={`${ue.rarity}${ue.tier ? ' · tier ' + ue.tier : ''}`} warn={rarName && rarName !== ue.rarity ? `Tool rarity: ${rarName}` : undefined} />
      <Row label="Stack" value={ue.stack} warn={ue.stack !== item.stack ? `Tool stack: ${item.stack}` : undefined} />
      {ue.slot && <Row label="Slot" value={ue.slot} />}
      {(ue.nft || ue.single_use || ue.bound) && <Row label="Flags" value={[ue.nft && 'NFT', ue.single_use && 'single use', ue.bound && 'bound to character'].filter(Boolean).join(', ')} />}
      {ue.ability && <Row label="Ability" value={ue.ability} />}
      {ue.description && ue.description !== item.description && <Row label="Description" value={ue.description} />}
      {props.map(([k, v]) => (
        <Row key={k} label={k.replace(/^b(?=[A-Z])/, '')} value={show(v)} />
      ))}
      <span className="muted" style={{ fontSize: 11 }}>{ue.path}</span>
    </div>
  );
}
