import { useEffect, useMemo, useState } from 'react';
import { insert, newId, update } from '../lib/db';
import { download, useDefinitions } from '../lib/hooks';
import { uploadMapImage } from '../lib/mapImages';
import { useCanvasSize } from '../lib/canvas';
import { LOCATION_KINDS, type Definition } from '../lib/types';
import { MapView, PinIcon, insideArea, shapeFor, type MapArea, type MapPin, type PinShape, type Pt } from '../components/MapView';
import { Icon, NpcIcon } from '../components/ui';
import { CharacterProfile } from './CharacterProfile';

/*
 * Map tab: one map per level (region).
 * - NPCs are stars in their own colour, buildings are little houses, locations are diamonds. Drag to move, or pick one and place it.
 * - Districts are coloured areas. Draw a district's border point by point (straight or smooth curve) and edit it later.
 * Placing something inside a district fills in its district when it has none yet.
 */
type SideTab = 'npcs' | 'places' | 'districts';
type Layers = { npcs: boolean; places: boolean; districts: boolean };
type Draft = { id: string; points: Pt[]; smooth: boolean; original: { points: Pt[]; smooth: boolean } | null };

const LS = 'earthlings-tools:map-';

/** Settlements you can stamp onto a map, with their default colour and plot facts (from the plot sheet). */
const STAMPS: { kind: string; color: string; info: string }[] = [
  { kind: 'Town', color: '#5a4318', info: 'Town plot 160×160 m · supply 240 · land plots ×18, custom shop ×2, town hall' },
  { kind: 'Village', color: '#c5b412', info: 'Village plot 160×160 m · supply 365 · land plots ×12, custom shop, village hall' },
  { kind: 'Water Town', color: '#9fe3ea', info: 'Town plot on the water · same numbering as towns' },
  { kind: 'Cabin', color: '#8fbf74', info: 'Cabin plot 16×16 m · supply 100 · outside towns and villages, often remote' },
  { kind: 'City', color: '#ef7d3e', info: 'City (New Paris 25 km²) · city building plots 8×8 m · supply 1000' },
  { kind: 'Landmark', color: '#c294d6', info: 'Any other named place' },
];
const stampOf = (kind?: string) => STAMPS.find((x) => x.kind === kind);
const readLS = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(LS + k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeLS = (k: string, v: unknown) => {
  try {
    localStorage.setItem(LS + k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

export default function MapPage() {
  const defs = useDefinitions();
  const regions = defs.list('region');
  const [regionId, setRegionId] = useState<string | null>(() => localStorage.getItem(LS + 'region'));
  const region = defs.get(regionId) ?? regions[0];
  useEffect(() => {
    if (region) localStorage.setItem(LS + 'region', region.id);
  }, [region]);
  const [tab, setTab] = useState<SideTab>(() => readLS<SideTab>('tab', 'npcs'));
  const [layers, setLayers] = useState<Layers>(() => readLS<Layers>('layers', { npcs: true, places: true, districts: true }));
  const [opacity, setOpacity] = useState<number>(() => readLS<number>('opacity', 0.28));
  useEffect(() => writeLS('tab', tab), [tab]);
  useEffect(() => writeLS('layers', layers), [layers]);
  useEffect(() => writeLS('opacity', opacity), [opacity]);

  const [active, setActive] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [labels, setLabels] = useState(false);
  const [district, setDistrict] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useCanvasSize('npc-map', 250);

  const districts = defs.list('district').filter((d) => d.extra?.region === region?.id);
  const shapeOf = (d: Definition): Pt[] => (Array.isArray(d.extra?.shape?.points) ? d.extra.shape.points : []);
  const partsOf = (d: Definition): Pt[][] => [shapeOf(d), ...(Array.isArray(d.extra?.shape?.more) ? d.extra.shape.more : [])].filter((p) => p.length >= 3);
  const hits = (d: Definition, x: number, y: number) => partsOf(d).some((part) => insideArea(x, y, part));

  // What belongs to this level.
  const regionOfDistrict = (id?: string) => defs.get(id)?.extra?.region;
  const inRegion = (d: Definition): boolean => {
    if (!region) return false;
    const e = d.extra ?? {};
    if (e.pin?.region) return e.pin.region === region.id;
    if (d.list === 'building') {
      const loc = defs.get(e.location);
      return (loc ? loc.extra?.region === region.id || regionOfDistrict(loc.extra?.district) === region.id : false) || regionOfDistrict(e.district) === region.id;
    }
    return e.region === region.id || regionOfDistrict(e.district) === region.id;
  };
  const npcs = useMemo(() => defs.list('character').filter(inRegion), [defs, region]); // eslint-disable-line react-hooks/exhaustive-deps
  const places = useMemo(() => [...defs.list('building'), ...defs.list('location')].filter(inRegion), [defs, region]); // eslint-disable-line react-hooks/exhaustive-deps
  const districtOf = (d: Definition) => d.extra?.district || defs.get(d.extra?.location)?.extra?.district;
  const inFilter = (d: Definition) => !district || districtOf(d) === district;
  const isPlaced = (d: Definition) => d.extra?.pin?.region === region?.id;

  const setPin = (id: string, x: number, y: number) => {
    const c = defs.get(id);
    if (!c || !region) return;
    const extra: Record<string, unknown> = { ...c.extra, pin: { region: region.id, x, y } };
    if (c.list !== 'building' && !c.extra?.region) extra.region = region.id;
    // Inside a drawn district? Fill in the district when it is empty.
    if (!c.extra?.district) {
      const hit = districts.find((d) => hits(d, x, y));
      if (hit) extra.district = hit.id;
    }
    update('definitions', id, { extra });
  };
  const districtAt = (x: number, y: number) => districts.find((d) => hits(d, x, y))?.id ?? '';
  /** Stamp mode: every click on the map adds a new numbered settlement of that kind. */
  const addStamp = (kind: string, x: number, y: number) => {
    if (!region) return;
    // Towns and Water Towns share one numbering, like on the plot map.
    const group = kind === 'Town' || kind === 'Water Town' ? ['Town', 'Water Town'] : [kind];
    const same = defs.list('location').filter((l) => group.includes(l.extra?.kind) && inRegion(l));
    const n = same.reduce((m, l) => Math.max(m, parseInt(l.extra?.number, 10) || 0), 0) + 1;
    const all = defs.list('location');
    const id = newId();
    insert('definitions', {
      id,
      list: 'location',
      name: `${kind} ${n}`,
      color: stampOf(kind)?.color ?? '#c9c1b3',
      sort: (all[all.length - 1]?.sort ?? 0) + 1,
      extra: { kind, number: String(n), region: region.id, district: districtAt(x, y), notes: '', pin: { region: region.id, x, y } },
    });
    setActive(id);
  };
  const removePin = (id: string) => {
    const c = defs.get(id);
    if (c) update('definitions', id, { extra: { ...c.extra, pin: null } });
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

  // Drawing a district border.
  const startDraw = (d: Definition) => {
    const pts = shapeOf(d);
    const smooth = !!d.extra?.shape?.smooth;
    setDraft({ id: d.id, points: pts, smooth, original: pts.length ? { points: pts, smooth } : null });
    setPlacing(null);
    setActive(null);
    setTab('districts');
    setLayers((l) => ({ ...l, districts: true }));
  };
  const finishDraw = () => {
    if (!draft) return;
    const d = defs.get(draft.id);
    if (d) {
      const shape = draft.points.length >= 3 ? { ...(d.extra?.shape ?? {}), points: draft.points, smooth: draft.smooth } : null;
      update('definitions', d.id, { extra: { ...d.extra, shape } });
    }
    setDraft(null);
  };
  const cancelDraw = () => setDraft(null);
  const clearShape = (d: Definition) => {
    if (window.confirm(`Remove the border of ${d.name}?`)) update('definitions', d.id, { extra: { ...d.extra, shape: null } });
  };
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const undoKey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
      if (e.key === 'Backspace' || e.key === 'Delete' || undoKey) {
        e.preventDefault();
        e.stopPropagation();
        setDraft((d) => (d ? { ...d, points: d.points.slice(0, -1) } : d));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finishDraw();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelDraw();
      }
    };
    // Capture phase, so Ctrl+Z removes the last point instead of undoing the last saved change.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => {
    setDraft(null);
    setStamp(null);
  }, [region?.id]);
  useEffect(() => {
    if (!stamp && !placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStamp(null);
        setPlacing(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stamp, placing]);

  const exportBorders = () => {
    if (!region) return;
    const out = {
      region: region.name,
      map: region.extra?.map ?? '',
      note: 'Points are fractions (0–1) of the map image: x from the left, y from the top. smooth = draw a closed Catmull-Rom spline through the points.',
      districts: districts.map((d) => ({ name: d.name, color: d.color, smooth: !!d.extra?.shape?.smooth, points: shapeOf(d), islands: d.extra?.shape?.more ?? [] })),
      places: places.filter(isPlaced).map((p) => ({ name: p.name, kind: p.list === 'building' ? 'Building' : p.extra?.kind || 'Place', number: p.extra?.number || '', district: defs.get(districtOf(p))?.name ?? '', x: p.extra.pin.x, y: p.extra.pin.y })),
    };
    download(`map-${region.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, JSON.stringify(out, null, 2), 'application/json');
  };

  const kindOf = (p: Definition) => (p.list === 'building' ? 'Building' : p.extra?.kind || 'Place');
  const pinFor = (c: Definition, shape: PinShape): MapPin => ({
    id: c.id,
    x: c.extra.pin.x,
    y: c.extra.pin.y,
    color: c.color,
    label: c.name,
    shape,
    active: active === c.id,
    dim: (!!active && active !== c.id) || !inFilter(c) || (c.list !== 'character' && !!kindFilter && kindOf(c) !== kindFilter),
  });
  const pins: MapPin[] = [
    ...(layers.places ? places.filter(isPlaced).map((p) => pinFor(p, shapeFor(p))) : []),
    ...(layers.npcs ? npcs.filter(isPlaced).map((c) => pinFor(c, 'star')) : []),
  ];
  const areas: MapArea[] = layers.districts
    ? districts
        .filter((d) => shapeOf(d).length >= 3)
        .map((d) => ({ id: d.id, points: shapeOf(d), more: d.extra?.shape?.more, color: d.color, label: d.name, smooth: !!d.extra?.shape?.smooth, active: district === d.id, dim: !!district && district !== d.id }))
    : [];
  const drafting = draft ? defs.get(draft.id) : undefined;

  const activeDef = defs.get(active);
  const sub = (c: Definition) =>
    [c.list === 'character' ? c.extra?.role : c.list === 'building' ? 'Building' : c.extra?.kind && c.extra.kind !== 'Place' ? c.extra.kind : 'Location', defs.get(c.extra?.building)?.name, defs.get(c.extra?.location)?.name, defs.get(districtOf(c))?.name].filter(Boolean).join(' · ');

  const row = (c: Definition, shape: PinShape) => {
    const placed = isPlaced(c);
    return (
      <div key={c.id} className={'lib-entry' + (active === c.id ? ' active' : '')} style={{ cursor: placed ? 'pointer' : 'default', opacity: inFilter(c) ? 1 : 0.45, ...(active === c.id ? { borderColor: c.color } : {}) }} onClick={() => placed && setActive(active === c.id ? null : c.id)}>
        {shape === 'star' ? <NpcIcon name={c.name} color={c.color} image={c.extra?.image} size={24} /> : <PinIcon shape={shape} color={c.color} size={18} />}
        <span className="lib-text">
          <strong>{c.name}</strong>
          <span>{sub(c) || (shape === 'star' ? 'Character' : '')}</span>
        </span>
        {!placed && (
          <button type="button" className="btn small" disabled={!region?.extra?.map || !!draft} aria-pressed={placing === c.id} onClick={(e) => { e.stopPropagation(); setStamp(null); setPlacing(placing === c.id ? null : c.id); }}>
            Place
          </button>
        )}
      </div>
    );
  };

  const npcPlaced = npcs.filter(isPlaced), npcOpen = npcs.filter((c) => !isPlaced(c));
  const buildings = places.filter((p) => p.list === 'building');
  const locations = places.filter((p) => p.list === 'location' && (!kindFilter || kindOf(p) === kindFilter));
  const kindsHere = LOCATION_KINDS.filter((k) => places.some((p) => p.list === 'location' && kindOf(p) === k));
  const outline = districts.filter((d) => shapeOf(d).length >= 3).length;

  return (
    <div className="npcmap" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="page-head" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 30 }}>Map</h1>
        <span className="muted">NPCs, buildings, locations and district borders, per level</span>
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
          <div className="map-layers" role="group" aria-label="Show on the map">
            <button type="button" aria-pressed={layers.npcs} onClick={() => setLayers({ ...layers, npcs: !layers.npcs })}><PinIcon shape="star" color="#e0a05d" size={13} /> NPCs</button>
            <button type="button" aria-pressed={layers.places} onClick={() => setLayers({ ...layers, places: !layers.places })}><PinIcon shape="house" color="#c9c1b3" size={13} /> Places</button>
            <button type="button" aria-pressed={layers.districts} onClick={() => setLayers({ ...layers, districts: !layers.districts })}><span style={{ width: 11, height: 11, borderRadius: 3, background: '#6fb3d666', border: '1.5px solid #6fb3d6' }} /> Districts</button>
          </div>
          {layers.districts && (
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              Fill
              <input type="range" min={0} max={0.7} step={0.02} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="District fill strength" style={{ width: 80 }} />
            </label>
          )}
          {districts.length > 0 && (
            <span className="select-wrap" style={{ width: 180 }}>
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
                  pins={pins}
                  areas={areas}
                  areaOpacity={opacity}
                  edit={draft && drafting ? { id: draft.id, points: draft.points, color: drafting.color, smooth: draft.smooth, onChange: (points) => setDraft({ ...draft, points }) } : null}
                  onPinClick={(id) => setActive(active === id ? null : id)}
                  onMove={setPin}
                  onAreaClick={(id) => setDistrict(district === id ? null : id)}
                  onPlace={
                    stamp
                      ? (x, y) => addStamp(stamp, x, y)
                      : placing
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
            {stamp && (
              <div className="warn-box" style={{ alignSelf: 'flex-start' }}>
                <PinIcon shape={shapeFor({ list: 'location', extra: { kind: stamp } })} color={stampOf(stamp)?.color ?? '#ccc'} size={14} /> Click the map to add <strong>{stamp}s</strong> — each click adds the next number. Esc to stop.{' '}
                <button type="button" className="btn ghost small" onClick={() => setStamp(null)}>
                  Done
                </button>
              </div>
            )}
            {placing && (
              <div className="warn-box" style={{ alignSelf: 'flex-start' }}>
                Click on the map to place <strong>{defs.get(placing)?.name}</strong>.{' '}
                <button type="button" className="btn ghost small" onClick={() => setPlacing(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          <aside className="panel side" aria-label="On this level">
            {draft && drafting ? (
              <div className="draw-box" style={{ borderColor: drafting.color + '99' }}>
                <strong style={{ fontFamily: "'Space Grotesk', sans-serif", color: drafting.color }}>Border of {drafting.name}</strong>
                <p>
                  <b>Click</b> the map to add points around the district. <b>Drag</b> a point to move it, drag a small dot between two points to add one there, <b>right-click</b> a point to delete it. Backspace / Ctrl+Z removes the last point, Enter saves.
                </p>
                <span className="muted" style={{ fontSize: 12 }}>{draft.points.length} points{draft.points.length < 3 ? ' — needs at least 3' : ''}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn small" aria-pressed={draft.smooth} onClick={() => setDraft({ ...draft, smooth: !draft.smooth })}>
                    {draft.smooth ? '✓ ' : ''}Smooth curve
                  </button>
                  <button type="button" className="btn small ghost" disabled={!draft.points.length} onClick={() => setDraft({ ...draft, points: draft.points.slice(0, -1) })}>
                    Undo point
                  </button>
                  <button type="button" className="btn small ghost" disabled={!draft.points.length} onClick={() => setDraft({ ...draft, points: [] })}>
                    Start over
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn small primary" disabled={draft.points.length > 0 && draft.points.length < 3} onClick={finishDraw}>
                    Save border
                  </button>
                  <button type="button" className="btn small ghost" onClick={cancelDraw}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              activeDef && (
                <div className="npc-card" style={{ borderColor: activeDef.color + '88', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {activeDef.list === 'character' ? (
                      activeDef.extra?.image ? <img className="npc-portrait" style={{ width: 72, height: 90, borderColor: activeDef.color }} src={activeDef.extra.image} alt={'Portrait of ' + activeDef.name} /> : <NpcIcon name={activeDef.name} color={activeDef.color} size={52} />
                    ) : (
                      <PinIcon shape={shapeFor(activeDef)} color={activeDef.color} size={40} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                      <strong style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, color: activeDef.color }}>{activeDef.name}</strong>
                      <span className="muted" style={{ fontSize: 12 }}>{sub(activeDef)}</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Close" onClick={() => setActive(null)}>
                      <Icon name="x" />
                    </button>
                  </div>
                  {(activeDef.extra?.looks || activeDef.extra?.notes) && <p className="npc-text">{activeDef.extra.looks || activeDef.extra.notes}</p>}
                  {activeDef.list === 'building' && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {defs.list('character').filter((c) => c.extra?.building === activeDef.id).map((c) => c.name).join(', ') || 'No NPCs in this building yet.'}
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {activeDef.list === 'character' && (
                      <button type="button" className="btn small" onClick={() => setProfile(activeDef.id)}>
                        Open profile
                      </button>
                    )}
                    <button type="button" className="btn small ghost" onClick={() => setPlacing(activeDef.id)}>
                      Move
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => { removePin(activeDef.id); setActive(null); }}>
                      Remove from map
                    </button>
                  </div>
                </div>
              )
            )}

            <div className="side-tabs" role="tablist" aria-label="Lists">
              {([['npcs', `NPCs ${npcs.length}`], ['places', `Places ${places.length}`], ['districts', `Districts ${districts.length}`]] as const).map(([k, t]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {t}
                </button>
              ))}
            </div>

            {tab === 'npcs' && (
              <>
                <span className="section-label">ON THIS MAP ({npcPlaced.length})</span>
                {npcPlaced.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No NPCs placed on this level yet.</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{npcPlaced.map((c) => row(c, 'star'))}</div>
                {npcOpen.length > 0 && (
                  <>
                    <span className="section-label" style={{ marginTop: 4 }}>NOT PLACED YET ({npcOpen.length})</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{npcOpen.map((c) => row(c, 'star'))}</div>
                  </>
                )}
              </>
            )}

            {tab === 'places' && (
              <>
                <span className="section-label">ADD ON THE MAP</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {STAMPS.map((st) => (
                    <button key={st.kind} type="button" className="btn small" title={st.info} disabled={!region?.extra?.map || !!draft} aria-pressed={stamp === st.kind} onClick={() => { setPlacing(null); setStamp(stamp === st.kind ? null : st.kind); setLayers((l) => ({ ...l, places: true })); }}>
                      <PinIcon shape={shapeFor({ list: 'location', extra: { kind: st.kind } })} color={st.color} size={13} /> {st.kind}
                    </button>
                  ))}
                </div>
                {kindsHere.length > 1 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }} role="group" aria-label="Show only">
                    <button type="button" className="btn small ghost" aria-pressed={!kindFilter} onClick={() => setKindFilter(null)}>All</button>
                    {kindsHere.map((k) => (
                      <button key={k} type="button" className="btn small ghost" aria-pressed={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? null : k)}>
                        {k} {places.filter((p) => p.list === 'location' && kindOf(p) === k).length}
                      </button>
                    ))}
                  </div>
                )}
                <span className="section-label">BUILDINGS ({buildings.filter(isPlaced).length}/{buildings.length} placed)</span>
                {buildings.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No buildings on this level. Add them under Definitions → Buildings with a location or district here.</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{[...buildings.filter(isPlaced), ...buildings.filter((b) => !isPlaced(b))].map((b) => row(b, shapeFor(b)))}</div>
                <span className="section-label" style={{ marginTop: 4 }}>{kindFilter ? kindFilter.toUpperCase() + 'S' : 'LOCATIONS'} ({locations.filter(isPlaced).length}/{locations.length} placed)</span>
                {locations.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No locations on this level.</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{[...locations.filter(isPlaced), ...locations.filter((b) => !isPlaced(b))].map((b) => row(b, shapeFor(b)))}</div>
                <span className="section-label" style={{ marginTop: 6 }}>PLOT SIZES</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
                  {STAMPS.slice(0, 5).map((st) => (
                    <span key={st.kind} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <span style={{ marginTop: 1 }}><PinIcon shape={shapeFor({ list: 'location', extra: { kind: st.kind } })} color={st.color} size={12} /></span>
                      {st.info}
                    </span>
                  ))}
                  <span>Land plot 32×32 m · supply 8600 · inside a town or village. Gamers plot (dugout) · supply 9205.</span>
                </div>
              </>
            )}

            {tab === 'districts' && (
              <>
                <span className="section-label">DISTRICT BORDERS ({outline}/{districts.length} drawn)</span>
                {districts.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No districts for this level. Add them under Definitions → Districts.</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {districts.map((d) => {
                    const has = shapeOf(d).length >= 3;
                    return (
                      <div key={d.id} className={'lib-entry' + (district === d.id ? ' active' : '')} style={{ cursor: 'pointer', ...(district === d.id ? { borderColor: d.color } : {}) }} onClick={() => setDistrict(district === d.id ? null : d.id)}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, background: has ? d.color + '66' : 'transparent', border: `2px ${has ? 'solid' : 'dashed'} ${d.color}` }} />
                        <span className="lib-text">
                          <strong>{d.name}</strong>
                          <span>{has ? `${shapeOf(d).length} points${d.extra?.shape?.smooth ? ' · smooth' : ''}` : 'No border yet'}</span>
                        </span>
                        <button type="button" className="btn small" disabled={!region?.extra?.map || !!draft} onClick={(e) => { e.stopPropagation(); startDraw(d); }}>
                          {has ? 'Edit' : 'Draw'}
                        </button>
                        {has && (
                          <button type="button" className="icon-btn" aria-label={'Remove the border of ' + d.name} title="Remove border" disabled={!!draft} onClick={(e) => { e.stopPropagation(); clearShape(d); }}>
                            <Icon name="x" size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>The fill uses each district’s colour (change it under Definitions → Districts). Click an area on the map to focus that district.</span>
                {region && (
                  <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={exportBorders}>
                    <Icon name="download" size={14} /> Export borders + places (JSON)
                  </button>
                )}
              </>
            )}

            {!draft && tab !== 'districts' && (
              <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                Stars are NPCs, houses are buildings; locations show by type (■ town, ● village, drop = water town, ▲ cabin, ◆ other). Click one to see it, drag it to move. Placing something inside a drawn district fills in its district.
              </span>
            )}
          </aside>
        </div>
      </div>
      {profile && defs.get(profile) && <CharacterProfile key={profile} c={defs.get(profile)!} onClose={() => setProfile(null)} onOpen={setProfile} />}
    </div>
  );
}
