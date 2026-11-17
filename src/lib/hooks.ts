import { useMemo } from 'react';
import { useTable } from './db';
import type { Definition, ListKey, Member } from './types';

export function useDefinitions() {
  const { rows, loaded } = useTable<Definition>('definitions');
  return useMemo(() => {
    const byId = new Map(rows.map((d) => [d.id, d]));
    const lists = new Map<ListKey, Definition[]>();
    for (const d of rows) {
      const arr = lists.get(d.list) ?? [];
      arr.push(d);
      lists.set(d.list, arr);
    }
    lists.forEach((arr) => arr.sort((a, b) => a.sort - b.sort));
    return {
      loaded,
      byId,
      list: (key: ListKey) => lists.get(key) ?? [],
      get: (id: string | null | undefined) => (id ? byId.get(id) : undefined),
    };
  }, [rows, loaded]);
}

export function useMembers() {
  const { rows } = useTable<Member>('members');
  return useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.sort - b.sort);
    const byId = new Map(sorted.map((m) => [m.id, m]));
    return { list: sorted, get: (id: string | null | undefined) => (id ? byId.get(id) : undefined) };
  }, [rows]);
}

export const SWATCHES = ['#c9c1b3', '#8fbf74', '#6fb3d6', '#c294d6', '#e6bd7d', '#e0805d', '#7a82c4', '#c4b04e', '#8a6f4e', '#5f8fa8'];

/** Picks black or near-white text for a coloured badge background. */
export function textOn(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#15130f';
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? '#15130f' : '#f4efe4';
}

export function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
