import { useEffect, useRef, useState } from 'react';

/*
 * A level map you can zoom (wheel / buttons) and pan (drag the map).
 * Click to place a pin (when onPlace is given). Pins sit at fractions (0–1) of the image size,
 * so they stay in place at any zoom. Pins can be dragged when onMove is given.
 *
 * Areas are coloured shapes (district borders) drawn over the map. One area can be edited at a time:
 * click the map to add a point, drag a point to move it, drag the small dot between two points to add one there,
 * right-click (or Alt-click) a point to delete it. With `smooth` the border is drawn as a curve through the points.
 */
export type MapPin = { id: string; x: number; y: number; color: string; label: string; active?: boolean; dim?: boolean; shape?: PinShape };
export type PinShape = 'star' | 'house' | 'dot' | 'square' | 'circle' | 'drop' | 'triangle' | 'city';
export type Pt = [number, number];
/** `more` holds extra pieces of the same area (islands); they are shown but only `points` is edited. */
export type MapArea = { id: string; points: Pt[]; more?: Pt[][]; color: string; label: string; smooth?: boolean; active?: boolean; dim?: boolean };
export type AreaEdit = { id: string; points: Pt[]; color: string; smooth?: boolean; onChange: (points: Pt[]) => void };

export function Star({ color, size = 18, outline = '#15130f' }: { color: string; size?: number; outline?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.2l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17l-6 3.3 1.3-6.6L2.4 9.1l6.7-.8z" fill={color} stroke={outline} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function House({ color, size = 18, outline = '#15130f' }: { color: string; size?: number; outline?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11.2L12 3.5l9 7.7V21H14.5v-6h-5v6H3z" fill={color} stroke={outline} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function Dot({ color, size = 18, outline = '#15130f' }: { color: string; size?: number; outline?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" fill={color} stroke={outline} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const SHAPES: Partial<Record<PinShape, string>> = {
  square: 'M5 5h14v14H5z',
  circle: 'M12 4.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15z',
  drop: 'M12 2.8C15.5 8 18.5 11 18.5 14.6a6.5 6.5 0 0 1-13 0C5.5 11 8.5 8 12 2.8z',
  triangle: 'M12 3.5l9 16H3z',
  city: 'M3 21V9l4-2v3l5-3v3l5-3v14zM8 14h2v2H8zm6 0h2v2h-2z',
};

export function PinIcon({ shape, ...p }: { shape?: PinShape; color: string; size?: number; outline?: string }) {
  if (shape === 'house') return <House {...p} />;
  if (shape === 'dot') return <Dot {...p} />;
  const d = shape ? SHAPES[shape] : undefined;
  if (!d) return <Star {...p} />;
  const size = p.size ?? 18;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill={p.color} stroke={p.outline ?? '#15130f'} strokeWidth="1.8" strokeLinejoin="round" fillRule="evenodd" />
    </svg>
  );
}

/** Map marker for a definition: NPC star, building house, location by its kind. */
export function shapeFor(d: { list: string; extra?: Record<string, any> }): PinShape {
  if (d.list === 'character') return 'star';
  if (d.list === 'building') return 'house';
  switch (d.extra?.kind) {
    case 'Town': return 'square';
    case 'Village': return 'circle';
    case 'Water Town': return 'drop';
    case 'Cabin': return 'triangle';
    case 'City': return 'city';
    default: return 'dot';
  }
}

/** SVG path through the points (pixels). Closed; a Catmull-Rom curve when smooth. */
export function areaPath(pts: Pt[], smooth?: boolean): string {
  if (pts.length < 2) return '';
  const f = (n: number) => n.toFixed(1);
  if (!smooth || pts.length < 3) return 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join(' L') + ' Z';
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + ' Z';
}

/** Is the point inside the polygon (all in map fractions)? */
export function insideArea(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export function MapView(props: {
  image: string;
  pins: MapPin[];
  areas?: MapArea[];
  edit?: AreaEdit | null;
  areaOpacity?: number;
  height?: number | string;
  onPlace?: (x: number, y: number) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onPinClick?: (id: string) => void;
  onAreaClick?: (id: string) => void;
  starSize?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState(1);
  const drag = useRef<{ kind: 'pan' | 'pin' | 'vertex'; id?: string; index?: number; sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const [dragPin, setDragPin] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragPts, setDragPts] = useState<Pt[] | null>(null);
  const edit = props.edit ?? null;

  // Fit the whole map into the box.
  const refit = () => {
    const b = box.current;
    if (!b || !natural) return;
    const f = Math.min(b.clientWidth / natural.w, b.clientHeight / natural.h);
    setFit(f);
    setZoom(1);
    setPan({ x: (b.clientWidth - natural.w * f) / 2, y: (b.clientHeight - natural.h * f) / 2 });
  };
  useEffect(refit, [natural]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const ro = new ResizeObserver(() => refit());
    ro.observe(b);
    return () => ro.disconnect();
  }, [natural]); // eslint-disable-line react-hooks/exhaustive-deps

  const scale = fit * zoom;
  const W = natural ? natural.w * scale : 0;
  const H = natural ? natural.h * scale : 0;
  const toFrac = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    const x = (clientX - r.left - pan.x) / (natural!.w * scale);
    const y = (clientY - r.top - pan.y) / (natural!.h * scale);
    return { x: round(Math.min(1, Math.max(0, x))), y: round(Math.min(1, Math.max(0, y))) };
  };
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const b = box.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx - r.left;
    const py = cy === undefined ? r.height / 2 : cy - r.top;
    const next = Math.min(16, Math.max(1, zoom * factor));
    const k = next / zoom;
    setPan({ x: px - (px - pan.x) * k, y: py - (py - pan.y) * k });
    setZoom(next);
  };

  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
    };
    b.addEventListener('wheel', onWheel, { passive: false });
    return () => b.removeEventListener('wheel', onWheel);
  });

  const onDown = (e: React.PointerEvent, pinId?: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: pinId && props.onMove ? 'pin' : 'pan', id: pinId, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false };
  };
  const removePoint = (i: number) => {
    if (!edit) return;
    edit.onChange(edit.points.filter((_, k) => k !== i));
  };
  const onVertexDown = (e: React.PointerEvent, index: number, insert: boolean) => {
    if (!edit) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      if (!insert) removePoint(index);
      return;
    }
    if (e.button !== 0) return;
    let pts = edit.points;
    if (insert) {
      const a = pts[index], b = pts[(index + 1) % pts.length];
      pts = [...pts.slice(0, index + 1), [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)] as Pt, ...pts.slice(index + 1)];
      index += 1;
    }
    (box.current as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragPts(pts);
    drag.current = { kind: 'vertex', index, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: insert };
  };
  const onMoveEv = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'pan') setPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy });
    else if (d.kind === 'vertex' && natural && dragPts && d.index !== undefined) {
      const p = toFrac(e.clientX, e.clientY);
      setDragPts(dragPts.map((q, k) => (k === d.index ? [p.x, p.y] : q)));
    } else if (d.id && natural) setDragPin({ id: d.id, ...toFrac(e.clientX, e.clientY) });
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !natural) return;
    if (d.kind === 'vertex') {
      if (dragPts && d.moved) edit?.onChange(dragPts);
      setDragPts(null);
      return;
    }
    if (d.kind === 'pin' && d.id) {
      if (d.moved && dragPin) props.onMove?.(d.id, dragPin.x, dragPin.y);
      else props.onPinClick?.(d.id);
      setDragPin(null);
      return;
    }
    if (!d.moved) {
      if (d.id) props.onPinClick?.(d.id);
      else if (edit) {
        const p = toFrac(e.clientX, e.clientY);
        edit.onChange([...edit.points, [p.x, p.y]]);
      } else if (props.onPlace) {
        const p = toFrac(e.clientX, e.clientY);
        props.onPlace(p.x, p.y);
      } else if (props.onAreaClick && props.areas) {
        const p = toFrac(e.clientX, e.clientY);
        // The smallest area under the click wins (so nested shapes can be picked).
        const hit = props.areas
          .filter((a) => a.points.length >= 3 && [a.points, ...(a.more ?? [])].some((part) => insideArea(p.x, p.y, part)))
          .sort((a, b) => spread(a.points) - spread(b.points))[0];
        if (hit) props.onAreaClick(hit.id);
      }
    }
  };

  const px = (pts: Pt[]): Pt[] => pts.map((p) => [p[0] * W, p[1] * H]);
  const editPts = dragPts ?? edit?.points ?? [];
  const opacity = props.areaOpacity ?? 0.28;
  const size = props.starSize ?? 20;
  const areas = (props.areas ?? []).filter((a) => a.id !== edit?.id && a.points.length >= 3);
  const cursor = edit || props.onPlace ? 'crosshair' : 'grab';

  return (
    <div className="mapview" style={{ height: props.height ?? 360, cursor }} ref={box} onPointerDown={(e) => onDown(e)} onPointerMove={onMoveEv} onPointerUp={onUp} onContextMenu={(e) => edit && e.preventDefault()}>
      <div className="mapview-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <img
          src={props.image}
          alt="Level map"
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={natural ? { width: W, height: H } : { maxWidth: '100%' }}
        />
        {natural && (areas.length > 0 || edit) && (
          <svg className="map-areas" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {areas.map((a) => {
              const d = [a.points, ...(a.more ?? [])].map((part) => areaPath(px(part), a.smooth)).join(' ');
              return (
                <path
                  key={a.id}
                  d={d}
                  fill={a.color}
                  fillOpacity={a.dim ? opacity * 0.35 : a.active ? Math.min(0.7, opacity + 0.2) : opacity}
                  stroke={a.color}
                  strokeOpacity={a.dim ? 0.35 : 1}
                  strokeWidth={a.active ? 3 : 1.8}
                  strokeLinejoin="round"
                />
              );
            })}
            {areas.map((a) => {
              const c = centre(px(a.points));
              return (
                <text key={'t' + a.id} x={c[0]} y={c[1]} className={'map-area-label' + (a.dim ? ' dim' : '')} textAnchor="middle" dominantBaseline="middle">
                  {a.label}
                </text>
              );
            })}
            {edit && editPts.length > 0 && (
              <g>
                {editPts.length >= 2 && (
                  <path d={areaPath(px(editPts), edit.smooth)} fill={edit.color} fillOpacity={editPts.length >= 3 ? Math.min(0.6, opacity + 0.1) : 0} stroke={edit.color} strokeWidth={2.5} strokeDasharray={editPts.length < 3 ? '6 4' : undefined} strokeLinejoin="round" />
                )}
                {edit.smooth && editPts.length >= 3 && <path d={areaPath(px(editPts), false)} fill="none" stroke="#fff3d6" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 4" />}
                {editPts.length >= 2 &&
                  px(editPts).map((p, i) => {
                    if (editPts.length < 3 && i === editPts.length - 1) return null;
                    const q = px(editPts)[(i + 1) % editPts.length];
                    return <circle key={'m' + i} className="map-mid" cx={(p[0] + q[0]) / 2} cy={(p[1] + q[1]) / 2} r={4.5} onPointerDown={(e) => onVertexDown(e, i, true)} />;
                  })}
                {px(editPts).map((p, i) => (
                  <circle key={'v' + i} className={'map-vertex' + (i === 0 ? ' first' : '')} cx={p[0]} cy={p[1]} r={6.5} stroke={edit.color} onPointerDown={(e) => onVertexDown(e, i, false)} onContextMenu={(e) => e.preventDefault()}>
                    <title>Point {i + 1} — drag to move, right-click to delete</title>
                  </circle>
                ))}
              </g>
            )}
          </svg>
        )}
        {natural &&
          props.pins.map((p) => {
            const at = dragPin?.id === p.id ? dragPin : p;
            return (
              <button
                key={p.id}
                type="button"
                className={'map-pin' + (p.active ? ' active' : '') + (p.dim ? ' dim' : '') + (edit ? ' passive' : '')}
                style={{ left: at.x * W, top: at.y * H, cursor: props.onMove ? 'move' : 'pointer' }}
                onPointerDown={(e) => onDown(e, p.id)}
                title={p.label}
                aria-label={p.label}
              >
                <PinIcon shape={p.shape} color={p.color} size={(p.active ? 1.4 : 1) * size * (p.shape === 'dot' || p.shape === 'triangle' || p.shape === 'circle' || p.shape === 'square' || p.shape === 'drop' ? 0.75 : 1)} outline={p.active ? '#fff3d6' : '#15130f'} />
                <span className="map-pin-label">{p.label}</span>
              </button>
            );
          })}
      </div>
      <div className="mapview-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn" onClick={() => zoomAt(1.4)} aria-label="Zoom in">+</button>
        <button type="button" className="icon-btn" onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out">−</button>
        <button type="button" className="icon-btn" onClick={refit} aria-label="Fit the whole map" title="Fit">⤢</button>
      </div>
    </div>
  );
}

function spread(pts: Pt[]) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

/** Area-weighted centre of a polygon (falls back to the average of the points). */
function centre(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f;
    cx += (pts[j][0] + pts[i][0]) * f;
    cy += (pts[j][1] + pts[i][1]) * f;
  }
  if (Math.abs(a) < 1e-6) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}
