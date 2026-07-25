import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { COMMANDS, type CommandCategory } from './commands';
import { bindingsFor, comboFromEvent, commandsForCombo, prettyCombo, type Keymap } from './keymap';

const CATEGORIES: CommandCategory[] = ['File', 'Edit', 'Playback', 'Timeline', 'Library', 'Arrange', 'Selection', 'View'];

// The canonical shortcut manager: every command in the catalogue, its current binding, and inline
// rebinding. "Record" captures the next key combo; conflicts are flagged; per-command and global
// reset restore the catalogue defaults. It edits the same keymap the dispatcher reads.
export function ShortcutManager({ map, onRebind, onResetOne, onResetAll, onClose }: {
  map: Keymap;
  onRebind: (cmdId: string, combos: string[]) => void;
  onResetOne: (cmdId: string) => void;
  onResetAll: () => void;
  onClose: () => void;
}) {
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // While recording, capture the next real key combo and assign it to the command.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // wait for the real key
      onRebind(recording, [comboFromEvent(e)]);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onRebind]);

  const q = filter.trim().toLowerCase();

  return createPortal(
    <div className="fixed inset-0 z-[9500] bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div className="w-[640px] max-h-[82vh] flex flex-col rounded-lg border border-slate-700 bg-slate-950 text-xs" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3 border-b border-slate-800">
          <span className="text-sm font-semibold flex-1">Keyboard Shortcuts</span>
          <input className="im-input w-48" placeholder="Filter…" value={filter} onChange={e => setFilter(e.target.value)} />
          <button className="im-btn" onClick={onResetAll} title="Restore all defaults">Reset all</button>
          <button className="im-btn" onClick={onClose}>Close</button>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {CATEGORIES.map(cat => {
            const cmds = COMMANDS.filter(c => c.category === cat && (!q || c.label.toLowerCase().includes(q) || c.id.includes(q)));
            if (!cmds.length) return null;
            return (
              <div key={cat} className="mb-3">
                <div className="px-1 py-1 text-[10px] uppercase tracking-wide text-slate-500">{cat}</div>
                <div className="rounded border border-slate-800 divide-y divide-slate-900">
                  {cmds.map(cmd => {
                    const combos = bindingsFor(cmd, map);
                    return (
                      <div key={cmd.id} className="flex items-center gap-2 px-2 py-1.5">
                        <span className="flex-1 text-slate-200">{cmd.label}</span>
                        <div className="flex items-center gap-1">
                          {recording === cmd.id ? (
                            <span className="px-2 py-0.5 rounded bg-rose-700/40 border border-rose-500 text-rose-200 animate-pulse">Press keys… (Esc cancels)</span>
                          ) : combos.length ? combos.map(c => {
                            const clash = commandsForCombo(c, map).filter(id => id !== cmd.id);
                            return (
                              <kbd key={c} className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${clash.length ? 'border-amber-500 text-amber-300' : 'border-slate-600 text-slate-300 bg-slate-800'}`}
                                title={clash.length ? `Also bound to: ${clash.join(', ')}` : undefined}>
                                {prettyCombo(c)}
                              </kbd>
                            );
                          }) : <span className="text-slate-600">unbound</span>}
                        </div>
                        <button className="im-btn" onClick={() => setRecording(cmd.id)}>Record</button>
                        {map[cmd.id] && <button className="im-btn" title="Reset to default" onClick={() => onResetOne(cmd.id)}>↺</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
