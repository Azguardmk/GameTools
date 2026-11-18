import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { insert, newId, update, useTable } from '../lib/db';
import { uploadMapImage } from '../lib/mapImages';
import { MapView } from '../components/MapView';
import { useDefinitions } from '../lib/hooks';
import type { Definition, QuestNode } from '../lib/types';
import { DefSelect, Icon, NpcIcon, TextField } from '../components/ui';

/*
 * Full profile of a character / NPC: portrait, looks, background story, where they live
 * (region and district), their relations with other NPCs and the quests they appear in.
 */
type Relation = { id: string; other: string | null; kind: string; note: string };
const KINDS = ['Friend', 'Ally', 'Rival', 'Enemy', 'Family', 'Partner', 'Mentor', 'Student', 'Employer', 'Employee', 'Informant', 'Owes a debt to'];

/** Shrinks a picture to at most 512 px and returns it as a JPEG data URL, so it can be stored with the NPC. */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function CharacterProfile({ c, onClose, onOpen }: { c: Definition; onClose: () => void; onOpen: (id: string) => void }) {
  const defs = useDefinitions();
  const { rows: qNodes } = useTable<QuestNode>('quest_nodes');
  const set = (patch: Record<string, unknown>) => update('definitions', c.id, { extra: { ...c.extra, ...patch } });
  const relations: Relation[] = Array.isArray(c.extra?.relations) ? c.extra.relations : [];
  const setRelations = (next: Relation[]) => set({ relations: next });
  const others = defs.list('character').filter((o) => o.id !== c.id);
  const [dragOver, setDragOver] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Relations other NPCs have set towards this one.
  const incoming = useMemo(
    () =>
      defs
        .list('character')
        .filter((o) => o.id !== c.id)
        .flatMap((o) => (Array.isArray(o.extra?.relations) ? (o.extra.relations as Relation[]) : []).filter((r) => r.other === c.id).map((r) => ({ from: o, r }))),
    [defs, c.id],
  );
  const quests = qNodes.filter((n) => (n.kind === 'quest' && n.data.giver_id === c.id) || ((n.kind === 'dialogue' || n.kind === 'end') && n.data.speaker === c.id));
  const giverOf = quests.filter((n) => n.kind === 'quest');
  const lines = quests.length - giverOf.length;

  const useFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setImgError('That file isn’t an image.');
    try {
      setImgError(null);
      set({ image: await shrinkImage(file) });
    } catch {
      setImgError('Couldn’t read that image.');
    }
  };

  const district = defs.get(c.extra?.district);
  const region = defs.get(c.extra?.region);

  return createPortal(
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={'Profile of ' + c.name}>
        <header className="drawer-head">
          <NpcIcon name={c.name} color={c.color} image={c.extra?.image} size={40} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span className="section-label">CHARACTER / NPC</span>
            <TextField value={c.name} label="Name" onCommit={(v) => v.trim() && update('definitions', c.id, { name: v.trim() })} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: c.color }} />
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close profile" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </header>

        <div className="drawer-body">
          <div className="profile-top">
            <div
              className={'portrait' + (dragOver ? ' over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                useFile(e.dataTransfer.files?.[0]);
              }}
              style={{ borderColor: c.color }}
            >
              {c.extra?.image ? <img src={c.extra.image} alt={'Portrait of ' + c.name} /> : <span className="muted">Drop an image here</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
              <label className="btn small" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
                <Icon name="plus" size={14} /> {c.extra?.image ? 'Replace image' : 'Upload image'}
                <input type="file" accept="image/*" hidden onChange={(e) => useFile(e.target.files?.[0])} />
              </label>
              <TextField value={c.extra?.image?.startsWith('data:') ? '' : c.extra?.image ?? ''} label="Image link" placeholder="…or paste an image link (https://…)" onCommit={(v) => set({ image: v.trim() })} />
              {c.extra?.image && (
                <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ image: '' })}>
                  Remove image
                </button>
              )}
              {imgError && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{imgError}</span>}
              <span className="muted" style={{ fontSize: 11 }}>Uploaded images are shrunk to 512 px.</span>
            </div>
          </div>

          <LocationSection c={c} set={set} />
          <label className="field">
            <span className="field-label">Role</span>
            <TextField value={c.extra?.role ?? ''} label="Role" placeholder="e.g. Clockmaker" onCommit={(v) => set({ role: v })} />
          </label>

          <label className="field">
            <span className="field-label">Visual description</span>
            <TextField multiline rows={4} value={c.extra?.looks ?? ''} label="Visual description" placeholder="What they look like: build, clothing, colours, props, how they move…" onCommit={(v) => set({ looks: v })} />
          </label>
          <label className="field">
            <span className="field-label">Background story</span>
            <TextField multiline rows={7} value={c.extra?.story ?? ''} label="Background story" placeholder="Where they come from, what they want, what they hide…" onCommit={(v) => set({ story: v })} />
          </label>

          <div className="card-box">
            <span className="section-label">RELATIONS WITH OTHER NPCs</span>
            {relations.map((r, i) => {
              const patch = (p: Partial<Relation>) => setRelations(relations.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                  <div className="list-row">
                    <span className="grow">
                      <DefSelect options={others} value={r.other} label={'Relation ' + (i + 1) + ' NPC'} onChange={(v) => patch({ other: v })} allowEmpty />
                    </span>
                    <span style={{ width: 150 }}>
                      <TextField value={r.kind} label={'Relation ' + (i + 1) + ' type'} placeholder="Rival, Family…" list="relation-kinds" onCommit={(v) => patch({ kind: v })} />
                    </span>
                    <button type="button" className="icon-btn danger" aria-label={'Remove relation ' + (i + 1)} onClick={() => setRelations(relations.filter((_, j) => j !== i))}>
                      <Icon name="x" />
                    </button>
                  </div>
                  <TextField value={r.note} label={'Relation ' + (i + 1) + ' note'} placeholder="Note (optional), e.g. they fell out over the Clocktower job" onCommit={(v) => patch({ note: v })} />
                </div>
              );
            })}
            {relations.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No relations yet.</span>}
            <button
              type="button"
              className="btn ghost small"
              style={{ alignSelf: 'flex-start' }}
              disabled={!others.length}
              onClick={() => setRelations([...relations, { id: newId(), other: null, kind: '', note: '' }])}
            >
              <Icon name="plus" size={14} /> Add relation
            </button>
            <datalist id="relation-kinds">
              {KINDS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            {incoming.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <span className="field-label">Set by other NPCs</span>
                {incoming.map(({ from, r }) => (
                  <button key={from.id + r.id} type="button" className="list-row link-row" onClick={() => onOpen(from.id)}>
                    <NpcIcon name={from.name} color={from.color} image={from.extra?.image} size={20} />
                    <span className="grow">
                      <strong style={{ color: from.color }}>{from.name}</strong> → {r.kind || 'related'}
                      {r.note && <span className="muted"> · {r.note}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card-box">
            <span className="section-label">IN QUESTS</span>
            {quests.length === 0 ? (
              <span className="muted" style={{ fontSize: 13 }}>Not used in any quest yet.</span>
            ) : (
              <>
                {giverOf.map((q) => (
                  <span key={q.id} style={{ fontSize: 13 }}>
                    Quest giver of <strong>{q.data.name || q.data.code || 'Untitled quest'}</strong>
                  </span>
                ))}
                {lines > 0 && <span style={{ fontSize: 13 }}>Speaks in {lines} dialogue / ending node{lines === 1 ? '' : 's'}</span>}
              </>
            )}
            {(region || district) && <span className="muted" style={{ fontSize: 12 }}>Lives in {[district?.name, region?.name].filter(Boolean).join(', ')}</span>}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/** Where the NPC is: region, district, location, building, and a red star on the level map. */
function LocationSection({ c, set }: { c: Definition; set: (patch: Record<string, unknown>) => void }) {
  const defs = useDefinitions();
  const [busy, setBusy] = useState(false);
  const regionId: string = c.extra?.region || defs.get(c.extra?.district)?.extra?.region || '';
  const region = defs.get(regionId);
  const pin = c.extra?.pin && c.extra.pin.region === regionId ? (c.extra.pin as { region: string; x: number; y: number }) : null;
  const districts = defs.list('district').filter((d) => !regionId || !d.extra?.region || d.extra.region === regionId);
  const locations = defs.list('location').filter((l) => (c.extra?.district ? !l.extra?.district || l.extra.district === c.extra.district : !regionId || !l.extra?.region || l.extra.region === regionId));
  const buildings = defs.list('building').filter((b) => (c.extra?.location ? !b.extra?.location || b.extra.location === c.extra.location : c.extra?.district ? !b.extra?.district || b.extra.district === c.extra.district : true));
  const nextSort = (list: string) => {
    const rows = defs.list(list as never);
    return rows.length ? Math.max(...rows.map((r) => r.sort)) + 1 : 0;
  };
  const addNew = (list: 'location' | 'building') => {
    const name = prompt(list === 'location' ? 'Name of the new location (e.g. Gare du Nord platform)' : 'Name of the new building (e.g. Venn’s Clock Shop)');
    if (!name?.trim()) return;
    const id = newId();
    const extra = list === 'location' ? { region: regionId, district: c.extra?.district ?? '', notes: '' } : { location: c.extra?.location ?? '', district: c.extra?.district ?? '', notes: '' };
    insert('definitions', { id, list, name: name.trim(), color: c.color, sort: nextSort(list), extra });
    set({ [list]: id });
  };
  const upload = async (file?: File | null) => {
    if (!file || !region) return;
    setBusy(true);
    try {
      const url = await uploadMapImage(region.id, file);
      update('definitions', region.id, { extra: { ...region.extra, map: url } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-box">
      <span className="section-label">LOCATION</span>
      <div className="grid2">
        <label className="field">
          <span className="field-label">Region / level</span>
          <DefSelect options={defs.list('region')} value={regionId || null} allowEmpty label="Region" onChange={(v) => set({ region: v ?? '' })} />
        </label>
        <label className="field">
          <span className="field-label">District</span>
          <DefSelect options={districts} value={c.extra?.district || null} allowEmpty label="District" onChange={(v) => set({ district: v ?? '', region: (v && defs.get(v)?.extra?.region) || regionId })} />
        </label>
        <div className="field">
          <span className="field-label">Location</span>
          <div className="list-row">
            <span className="grow">
              <DefSelect options={locations} value={c.extra?.location || null} allowEmpty label="Location" onChange={(v) => set({ location: v ?? '' })} />
            </span>
            <button type="button" className="icon-btn" title="New location" aria-label="New location" onClick={() => addNew('location')}>
              <Icon name="plus" size={14} />
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Building</span>
          <div className="list-row">
            <span className="grow">
              <DefSelect options={buildings} value={c.extra?.building || null} allowEmpty label="Building" onChange={(v) => set({ building: v ?? '' })} />
            </span>
            <button type="button" className="icon-btn" title="New building" aria-label="New building" onClick={() => addNew('building')}>
              <Icon name="plus" size={14} />
            </button>
          </div>
        </div>
      </div>

      {!region ? (
        <span className="muted" style={{ fontSize: 13 }}>Pick a region to place this NPC on its map.</span>
      ) : region.extra?.map ? (
        <>
          <MapView image={region.extra.map} height={320} pins={pin ? [{ id: c.id, x: pin.x, y: pin.y, color: '#e0303c', label: c.name, active: true }] : []} onPlace={(x, y) => set({ pin: { region: region.id, x, y } })} onMove={(_id, x, y) => set({ pin: { region: region.id, x, y } })} starSize={20} />
          <div className="list-row" style={{ fontSize: 12 }}>
            <span className="muted grow">{pin ? 'Click the map to move the red star, or drag it. Scroll to zoom, drag to move around.' : 'Click the map to place this NPC (a red star).'}</span>
            {pin && (
              <button type="button" className="btn ghost small" onClick={() => set({ pin: null })}>
                Remove star
              </button>
            )}
          </div>
        </>
      ) : (
        <label className="map-empty" style={{ cursor: 'pointer' }}>
          <strong style={{ color: 'var(--text)' }}>No map for {region.name} yet</strong>
          {busy ? 'Uploading…' : 'Click to upload the level map image (PNG or JPG). It’s shared with the Map tab.'}
          <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}
