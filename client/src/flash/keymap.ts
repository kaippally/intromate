import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMANDS, COMMAND_BY_ID, type CommandDef } from './commands';

// The keymap: which key combos fire which command. Defaults come from the catalogue; the user's
// overrides live here and persist. This is the ONE place a key event becomes a command, and the
// Shortcut Manager is just an editor over this map.

const STORE_KEY = 'flash:keymap';

// A binding string is a normalised combo: modifiers in fixed order + the key. Examples:
// 'Ctrl+Shift+Z', 'F6', 'Space', 'Alt+ArrowLeft', ','.
export type Keymap = Record<string, string[]>; // commandId -> combos (overrides the default)

export function loadKeymap(): Keymap {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
export function saveKeymap(m: Keymap) { localStorage.setItem(STORE_KEY, JSON.stringify(m)); }

/** Effective combos for a command: user override if present, else the catalogue default. */
export function bindingsFor(cmd: CommandDef, map: Keymap): string[] {
  return map[cmd.id] ?? cmd.defaultKeys;
}

// Normalise a KeyboardEvent into a canonical combo string.
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normKey(e.key, e.code));
  return parts.join('+');
}

function normKey(key: string, code: string): string {
  if (key === ' ') return 'Space';
  if (/^F\d{1,2}$/.test(key)) return key;
  if (key === 'Escape') return 'Esc';
  if (key.length === 1) return key.length === 1 && /[a-z]/.test(key) ? key.toUpperCase() : key;
  // Arrows, Home, End, Delete, Backspace, etc. come through as-is.
  if (key === 'Del') return 'Delete';
  void code;
  return key;
}

/** Pretty label for a combo on this platform. */
export function prettyCombo(combo: string): string {
  return combo.replace('Ctrl', navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl')
    .replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓');
}

// Build a reverse index combo→commandId from the effective map (used by the dispatcher).
function buildIndex(map: Keymap): Map<string, string> {
  const idx = new Map<string, string>();
  for (const cmd of COMMANDS) for (const combo of bindingsFor(cmd, map)) if (!idx.has(combo)) idx.set(combo, cmd.id);
  return idx;
}

/** Every command currently bound to `combo` (for conflict detection in the editor). */
export function commandsForCombo(combo: string, map: Keymap): string[] {
  return COMMANDS.filter(c => bindingsFor(c, map).includes(combo)).map(c => c.id);
}

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
// Commands that fire even while typing in a field (destructive/global ones do not).
const ALLOW_IN_FIELD = new Set(['edit.undo', 'edit.redo', 'file.save', 'view.shortcuts']);

/**
 * Wire the keymap to the document. `handlers` maps command ids to functions; a key event is
 * normalised, looked up, and the matching handler runs. Returns the live map + a setter so the
 * Shortcut Manager edits the same source the dispatcher reads.
 */
export function useKeymap(handlers: Record<string, () => void>) {
  const [map, setMap] = useState<Keymap>(loadKeymap);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const idxRef = useRef(buildIndex(map));
  idxRef.current = buildIndex(map);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      const id = idxRef.current.get(combo);
      if (!id) return;
      const inField = EDITABLE.has((e.target as HTMLElement)?.tagName);
      if (inField && !ALLOW_IN_FIELD.has(id)) return;
      const fn = handlersRef.current[id];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const update = useCallback((next: Keymap) => { setMap(next); saveKeymap(next); }, []);
  const rebind = useCallback((cmdId: string, combos: string[]) => {
    setMap(prev => { const next = { ...prev, [cmdId]: combos }; saveKeymap(next); return next; });
  }, []);
  const resetOne = useCallback((cmdId: string) => {
    setMap(prev => { const next = { ...prev }; delete next[cmdId]; saveKeymap(next); return next; });
  }, []);
  const resetAll = useCallback(() => { setMap({}); saveKeymap({}); }, []);

  return { map, update, rebind, resetOne, resetAll };
}

export { COMMANDS, COMMAND_BY_ID };
