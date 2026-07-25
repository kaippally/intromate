import { useCallback, useMemo, useReducer } from 'react';

// Undo/redo for the whole project document. Every edit in the app goes through `commit`, so
// there is exactly one place history is recorded — nothing can bypass it.
//
// Coalescing: a slider or a chip drag fires dozens of updates a second. Passing a `key`
// (e.g. "el:3:xPos") merges consecutive edits that share it inside COALESCE_MS into the entry
// already on the stack, so one drag costs one undo step, not eighty.

export const HISTORY_LIMIT = 100;
const COALESCE_MS = 700;

interface State<T> { past: T[]; present: T; future: T[]; key: string | null; at: number }

type Action<T> =
  | { type: 'commit'; value: T | ((prev: T) => T); key?: string; now: number; limit: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T };

function reducer<T>(s: State<T>, a: Action<T>): State<T> {
  switch (a.type) {
    case 'commit': {
      // The updater is applied here, against the live present — so a long drag whose handler
      // captured an older render still writes onto current state.
      const value = typeof a.value === 'function' ? (a.value as (p: T) => T)(s.present) : a.value;
      if (value === s.present) return s;
      // Same knob, still moving → replace the present without deepening the stack.
      const merge = !!a.key && a.key === s.key && a.now - s.at < COALESCE_MS;
      return {
        past: merge ? s.past : [...s.past, s.present].slice(-a.limit),
        present: value,
        future: [],
        key: a.key ?? null,
        at: a.now,
      };
    }
    case 'undo': {
      const prev = s.past[s.past.length - 1];
      if (prev === undefined) return s;
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future].slice(0, HISTORY_LIMIT), key: null, at: 0 };
    }
    case 'redo': {
      const next = s.future[0];
      if (next === undefined) return s;
      return { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: next, future: s.future.slice(1), key: null, at: 0 };
    }
    case 'reset':
      return { past: [], present: a.value, future: [], key: null, at: 0 };
  }
}

export function useHistory<T>(initial: T, limit = HISTORY_LIMIT) {
  const [s, dispatch] = useReducer(reducer as (s: State<T>, a: Action<T>) => State<T>, {
    past: [], present: initial, future: [], key: null, at: 0,
  });

  // Stable across renders: a mousemove handler captured at drag start still commits correctly.
  const commit = useCallback((next: T | ((prev: T) => T), key?: string) => {
    dispatch({ type: 'commit', value: next, key, now: Date.now(), limit });
  }, [limit]);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((value: T) => dispatch({ type: 'reset', value }), []);

  return useMemo(() => ({
    present: s.present,
    commit, undo, redo, reset,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    undoDepth: s.past.length,
    redoDepth: s.future.length,
  }), [s.present, s.past.length, s.future.length, commit, undo, redo, reset]);
}
