import { useEffect, useRef, useState } from 'react';

/*
 * A level map you can zoom (wheel / buttons) and pan (drag the map).
 * Click to place a pin (when onPlace is given). Pins are stars at fractions (0–1) of the image size,
 * so they stay in place at any zoom. Pins can be dragged when onMove is given.
 */
export type MapPin = { id: string; x: number; y: number; color: string; label: string; active?: boolean; dim?: boolean };

export function Star({ color, size = 18, outline = '#15130f' }: { color: string; size?: number; outline?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.2l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17l-6 3.3 1.3-6.6L2.4 9.1l6.7-.8z" fill={color} stroke={outline} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function MapView(props: {
  image: string;
  pins: MapPin[];
  height?: number | string;
  onPlace?: (x: number, y: number) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onPinClick?: (id: string) => void;
  starSize?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState(1);
  const drag = useRef<{ kind: 'pan' | 'pin'; id?: string; sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const [dragPin, setDragPin] = useState<{ id: string; x: number; y: number } | null>(null);

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
  const toFrac = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    const x = (clientX - r.left - pan.x) / (natural!.w * scale);
    const y = (clientY - r.top - pan.y) / (natural!.h * scale);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const b = box.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx - r.left;
    const py = cy === undefined ? r.height / 2 : cy - r.top;
    const next = Math.min(12, Math.max(1, zoom * factor));
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
  const onMoveEv = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'pan') setPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy });
    else if (d.id && natural) setDragPin({ id: d.id, ...toFrac(e.clientX, e.clientY) });
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !natural) return;
    if (d.kind === 'pin' && d.id) {
      if (d.moved && dragPin) props.onMove?.(d.id, dragPin.x, dragPin.y);
      else props.onPinClick?.(d.id);
      setDragPin(null);
      return;
    }
    if (!d.moved) {
      if (d.id) props.onPinClick?.(d.id);
      else if (props.onPlace) {
        const p = toFrac(e.clientX, e.clientY);
        props.onPlace(p.x, p.y);
      }
    }
  };

  const size = props.starSize ?? 20;
  return (
    <div className="mapview" style={{ height: props.height ?? 360, cursor: props.onPlace ? 'crosshair' : 'grab' }} ref={box} onPointerDown={(e) => onDown(e)} onPointerMove={onMoveEv} onPointerUp={onUp}>
      <div className="mapview-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <img
          ref={imgRef}
          src={props.image}
          alt="Level map"
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={natural ? { width: natural.w * scale, height: natural.h * scale } : { maxWidth: '100%' }}
        />
        {natural &&
          props.pins.map((p) => {
            const at = dragPin?.id === p.id ? dragPin : p;
            return (
              <button
                key={p.id}
                type="button"
                className={'map-pin' + (p.active ? ' active' : '') + (p.dim ? ' dim' : '')}
                style={{ left: at.x * natural.w * scale, top: at.y * natural.h * scale, cursor: props.onMove ? 'move' : 'pointer' }}
                onPointerDown={(e) => onDown(e, p.id)}
                title={p.label}
                aria-label={p.label}
              >
                <Star color={p.color} size={p.active ? size * 1.4 : size} outline={p.active ? '#fff3d6' : '#15130f'} />
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
