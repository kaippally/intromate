// The single catalogue of every user-facing action. A feature IS a Command: it has a stable id, a
// label, a category, and a default key binding. The Shortcut Manager edits the keymap that points
// keys at these ids; the app supplies a handler per id. Nothing dispatches an action except through
// this registry, so the command list, the menus and the shortcut editor can never drift apart.

export type CommandCategory = 'File' | 'Edit' | 'Playback' | 'Timeline' | 'Library' | 'Arrange' | 'View' | 'Selection';

export interface CommandDef {
  id: string;
  label: string;
  category: CommandCategory;
  defaultKeys: string[];   // e.g. ['Ctrl+Z'], ['F6'], ['Space']; [] = no default binding
  when?: 'always' | 'stage' | 'timeline'; // context hint (advisory; handlers gate as needed)
}

// The canonical catalogue. Add a feature here + a handler in FlashApp and it is automatically
// listable, bindable and rebindable.
export const COMMANDS: CommandDef[] = [
  // File
  { id: 'file.new',        label: 'New Document',        category: 'File', defaultKeys: ['Ctrl+Alt+N'] },
  { id: 'file.save',       label: 'Save',                category: 'File', defaultKeys: ['Ctrl+S'] },
  { id: 'file.export',     label: 'Render / Export…',    category: 'File', defaultKeys: ['Ctrl+Alt+E'] },

  // Edit
  { id: 'edit.undo',       label: 'Undo',                category: 'Edit', defaultKeys: ['Ctrl+Z'] },
  { id: 'edit.redo',       label: 'Redo',                category: 'Edit', defaultKeys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'edit.duplicate',  label: 'Duplicate Selection', category: 'Edit', defaultKeys: ['Ctrl+D'] },
  { id: 'edit.delete',     label: 'Delete Selection',    category: 'Edit', defaultKeys: ['Delete', 'Backspace'] },

  // Playback
  { id: 'play.toggle',     label: 'Play / Pause',        category: 'Playback', defaultKeys: ['Space'] },
  { id: 'play.stop',       label: 'Stop / Rewind',       category: 'Playback', defaultKeys: ['Shift+Space'] },
  { id: 'play.first',      label: 'Go to Start',         category: 'Playback', defaultKeys: ['Ctrl+Home', 'Home'] },
  { id: 'play.last',       label: 'Go to End',           category: 'Playback', defaultKeys: ['Ctrl+End', 'End'] },
  { id: 'play.next',       label: 'Next Frame',          category: 'Playback', defaultKeys: ['.', 'ArrowRight'] },
  { id: 'play.prev',       label: 'Previous Frame',      category: 'Playback', defaultKeys: [',', 'ArrowLeft'] },
  { id: 'play.nextKf',     label: 'Next Keyframe',       category: 'Playback', defaultKeys: ['Ctrl+ArrowRight'] },
  { id: 'play.prevKf',     label: 'Previous Keyframe',   category: 'Playback', defaultKeys: ['Ctrl+ArrowLeft'] },

  // Timeline (Flash-native F-keys)
  { id: 'obj.newTimeline', label: 'New Object Timeline (nest here)', category: 'Timeline', defaultKeys: ['Ctrl+Shift+K'] },
  { id: 'obj.convert',     label: 'Selection → Object Timeline',    category: 'Timeline', defaultKeys: ['Ctrl+Shift+F8'] },
  { id: 'tl.keyframe',     label: 'Insert Keyframe',     category: 'Timeline', defaultKeys: ['Ctrl+Alt+K', 'F6'] },
  { id: 'tl.blankKey',     label: 'Insert Blank Keyframe', category: 'Timeline', defaultKeys: ['F7'] },
  { id: 'tl.frame',        label: 'Insert Frame',        category: 'Timeline', defaultKeys: ['F5'] },
  { id: 'tl.removeFrame',  label: 'Remove Frame',        category: 'Timeline', defaultKeys: ['Shift+F5'] },
  { id: 'tl.clearKey',     label: 'Clear Keyframe',      category: 'Timeline', defaultKeys: ['Shift+F6'] },
  { id: 'tl.motionTween',  label: 'Create Motion Tween', category: 'Timeline', defaultKeys: ['Ctrl+Alt+M'] },
  { id: 'tl.addLayer',     label: 'New Layer',           category: 'Timeline', defaultKeys: ['Ctrl+Shift+L'] },
  { id: 'tl.deleteLayer',  label: 'Delete Layer',        category: 'Timeline', defaultKeys: ['Ctrl+Shift+Delete'] },

  // Library
  { id: 'lib.newSymbol',   label: 'New Symbol…',         category: 'Library', defaultKeys: ['Ctrl+F8'] },
  { id: 'lib.convert',     label: 'Convert to Symbol',   category: 'Library', defaultKeys: ['F8'] },
  { id: 'lib.import',      label: 'Import Media…',        category: 'Library', defaultKeys: ['Ctrl+R'] },
  { id: 'lib.duplicate',   label: 'Duplicate Symbol',    category: 'Library', defaultKeys: [] },
  { id: 'lib.edit',        label: 'Edit Symbol (open tab)', category: 'Library', defaultKeys: ['Ctrl+E'] },
  { id: 'lib.addText',     label: 'Add Text',            category: 'Library', defaultKeys: ['T'] },
  { id: 'lib.addRect',     label: 'Add Rectangle',       category: 'Library', defaultKeys: ['R'] },
  { id: 'lib.addEllipse',  label: 'Add Ellipse',         category: 'Library', defaultKeys: ['O'] },

  // Arrange (z-order within a layer / layer order)
  { id: 'arr.raiseLayer',  label: 'Raise Layer',         category: 'Arrange', defaultKeys: ['Ctrl+Up'] },
  { id: 'arr.lowerLayer',  label: 'Lower Layer',         category: 'Arrange', defaultKeys: ['Ctrl+Down'] },

  // Selection nudging
  { id: 'sel.nudgeLeft',   label: 'Nudge Left',          category: 'Selection', defaultKeys: ['Alt+ArrowLeft'] },
  { id: 'sel.nudgeRight',  label: 'Nudge Right',         category: 'Selection', defaultKeys: ['Alt+ArrowRight'] },
  { id: 'sel.nudgeUp',     label: 'Nudge Up',            category: 'Selection', defaultKeys: ['Alt+ArrowUp'] },
  { id: 'sel.nudgeDown',   label: 'Nudge Down',          category: 'Selection', defaultKeys: ['Alt+ArrowDown'] },

  // View
  { id: 'view.zoomIn',     label: 'Zoom In',             category: 'View', defaultKeys: ['Ctrl+='] },
  { id: 'view.zoomOut',    label: 'Zoom Out',            category: 'View', defaultKeys: ['Ctrl+-'] },
  { id: 'view.zoomFit',    label: 'Zoom to Fit',         category: 'View', defaultKeys: ['Ctrl+0'] },
  { id: 'view.shortcuts',  label: 'Keyboard Shortcuts…', category: 'View', defaultKeys: ['Ctrl+/'] },
];

export const COMMAND_BY_ID = new Map(COMMANDS.map(c => [c.id, c]));
