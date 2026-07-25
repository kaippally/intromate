import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECTS_DIR } from './paths.js';

const VERSIONS_DIR = join(PROJECTS_DIR, '.versions');
const MAX_VERSIONS = 15;

export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'intro';
}

function file(id: string): string {
  const p = resolve(PROJECTS_DIR, `${slug(id)}.json`);
  if (!p.startsWith(PROJECTS_DIR)) throw new Error('bad id');
  return p;
}

export interface ProjectMeta { id: string; name: string; updatedAt: number; durationMs: number }

export function list(): ProjectMeta[] {
  return readdirSync(PROJECTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const id = f.replace(/\.json$/, '');
      try {
        const p = JSON.parse(readFileSync(join(PROJECTS_DIR, f), 'utf8'));
        return { id, name: p.name ?? id, durationMs: p.durationMs ?? 0, updatedAt: statSync(join(PROJECTS_DIR, f)).mtimeMs };
      } catch { return null; }
    })
    .filter((x): x is ProjectMeta => !!x)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function read(id: string): any | null {
  const p = file(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function write(id: string, project: any): any {
  const p = file(id);
  if (existsSync(p)) snapshot(id, readFileSync(p, 'utf8'));
  const next = { ...project, id: slug(id) };
  writeFileSync(p, JSON.stringify(next, null, 2));
  return next;
}

export function remove(id: string): boolean {
  const p = file(id);
  if (!existsSync(p)) return false;
  snapshot(id, readFileSync(p, 'utf8'));
  unlinkSync(p);
  return true;
}

export function rename(id: string, newName: string): any | null {
  const project = read(id);
  if (!project) return null;
  const nextId = slug(newName);
  const next = { ...project, id: nextId, name: newName };
  writeFileSync(file(nextId), JSON.stringify(next, null, 2));
  if (nextId !== slug(id)) unlinkSync(file(id));
  return next;
}

function snapshot(id: string, json: string) {
  const dir = join(VERSIONS_DIR, slug(id));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${Date.now()}.json`), json);
  const olds = readdirSync(dir).sort();
  for (const f of olds.slice(0, Math.max(0, olds.length - MAX_VERSIONS))) unlinkSync(join(dir, f));
}

export function versions(id: string): { ts: number }[] {
  const dir = join(VERSIONS_DIR, slug(id));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(f => ({ ts: Number(f.replace(/\.json$/, '')) })).sort((a, b) => b.ts - a.ts);
}

export function readVersion(id: string, ts: number): any | null {
  const p = join(VERSIONS_DIR, slug(id), `${ts}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function duplicate(id: string, newName: string): any | null {
  const project = read(id);
  if (!project) return null;
  return write(slug(newName), { ...project, name: newName });
}
