import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { MODE, onDbError, supabase, useTable } from './lib/db';
import { loadStarterData, seedDemoIfEmpty } from './lib/seed';
import type { Definition } from './lib/types';
import { Icon } from './components/ui';
import TasksPage from './pages/Tasks';
import QuestsPage from './pages/Quests';
import QuestMapPage from './pages/QuestMap';
import ItemsPage from './pages/Items';
import DefinitionsPage from './pages/Definitions';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(MODE === 'demo');
  const [error, setError] = useState<string | null>(null);

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
    <div className="shell">
      <header className="topbar">
        <span className="brand">EARTHLINGS</span>
        <nav className="nav" aria-label="Sections">
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/quests">Quests</NavLink>
          <NavLink to="/quest-map">Quest map</NavLink>
          <NavLink to="/items">Items</NavLink>
          <NavLink to="/definitions">Definitions</NavLink>
        </nav>
        <div className="spacer" />
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

      <Routes>
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/quests" element={<QuestsPage />} />
        <Route path="/quest-map" element={<QuestMapPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/definitions" element={<DefinitionsPage />} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Routes>

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
