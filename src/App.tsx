import { Component, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { MODE, onDbError, redo, supabase, undo, useHistory, useTable } from './lib/db';
import { loadStarterData, seedDemoIfEmpty } from './lib/seed';
import type { Definition } from './lib/types';
import { Icon } from './components/ui';
import { useFullScreen } from './lib/canvas';
import TasksPage from './pages/Tasks';
import QuestsPage from './pages/Quests';
import QuestMapPage from './pages/QuestMap';
import ItemsPage from './pages/Items';
import DefinitionsPage, { NpcsPage } from './pages/Definitions';
import MapPage from './pages/MapPage';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(MODE === 'demo');
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useFullScreen();

  useEffect(() => onDbError((m) => setError(m)) as () => void, []);

  useEffect(() => {
    if (MODE === 'demo') {
      seedDemoIfEmpty();
      return;
    }
    supabase!.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase!.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!authReady) return null;
  if (MODE === 'shared' && !session) return <Login />;

  return (
    <div className={'shell' + (full ? ' full' : '')}>
      <header className="topbar">
        <span className="brand">EARTHLINGS</span>
        <nav className="nav" aria-label="Sections">
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/quests">Quests</NavLink>
          <NavLink to="/quest-map">Quest map</NavLink>
          <NavLink to="/map">Map</NavLink>
          <NavLink to="/items">Items</NavLink>
          <NavLink to="/definitions">Definitions</NavLink>
          <NavLink to="/npcs">NPCs</NavLink>
        </nav>
        <div className="spacer" />
        {full && (
          <button type="button" className="btn small" onClick={() => setFull(false)} title="Leave full screen (Esc)">
            ⤡ Exit full screen
          </button>
        )}
        <HistoryButtons />
        <div className="mode">
          {MODE === 'demo' ? (
            <span className="pill demo" title="No database connected. Changes are saved only in this browser.">Demo mode · saved in this browser only</span>
          ) : (
            <>
              <span className="pill shared">Shared</span>
              <span>{session?.user.email}</span>
              <button className="btn small" type="button" onClick={() => supabase!.auth.signOut()}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      {MODE === 'shared' && <StarterDataPrompt />}

      <PageGuard>
      <Routes>
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/quests" element={<QuestsPage />} />
        <Route path="/quest-map" element={<QuestMapPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/definitions" element={<DefinitionsPage />} />
        <Route path="/npcs" element={<NpcsPage />} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Routes>
      </PageGuard>

      {error && (
        <div className="toast" role="alert">
          <Icon name="warn" />
          <span style={{ flex: 1 }}>Couldn't save: {error}</span>
          <button className="icon-btn" type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
    </div>
  );
}

function StarterDataPrompt() {
  const { rows, loaded } = useTable<Definition>('definitions');
  const [busy, setBusy] = useState(false);
  if (!loaded || rows.length > 0) return null;
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <span style={{ flex: 1, minWidth: 240 }}>
        The database is empty. Load the starter lists (categories, rarities, quest types…) and the sample tasks, items and quests? You can edit or delete
        everything afterwards.
      </span>
      <button
        className="btn primary"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await loadStarterData();
          setBusy(false);
        }}
      >
        {busy ? 'Loading…' : 'Load starter data'}
      </button>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  return (
    <form
      className="panel center-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('sending');
        const { error } = await supabase!.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname, shouldCreateUser: false },
        });
        if (error) {
          setState('error');
          setMsg(error.message);
        } else setState('sent');
      }}
    >
      <span className="brand">EARTHLINGS</span>
      <h1 style={{ fontSize: 26 }}>Sign in</h1>
      <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
        Enter the email you were invited with. We'll send you a sign-in link.
      </p>
      <label className="field">
        <span className="field-label">Email</span>
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <button className="btn primary" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
      </button>
      {state === 'sent' && <p style={{ margin: 0, color: '#b2d69e' }}>Check your inbox for the link.</p>}
      {state === 'error' && <p style={{ margin: 0, color: 'var(--danger)' }}>{msg}</p>}
    </form>
  );
}

/** Undo / Redo buttons, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, and a short "Undo" offer after deleting. */
function HistoryButtons() {
  const h = useHistory();
  const [note, setNote] = useState<string | null>(null);
  const [offer, setOffer] = useState<string | null>(null);

  const doUndo = async () => {
    const label = await undo();
    if (label) setNote('Undone: ' + label);
    setOffer(null);
  };
  const doRedo = async () => {
    const label = await redo();
    if (label) setNote('Redone: ' + label);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      // Text fields keep their own undo for typing.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      if (k === 'y' || e.shiftKey) doRedo();
      else doUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // After something is deleted, offer a one-click Undo for a few seconds.
  const lastLabel = h.undoLabel;
  useEffect(() => {
    if (lastLabel.startsWith('Delete')) {
      setOffer(lastLabel);
      const t = setTimeout(() => setOffer(null), 8000);
      return () => clearTimeout(t);
    }
  }, [lastLabel, h.lastStep]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);

  return (
    <>
      <div className="history" role="group" aria-label="Undo and redo">
        <button type="button" className="icon-btn" disabled={!h.canUndo} onClick={doUndo} aria-label={h.canUndo ? 'Undo: ' + h.undoLabel : 'Nothing to undo'} title={h.canUndo ? `Undo: ${h.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" disabled={!h.canRedo} onClick={doRedo} aria-label={h.canRedo ? 'Redo: ' + h.redoLabel : 'Nothing to redo'} title={h.canRedo ? `Redo: ${h.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}>
          <Icon name="redo" />
        </button>
      </div>
      {(offer || note) && (
        <div className="undo-toast" role="status">
          <span>{offer ? offer : note}</span>
          {offer && (
            <button type="button" className="btn small primary" onClick={doUndo}>
              <Icon name="undo" size={14} /> Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Shows what went wrong instead of a blank page, and resets when you switch page. */
function PageGuard({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return <ErrorBoundary key={loc.pathname}>{children}</ErrorBoundary>;
}
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
        <strong style={{ fontSize: 18 }}>This page hit an error</strong>
        <span className="muted">Your data is safe. Try reloading; if it keeps happening, send this message to Filip:</span>
        <code style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--danger)' }}>{String(this.state.error?.message ?? this.state.error)}</code>
        <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
