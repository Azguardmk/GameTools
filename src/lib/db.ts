import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { TABLES, type Table } from './types';

/*
 * One small data layer for every screen.
 * - Shared mode: Supabase (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY). Changes sync live.
 * - Demo mode: no Supabase configured → data lives in this browser's localStorage only.
 * Every write updates a local cache first so the UI feels instant, then persists.
 */

// The team's Supabase project. The publishable key is meant to be public:
// access is limited to signed-in users by the row-level security policies in supabase/schema.sql.
// Override with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, or set VITE_DEMO=1 to run without a database.
const DEFAULT_URL = 'https://enaxshmiobwahcltftyi.supabase.co';
const DEFAULT_KEY = 'sb_publishable_LmQjemJOtUQV8ouJwQ2cbA_AmESxaZz';

const demo = import.meta.env.VITE_DEMO === '1';
const url = demo ? undefined : ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL);
const key = demo ? undefined : ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_KEY);

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const MODE: 'shared' | 'demo' = supabase ? 'shared' : 'demo';

type Row = { id: string } & Record<string, any>;

const cache: Partial<Record<Table, Row[]>> = {};
const loaded = new Set<Table>();
const listeners: Partial<Record<Table, Set<() => void>>> = {};
const errorListeners = new Set<(msg: string) => void>();

function emit(t: Table) {
  listeners[t]?.forEach((fn) => fn());
}

export function onDbError(fn: (msg: string) => void) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

function reportError(err: unknown) {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as any).message) : String(err);
  console.error(err);
  errorListeners.forEach((fn) => fn(msg));
}

// ---------- demo-mode storage ----------
const LS_PREFIX = 'earthlings-tools:';

function lsRead(t: Table): Row[] {
  try {
    const raw = localStorage.getItem(LS_PREFIX + t);
    return raw ? (JSON.parse(raw) as Row[]) : [];
  } catch {
    return [];
  }
}

function lsWrite(t: Table, rows: Row[]) {
  try {
    localStorage.setItem(LS_PREFIX + t, JSON.stringify(rows));
  } catch (e) {
    reportError(e);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(LS_PREFIX)) return;
    const t = e.key.slice(LS_PREFIX.length) as Table;
    if (!TABLES.includes(t)) return;
    cache[t] = lsRead(t);
    emit(t);
  });
}

// ---------- loading & live updates ----------
const subscribed = new Set<Table>();

async function fetchTable(t: Table) {
  if (!supabase) {
    cache[t] = lsRead(t);
  } else {
    const { data, error } = await supabase.from(t).select('*');
    if (error) {
      reportError(error);
      return;
    }
    cache[t] = data as Row[];
  }
  loaded.add(t);
  emit(t);
}

function ensureSubscribed(t: Table) {
  if (!supabase || subscribed.has(t)) return;
  subscribed.add(t);
  let timer: ReturnType<typeof setTimeout> | undefined;
  supabase
    .channel('live-' + t)
    .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
      // Batch bursts of changes into one refetch.
      clearTimeout(timer);
      timer = setTimeout(() => fetchTable(t), 150);
    })
    .subscribe();
}

export function useTable<T>(t: Table): { rows: T[]; loaded: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    (listeners[t] ??= new Set()).add(fn);
    if (!loaded.has(t)) fetchTable(t);
    ensureSubscribed(t);
    return () => {
      listeners[t]?.delete(fn);
    };
  }, [t]);
  return { rows: (cache[t] ?? []) as T[], loaded: loaded.has(t) };
}

export function snapshot<T>(t: Table): T[] {
  return (cache[t] ?? []) as T[];
}

// ---------- writes ----------
export function newId(): string {
  return crypto.randomUUID();
}

export async function insert<T extends Row>(t: Table, rows: T | T[]): Promise<void> {
  const list = Array.isArray(rows) ? rows : [rows];
  cache[t] = [...(cache[t] ?? []), ...list];
  emit(t);
  if (!supabase) return lsWrite(t, cache[t]!);
  const { error } = await supabase.from(t).insert(list);
  if (error) {
    reportError(error);
    fetchTable(t);
  }
}

export async function update(t: Table, id: string, patch: Record<string, any>): Promise<void> {
  cache[t] = (cache[t] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
  emit(t);
  if (!supabase) return lsWrite(t, cache[t]!);
  const { error } = await supabase.from(t).update(patch).eq('id', id);
  if (error) {
    reportError(error);
    fetchTable(t);
  }
}

export async function remove(t: Table, ids: string | string[]): Promise<void> {
  const list = Array.isArray(ids) ? ids : [ids];
  cache[t] = (cache[t] ?? []).filter((r) => !list.includes(r.id));
  emit(t);
  if (!supabase) return lsWrite(t, cache[t]!);
  const { error } = await supabase.from(t).delete().in('id', list);
  if (error) {
    reportError(error);
    fetchTable(t);
  }
}

/** Loads every table (used by the starter-data check and exports). */
export async function loadAll(): Promise<void> {
  await Promise.all(TABLES.filter((t) => !loaded.has(t)).map(fetchTable));
}
