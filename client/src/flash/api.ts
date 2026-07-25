import type { FlashDoc } from './model';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface DocMeta { id: string; name: string; fps: number; width: number; height: number; updatedAt: number }

export const listDocs = () => j<DocMeta[]>('/api/doc');
export const loadDoc = (id: string) => j<FlashDoc>(`/api/doc/${id}`);
export const createDoc = (name: string, opts?: { fps?: number; width?: number; height?: number }) =>
  j<FlashDoc>('/api/doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...opts }) });
export const saveDoc = (doc: FlashDoc) =>
  j<FlashDoc>(`/api/doc/${doc.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
export const deleteDoc = (id: string) => j<{ ok: boolean }>(`/api/doc/${id}`, { method: 'DELETE' });

export type { FlashDoc };
