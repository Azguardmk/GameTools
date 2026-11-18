import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Definition, Member } from '../lib/types';
import { SWATCHES, textOn } from '../lib/hooks';

/** Shows the full text in a wrapping bubble when a field is too narrow for it. */
function useOverflowTip(text: string) {
  const [tip, setTip] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    clearTimeout(timer.current);
    if (!el || !text || document.activeElement === el) return;
    const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    if (!cut) return;
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      const above = r.bottom + 160 > window.innerHeight;
      setTip({ top: above ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 440)), above });
    }, 250);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setTip(null);
  };
  useEffect(() => {
    if (!tip) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [tip]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const bubble =
    tip &&
    createPortal(
      <div className="tooltip" role="tooltip" style={{ top: tip.top, left: tip.left, transform: tip.above ? 'translateY(-100%)' : undefined }}>
        {text}
      </div>,
      document.body,
    );
  return { show, hide, bubble };
}

/** Text input that keeps its own value while typing and saves on blur / Enter. */
export function TextField(props: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  rows?: number;
  list?: string;
  className?: string;
  style?: CSSProperties;
  type?: string;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(props.value);
  const focused = useRef(false);
  const tip = useOverflowTip(v);
  useEffect(() => {
    if (!focused.current) setV(props.value);
  }, [props.value]);
  const commit = () => {
    focused.current = false;
    if (v !== props.value) props.onCommit(v);
  };
  const common = {
    value: v,
    placeholder: props.placeholder,
    'aria-label': props.label,
    className: props.className ?? 'input',
    style: props.style,
    autoFocus: props.autoFocus,
    onFocus: () => {
      focused.current = true;
      tip.hide();
    },
    onBlur: commit,
    onMouseEnter: (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => tip.show(e.currentTarget),
    onMouseLeave: tip.hide,
  };
  if (props.multiline) {
    return (
      <>
        <textarea {...common} rows={props.rows ?? 3} onChange={(e) => setV(e.target.value)} />
        {tip.bubble}
      </>
    );
  }
  return (
    <>
      <input
        {...common}
        type={props.type ?? 'text'}
      list={props.list}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setV(props.value);
            focused.current = false;
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {tip.bubble}
    </>
  );
}

/** Native select fed by a definitions list. */
export function DefSelect(props: {
  options: Definition[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  label: string;
  allowEmpty?: boolean;
  className?: string;
}) {
  const current = props.options.find((o) => o.id === props.value);
  return (
    <span className={'select-wrap ' + (props.className ?? '')}>
      <span className="dot" style={{ background: current?.color ?? 'transparent', borderColor: current ? 'transparent' : '#5a544a' }} />
      <select aria-label={props.label} value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || null)}>
        {(props.allowEmpty || !current) && <option value="">—</option>}
        {props.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </span>
  );
}

export function MemberBadge({ m, size = 26 }: { m: Member; size?: number }) {
  return (
    <span className="badge" title={m.name} style={{ width: size, height: size, background: m.color, color: textOn(m.color), fontSize: size * 0.38 }}>
      {m.initials}
    </span>
  );
}

export function Tag({ def, fallback }: { def?: Definition; fallback?: string }) {
  if (!def) return <span className="tag muted">{fallback ?? '—'}</span>;
  return (
    <span className="tag" style={{ color: def.color, background: def.color + '26' }}>
      {def.name}
    </span>
  );
}

export function SwatchPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={'swatch' + (c === value ? ' on' : '')}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
      </label>
    </div>
  );
}

export function Icon({ name, size = 16 }: { name: 'plus' | 'copy' | 'undo' | 'redo' | 'trash' | 'warn' | 'download' | 'chevron' | 'up' | 'down' | 'search' | 'link' | 'x'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
    redo: <path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </>
    ),
    trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
    warn: (
      <>
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17v.5" />
      </>
    ),
    download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
    chevron: <path d="M9 6l6 6-6 6" />,
    up: <path d="M6 15l6-6 6 6" />,
    down: <path d="M6 9l6 6 6-6" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </>
    ),
    link: (
      <>
        <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </>
    ),
    x: <path d="M6 6l12 12M18 6L6 18" />,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

/** Two-letter monogram for an item without an icon image. */
export function monogram(name: string) {
  const w = name.replace(/^Blueprint:\s*/i, '').split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w[0][0] + (w[1] ? w[1][0] : w[0][1] ?? '')).toUpperCase();
}

/** Small square icon for an item: its image, or a monogram tinted by category and edged by rarity. */
export function ItemIcon({ name, icon, color, edge, size = 22 }: { name: string; icon?: string | null; color?: string; edge?: string; size?: number }) {
  return (
    <span
      className="item-icon"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.4)), background: (color ?? '#3a362f') + '40', borderColor: edge ?? color ?? '#3a362f' }}
    >
      {icon ? <img src={icon} alt="" /> : monogram(name)}
    </span>
  );
}

/** Round initials badge for a character / NPC. */
export function NpcIcon({ name, color, size = 24, image }: { name: string; color?: string; size?: number; image?: string | null }) {
  if (image)
    return (
      <span className="npc-icon" aria-hidden="true" style={{ width: size, height: size, border: `2px solid ${color ?? '#5a544a'}`, overflow: 'hidden' }}>
        <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </span>
    );
  const w = name.split(/\s+/).filter(Boolean);
  const ini = ((w[0]?.[0] ?? '?') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase();
  return (
    <span className="npc-icon" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: color ?? '#5a544a', color: textOn(color ?? '#5a544a') }}>
      {ini}
    </span>
  );
}
