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

// ---------- undo / redo ----------
/*
 * Every insert / update / remove is recorded with what it replaced, so it can be undone.
 * Writes that happen close together (or inside group()) become one undo step,
 * e.g. deleting 20 nodes and their links is undone in one go.
 */
type Op =
  | { kind: 'insert'; t: Table; rows: Row[] }
  | { kind: 'update'; t: Table; id: string; patch: Record<string, any>; prev: Record<string, any> | null }
  | { kind: 'remove'; t: Table; rows: Row[]; ids: string[] };
type Step = { label: string; ops: Op[]; last: number };

const undoStack: Step[] = [];
const redoStack: Step[] = [];
let open: Step | null = null;
let groupDepth = 0;
let replaying = false;
const historyListeners = new Set<() => void>();
const MERGE_MS = 500;

const NOUN: Record<Table, [string, string]> = {
  members: ['team member', 'team members'],
  definitions: ['list entry', 'list entries'],
  task_groups: ['theme group', 'theme groups'],
  tasks: ['task', 'tasks'],
  items: ['item', 'items'],
  quest_chains: ['quest chain', 'quest chains'],
  quest_nodes: ['node', 'nodes'],
  quest_edges: ['link', 'links'],
};
const noun = (t: Table, n: number) => (n === 1 ? NOUN[t][0] : `${n} ${NOUN[t][1]}`);

function stepLabel(ops: Op[]): string {
  // Name the step after its most important change: chains > nodes/items/tasks > links.
  const weight = (o: Op) => (o.t === 'quest_edges' ? 1 : o.t === 'quest_chains' || o.t === 'task_groups' ? 3 : 2) + (o.kind === 'update' ? 0 : 1);
  const main = [...ops].sort((a, b) => weight(b) - weight(a))[0];
  if (!main) return '';
  const sameKind = ops.filter((o) => o.t === main.t && o.kind === main.kind);
  const count = sameKind.reduce((n, o) => n + (o.kind === 'update' ? 1 : o.rows.length), 0);
  if (main.kind === 'insert') return 'Add ' + noun(main.t, count);
  if (main.kind === 'remove') return 'Delete ' + noun(main.t, count);
  const moved = sameKind.every((o) => o.kind === 'update' && Object.keys(o.patch).every((k) => k === 'x' || k === 'y'));
  return (moved ? 'Move ' : 'Edit ') + noun(main.t, count);
}

function emitHistory() {
  historyListeners.forEach((fn) => fn());
}

function record(op: Op) {
  if (replaying) return;
  redoStack.length = 0;
  const now = Date.now();
  if (!open || (groupDepth === 0 && now - open.last > MERGE_MS)) {
    open = { label: '', ops: [], last: now };
    undoStack.push(open);
    if (undoStack.length > 200) undoStack.shift();
  }
  open.ops.push(op);
  open.last = now;
  open.label = stepLabel(open.ops);
  emitHistory();
}

/** Runs several writes as one undo step. */
export async function group<T>(fn: () => Promise<T> | T): Promise<T> {
  if (groupDepth === 0) open = null; // always start a fresh step
  groupDepth++;
  try {
    return await fn();
  } finally {
    groupDepth--;
    if (groupDepth === 0) open = null;
  }
}

export function useHistory() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    historyListeners.add(fn);
    return () => {
      historyListeners.delete(fn);
    };
  }, []);
  const u = undoStack[undoStack.length - 1];
  const r = redoStack[redoStack.length - 1];
  return { canUndo: !!u, canRedo: !!r, undoLabel: u?.label ?? '', redoLabel: r?.label ?? '', lastStep: u };
}

async function applyOps(ops: Op[], direction: 'undo' | 'redo') {
  replaying = true;
  try {
    const list = direction === 'undo' ? [...ops].reverse() : ops;
    for (const o of list) {
      if (direction === 'undo') {
        if (o.kind === 'insert') await rawRemove(o.t, o.rows.map((r) => r.id));
        else if (o.kind === 'remove') await rawUpsert(o.t, o.rows);
        else if (o.prev) await rawUpdate(o.t, o.id, o.prev);
      } else {
        if (o.kind === 'insert') await rawUpsert(o.t, o.rows);
        else if (o.kind === 'remove') await rawRemove(o.t, o.ids);
        else await rawUpdate(o.t, o.id, o.patch);
      }
    }
  } finally {
    replaying = false;
  }
}

/** Undoes the last step. Returns its label, or null when there's nothing to undo. */
export async function undo(): Promise<string | null> {
  const step = undoStack.pop();
  if (!step) return null;
  open = null;
  redoStack.push(step);
  emitHistory();
  await applyOps(step.ops, 'undo');
  return step.label;
}

export async function redo(): Promise<string | null> {
  const step = redoStack.pop();
  if (!step) return null;
  open = null;
  undoStack.push(step);
  emitHistory();
  await applyOps(step.ops, 'redo');
  return step.label;
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// ---------- writes ----------
export function newId(): string {
  return crypto.randomUUID();
}

export async function insert<T extends Row>(t: Table, rows: T | T[]): Promise<void> {
  const list = Array.isArray(rows) ? rows : [rows];
  record({ kind: 'insert', t, rows: clone(list) });
  await rawUpsert(t, list, true);
}

export async function update(t: Table, id: string, patch: Record<string, any>): Promise<void> {
  const before = (cache[t] ?? []).find((r) => r.id === id);
  const prev = before ? Object.fromEntries(Object.keys(patch).map((k) => [k, clone(before[k] ?? null)])) : null;
  record({ kind: 'update', t, id, patch: clone(patch), prev });
  await rawUpdate(t, id, patch);
}

export async function remove(t: Table, ids: string | string[]): Promise<void> {
  const list = Array.isArray(ids) ? ids : [ids];
  const rows = (cache[t] ?? []).filter((r) => list.includes(r.id));
  record({ kind: 'remove', t, rows: clone(rows), ids: list });
  await rawRemove(t, list);
}

async function rawUpsert(t: Table, list: Row[], plainInsert = false): Promise<void> {
  const ids = new Set(list.map((r) => r.id));
  cache[t] = [...(cache[t] ?? []).filter((r) => !ids.has(r.id)), ...list];
  emit(t);
  if (!supabase) return lsWrite(t, cache[t]!);
  const { error } = plainInsert ? await supabase.from(t).insert(list) : await supabase.from(t).upsert(list);
  if (error) {
    reportError(error);
    fetchTable(t);
  }
}

async function rawUpdate(t: Table, id: string, patch: Record<string, any>): Promise<void> {
  cache[t] = (cache[t] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
  emit(t);
  if (!supabase) return lsWrite(t, cache[t]!);
  const { error } = await supabase.from(t).update(patch).eq('id', id);
  if (error) {
    reportError(error);
    fetchTable(t);
  }
}

async function rawRemove(t: Table, list: string[]): Promise<void> {
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
