import * as m from '$lib/paraglide/messages.js';

export interface Shortcut {
  id: string;
  name: string;
  category: 'view' | 'edit' | 'tools' | 'toggle';
  description: string;
  defaultKey: string; // e.g. "Alt+M"
  key: string;        // The user's active key
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    id: 'toggle_topology',
    name: 'Toggle Topology (circular / linear)',
    category: 'view',
    description: 'Switch back and forth between the circular plasmid map and the linear DNA map',
    defaultKey: 'Alt+M',
    key: 'Alt+M'
  },
  {
    id: 'switch_circular',
    name: 'Switch to Circular Map',
    category: 'view',
    description: 'Go directly to the circular plasmid map view',
    defaultKey: 'Alt+C',
    key: 'Alt+C'
  },
  {
    id: 'switch_linear',
    name: 'Switch to Linear Map',
    category: 'view',
    description: 'Go directly to the linear gene map view',
    defaultKey: 'Alt+L',
    key: 'Alt+L'
  },
  {
    id: 'switch_sequence',
    name: 'Switch to Sequence Editor',
    category: 'view',
    description: 'Switch directly to the sequence row editor view',
    defaultKey: 'Alt+S',
    key: 'Alt+S'
  },
  {
    id: 'switch_features',
    name: 'Switch to Feature Annotations',
    category: 'view',
    description: 'Switch to the list of annotated feature records',
    defaultKey: 'Alt+F',
    key: 'Alt+F'
  },
  {
    id: 'switch_properties',
    name: 'Switch to Plasmid Properties',
    category: 'view',
    description: 'Show total length, GC content, topology and other summary data for the current vector',
    defaultKey: 'Alt+P',
    key: 'Alt+P'
  },
  {
    id: 'switch_notes',
    name: 'Switch to Notes Panel',
    category: 'view',
    description: 'Show and edit the detailed scientific notes and historical annotations for this DNA sequence',
    defaultKey: 'Alt+N',
    key: 'Alt+N'
  },
  {
    id: 'undo',
    name: 'Undo',
    category: 'edit',
    description: 'Undo the most recent edit or cloning action on the history stack',
    defaultKey: 'Mod+Z',
    key: 'Mod+Z'
  },
  {
    id: 'redo',
    name: 'Redo',
    category: 'edit',
    description: 'Restore the action that was just undone',
    defaultKey: 'Mod+Shift+Z',
    key: 'Mod+Shift+Z'
  },
  {
    id: 'save_project',
    name: m.saveCurrentProject(),
    category: 'edit',
    description: 'Save the plasmid editor project locally in .spiceg format',
    defaultKey: 'Mod+S',
    key: 'Mod+S'
  },
  {
    id: 'flip_sequence',
    name: 'Reverse Complement (Flip / RC)',
    category: 'edit',
    description: 'Reverse-complement the whole double-stranded DNA sequence',
    defaultKey: 'Mod+R',
    key: 'Mod+R'
  },
  {
    id: 'clear_selection',
    name: 'Clear Selection',
    category: 'edit',
    description: 'Collapse the selection to a single cursor and clear the highlighted region',
    defaultKey: 'Escape',
    key: 'Escape'
  },
  {
    id: 'toggle_search',
    name: 'Toggle Sequence Search Bar',
    category: 'tools',
    description: 'Show or hide the fast sequence search that supports degenerate bases and regex',
    defaultKey: 'Mod+F',
    key: 'Mod+F'
  },
  {
    id: 'toggle_enzymes',
    name: 'Toggle Restriction Enzyme Sites Panel',
    category: 'tools',
    description: 'Show or hide the multi-enzyme digestion analyzer and its cut-site annotations',
    defaultKey: 'Mod+E',
    key: 'Mod+E'
  },
  {
    id: 'toggle_codon',
    name: 'Toggle Codon Optimizer',
    category: 'tools',
    description: 'One-click analysis, translation and codon-bias retuning for a chosen host',
    defaultKey: 'Mod+O',
    key: 'Mod+O'
  },
  {
    id: 'toggle_crispr',
    name: 'Toggle CRISPR Designer',
    category: 'tools',
    description: 'Design single-guide RNA (sgRNA) targets for CRISPR-Cas9/Cas12a and related systems',
    defaultKey: 'Mod+G',
    key: 'Mod+G'
  },
  {
    id: 'toggle_validator',
    name: 'Toggle Cloning Scheme Validator',
    category: 'tools',
    description: 'Automatically verify Golden Gate, Gibson Assembly and other ligation/assembly steps',
    defaultKey: 'Mod+V',
    key: 'Mod+V'
  },
  {
    id: 'toggle_gel',
    name: 'Toggle Virtual Gel Electrophoresis',
    category: 'tools',
    description: 'Show the virtual agarose gel for the digestion products of the current enzyme set',
    defaultKey: 'Mod+H',
    key: 'Mod+H'
  },
  {
    id: 'toggle_logger',
    name: 'Toggle Console & Operation Log',
    category: 'tools',
    description: 'Show or hide the main editor log monitor and the Rust backend output console',
    defaultKey: 'Mod+J',
    key: 'Mod+J'
  },
  {
    id: 'toggle_primers',
    name: 'Toggle Primers & LIMS Panel',
    category: 'tools',
    description: 'Compute PCR verification primer properties and link laboratory data',
    defaultKey: 'Mod+P',
    key: 'Mod+P'
  }
];

export function localizeShortcut(s: Shortcut): Shortcut {
  const obj = { ...s };
  Object.defineProperty(obj, 'name', {
    get() {
      const key = `keymap_name_${s.id}`;
      // @ts-ignore
      if (typeof m[key] === 'function') {
        // @ts-ignore
        return m[key]();
      }
      return s.name;
    },
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(obj, 'description', {
    get() {
      const key = `keymap_desc_${s.id}`;
      // @ts-ignore
      if (typeof m[key] === 'function') {
        // @ts-ignore
        return m[key]();
      }
      return s.description;
    },
    enumerable: true,
    configurable: true
  });
  return obj as Shortcut;
}

export function loadKeymap(): Shortcut[] {
  if (typeof localStorage === 'undefined') return DEFAULT_SHORTCUTS.map(localizeShortcut);
  const saved = localStorage.getItem('spice_keymap');
  if (!saved) return DEFAULT_SHORTCUTS.map(localizeShortcut);
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      // Merge with defaults to ensure any new defaults are present
      return DEFAULT_SHORTCUTS.map(def => {
        const found = parsed.find((p: any) => p.id === def.id);
        return localizeShortcut({
          ...def,
          key: found ? found.key : def.defaultKey
        });
      });
    }
  } catch (e) {
    // fallback
  }
  return DEFAULT_SHORTCUTS.map(localizeShortcut);
}

export function saveKeymap(shortcuts: Shortcut[]) {
  if (typeof localStorage === 'undefined') return;
  // Convert getters to properties for correct serialization to JSON
  const serialized = shortcuts.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    defaultKey: s.defaultKey,
    key: s.key
  }));
  localStorage.setItem('spice_keymap', JSON.stringify(serialized));
}

export function resetKeymap(): Shortcut[] {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('spice_keymap');
  }
  return DEFAULT_SHORTCUTS.map(s => localizeShortcut({ ...s, key: s.defaultKey }));
}

/**
 * Converts a KeyboardEvent into a standardized string representation.
 * Handles Cmd on Mac vs Ctrl on Windows/Linux by normalizing to "Mod".
 */
export function getEventShortcutString(e: KeyboardEvent): string {
  const parts: string[] = [];
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const hasCmdCtrl = isMac ? e.metaKey : e.ctrlKey;
  
  if (hasCmdCtrl) {
    parts.push('Mod');
  } else {
    // If we are recording or displaying literal, we might want Ctrl or Meta
    if (isMac && e.ctrlKey) parts.push('Ctrl');
    if (!isMac && e.metaKey) parts.push('Meta');
  }

  if (e.altKey) {
    parts.push('Alt');
  }

  if (e.shiftKey) {
    parts.push('Shift');
  }

  // Determine the key part
  let key = e.key;
  if (key === ' ') {
    key = 'Space';
  } else if (key.length === 1) {
    key = key.toUpperCase();
  }

  // Do not add modifier keys by themselves as the final key
  if (['Control', 'Shift', 'Alt', 'Meta', 'Android'].includes(key)) {
    // Only return the modifiers joined if we want to show progress, or empty
    return parts.join('+');
  }

  if (key) {
    parts.push(key);
  }

  return parts.join('+');
}
