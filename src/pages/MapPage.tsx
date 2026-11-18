import { useEffect, useMemo, useState } from 'react';
import { update } from '../lib/db';
import { useDefinitions } from '../lib/hooks';
import { uploadMapImage } from '../lib/mapImages';
import { useCanvasSize } from '../lib/canvas';
import { MapView, Star } from '../components/MapView';
import { Icon, NpcIcon } from '../components/ui';
import { CharacterProfile } from './CharacterProfile';

/*
 * Map tab: one map per level (region) with every NPC as a star in their own colour.
 * Pick an NPC to highlight it; drag stars to move them; NPCs without a star can be placed by clicking the map.
 */
export default function MapPage() {
  const defs = useDefinitions();
  const regions = defs.list('region');
  const [regionId, setRegionId] = useState<string | null>(() => localStorage.getItem('earthlings-tools:map-region'));
  const region = defs.get(regionId) ?? regions[0];
  useEffect(() => {
    if (region) localStorage.setItem('earthlings-tools:map-region', region.id);
  }, [region]);
  const [active, setActive] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [labels, setLabels] = useState(false);
  const [district, setDistrict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useCanvasSize('npc-map', 250);

  const npcs = useMemo(() => defs.list('character').filter((c) => region && (c.extra?.region === region.id || c.extra?.pin?.region === region.id || defs.get(c.extra?.district)?.extra?.region === region.id)), [defs, region]);
  const shown = npcs.filter((c) => !district || c.extra?.district === district);
  const placed = shown.filter((c) => c.extra?.pin?.region === region?.id);
  const unplaced = shown.filter((c) => c.extra?.pin?.region !== region?.id);
  const districts = defs.list('district').filter((d) => d.extra?.region === region?.id);

  const setPin = (id: string, x: number, y: number) => {
    const c = defs.get(id);
    if (!c || !region) return;
    update('definitions', id, { extra: { ...c.extra, pin: { region: region.id, x, y }, region: c.extra?.region || region.id } });
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
  const activeNpc = defs.get(active);
  const sub = (c: (typeof npcs)[number]) => [c.extra?.role, defs.get(c.extra?.building)?.name, defs.get(c.extra?.location)?.name, defs.get(c.extra?.district)?.name].filter(Boolean).join(' · ');

  return (
    <div className="npcmap" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="page-head" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 30 }}>Map</h1>
        <span className="muted">Where every NPC is, per level</span>
      </div>
      <div ref={canvas.wrapRef} className={'canvas-area ' + canvas.className} style={canvas.style}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div className="chain-tabs" role="tablist" aria-label="Levels" style={{ borderBottom: 'none' }}>
            {regions.map((r) => (
              <button key={r.id} type="button" role="tab" aria-selected={region?.id === r.id} aria-current={region?.id === r.id ? 'page' : undefined} onClick={() => { setRegionId(r.id); setActive(null); setPlacing(null); setDistrict(null); }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color }} />
                {r.name}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {districts.length > 0 && (
            <span className="select-wrap" style={{ width: 200 }}>
              <select aria-label="Show district" value={district ?? ''} onChange={(e) => setDistrict(e.target.value || null)} style={{ paddingLeft: 10 }}>
                <option value="">All districts</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </span>
          )}
          <button type="button" className="btn small" aria-pressed={labels} onClick={() => setLabels(!labels)}>
            {labels ? '✓ ' : ''}Names
          </button>
          {region && (
            <label className="btn small" style={{ cursor: 'pointer' }}>
              {busy ? 'Uploading…' : region.extra?.map ? 'Replace map' : 'Upload map'}
              <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          )}
          {canvas.maxButton}
        </div>

        <div className="split">
          <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className={'flow-wrap' + (labels ? ' show-labels' : '')} style={{ background: '#0d0c0b' }}>
              {!region ? (
                <div className="empty">Add regions under Definitions → Regions first.</div>
              ) : region.extra?.map ? (
                <MapView
                  image={region.extra.map}
                  height="100%"
                  starSize={22}
                  pins={placed.map((c) => ({ id: c.id, x: c.extra.pin.x, y: c.extra.pin.y, color: c.color, label: c.name, active: active === c.id, dim: !!active && active !== c.id }))}
                  onPinClick={(id) => setActive(active === id ? null : id)}
                  onMove={setPin}
                  onPlace={
                    placing
                      ? (x, y) => {
                          setPin(placing, x, y);
                          setActive(placing);
                          setPlacing(null);
                        }
                      : undefined
                  }
                />
              ) : (
                <label className="map-empty" style={{ height: '100%', cursor: 'pointer', border: 'none' }}>
                  <strong style={{ color: 'var(--text)', fontSize: 16 }}>No map for {region.name} yet</strong>
                  {busy ? 'Uploading…' : 'Click to upload the level map image (PNG or JPG).'}
                  <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
                </label>
              )}
            </div>
            {canvas.grip}
            {placing && (
              <div className="warn-box" style={{ alignSelf: 'flex-start' }}>
                Click on the map to place <strong>{defs.get(placing)?.name}</strong>.{' '}
                <button type="button" className="btn ghost small" onClick={() => setPlacing(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          <aside className="panel side" aria-label="NPCs on this level">
            {activeNpc && (
              <div className="npc-card" style={{ borderColor: activeNpc.color + '88', flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {activeNpc.extra?.image ? <img className="npc-portrait" style={{ width: 72, height: 90, borderColor: activeNpc.color }} src={activeNpc.extra.image} alt={'Portrait of ' + activeNpc.name} /> : <NpcIcon name={activeNpc.name} color={activeNpc.color} size={52} />}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                    <strong style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, color: activeNpc.color }}>{activeNpc.name}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>{sub(activeNpc) || 'Character'}</span>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Close" onClick={() => setActive(null)}>
                    <Icon name="x" />
                  </button>
                </div>
                {activeNpc.extra?.looks && <p className="npc-text">{activeNpc.extra.looks}</p>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn small" onClick={() => setProfile(activeNpc.id)}>
                    Open profile
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setPlacing(activeNpc.id)}>
                    Move star
                  </button>
                </div>
              </div>
            )}
            <span className="section-label">ON THIS MAP ({placed.length})</span>
            {placed.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No NPCs placed on this level yet.</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {placed.map((c) => (
                <button key={c.id} type="button" className={'lib-entry' + (active === c.id ? ' active' : '')} style={{ cursor: 'pointer', ...(active === c.id ? { borderColor: c.color } : {}) }} onClick={() => setActive(active === c.id ? null : c.id)}>
                  <Star color={c.color} size={16} />
                  <NpcIcon name={c.name} color={c.color} image={c.extra?.image} size={24} />
                  <span className="lib-text">
                    <strong>{c.name}</strong>
                    <span>{sub(c) || 'Character'}</span>
                  </span>
                </button>
              ))}
            </div>
            {unplaced.length > 0 && (
              <>
                <span className="section-label" style={{ marginTop: 4 }}>NOT PLACED YET ({unplaced.length})</span>
                {unplaced.map((c) => (
                  <div key={c.id} className="list-row" style={{ gap: 8 }}>
                    <NpcIcon name={c.name} color={c.color} image={c.extra?.image} size={24} />
                    <span className="grow" style={{ fontSize: 13 }}>{c.name}</span>
                    <button type="button" className="btn small" disabled={!region?.extra?.map} onClick={() => setPlacing(c.id)} aria-pressed={placing === c.id}>
                      Place
                    </button>
                  </div>
                ))}
              </>
            )}
            <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Stars use each NPC’s colour. Click a star to see who it is, drag it to move them. Scroll to zoom, drag the map to move around. NPCs show here when their region is {region?.name ?? 'this level'}.
            </span>
          </aside>
        </div>
      </div>
      {profile && defs.get(profile) && <CharacterProfile key={profile} c={defs.get(profile)!} onClose={() => setProfile(null)} onOpen={setProfile} />}
    </div>
  );
}
