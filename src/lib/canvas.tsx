import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

// ---------- full screen (shared by every page, so it stays on when you switch tabs) ----------
let fullScreen = false;
const fullListeners = new Set<() => void>();
export function setFullScreen(on: boolean) {
  fullScreen = on;
  document.body.classList.toggle('no-scroll', on);
  fullListeners.forEach((fn) => fn());
}
export function useFullScreen(): [boolean, (on: boolean) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    fullListeners.add(fn);
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key === 'Escape' && fullScreen && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) setFullScreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      fullListeners.delete(fn);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return [fullScreen, setFullScreen];
}

/*
 * Canvas size for the graph pages:
 *  - drag the grip under the canvas to make it taller or shorter (remembered per page)
 *  - Full screen fills the browser window with the toolbar, canvas and side panel (Esc to leave)
 */
export function useCanvasSize(key: string, offset = 240) {
  const storeKey = 'earthlings-tools:canvas-h:' + key;
  const [height, setHeight] = useState<number | null>(() => Number(localStorage.getItem(storeKey)) || null);
  const [max, setMax] = useFullScreen();
  const wrapRef = useRef<HTMLDivElement>(null);
  // In full screen the canvas fills the window below the menu and toolbar.
  const [fullH, setFullH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!max) return;
    const fit = () => {
      const flow = wrapRef.current?.querySelector('.flow-wrap') as HTMLElement | null;
      if (!flow) return;
      setFullH(Math.max(320, Math.floor(window.innerHeight - flow.getBoundingClientRect().top - 14)));
    };
    window.scrollTo(0, 0);
    fit();
    const t = setTimeout(fit, 60);
    window.addEventListener('resize', fit);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', fit);
    };
  }, [max]);

  const startDrag = (e: React.PointerEvent) => {
    const flow = wrapRef.current?.querySelector('.flow-wrap') as HTMLElement | null;
    if (!flow) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = flow.getBoundingClientRect().height;
    let last = startH;
    const move = (ev: PointerEvent) => {
      last = Math.max(360, Math.round(startH + ev.clientY - startY));
      setHeight(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      localStorage.setItem(storeKey, String(last));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudge = (dy: number) => {
    const flow = wrapRef.current?.querySelector('.flow-wrap') as HTMLElement | null;
    const h = Math.max(360, Math.round((height ?? flow?.getBoundingClientRect().height ?? 600) + dy));
    setHeight(h);
    localStorage.setItem(storeKey, String(h));
  };
  const reset = () => {
    setHeight(null);
    localStorage.removeItem(storeKey);
  };

  // Default height leaves room for the page header and toolbar, so the grip stays on screen.
  const style = { ['--canvas-h' as string]: max ? (fullH ? fullH + 'px' : 'calc(100vh - 160px)') : height ? height + 'px' : `max(480px, calc(100vh - ${offset}px))` } as CSSProperties;
  const grip = max ? null : (
    <div
      className="canvas-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Drag to resize the canvas"
      tabIndex={0}
      title="Drag to make the canvas taller or shorter · double-click to reset"
      onPointerDown={startDrag}
      onDoubleClick={reset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') nudge(40);
        if (e.key === 'ArrowUp') nudge(-40);
      }}
    >
      <span />
    </div>
  );
  const maxButton = max ? null : (
    <button type="button" className="btn small" onClick={() => setMax(!max)} aria-pressed={max} title={max ? 'Leave full screen (Esc)' : 'Fill the window with the canvas'}>
      {max ? '⤡ Exit full screen' : '⤢ Full screen'}
    </button>
  );
  return { wrapRef, style, max, grip, maxButton, className: max ? 'canvas-max' : '' };
}
