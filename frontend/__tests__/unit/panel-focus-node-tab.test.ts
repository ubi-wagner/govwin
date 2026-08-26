/**
 * Selecting a node lands the author on formatting — without stealing the tab they chose.
 *
 * The properties panel opens on `compliance`; shape, arrange and layering all live under `Node`. So
 * the full ribbon was two steps from the page. The fix is one line of behaviour, and the whole risk
 * is in its guard: the `Add` tab selects the node it just inserted, so a rule that fires on every
 * selection would throw the author out of the insert panel on every insert — a worse product than
 * the friction it set out to fix.
 *
 * Both directions are asserted for that reason. The cases that must NOT fire are the ones that
 * matter; a version of this that only tested "selecting focuses Node" would pass the bad rule too.
 */
import { describe, it, expect } from 'vitest';
import { shouldFocusNodeTab, type PanelTab } from '@/lib/canvas/format-controls';

describe('the default tab gives way to a new selection', () => {
  it('selecting a node from the default lands on Node', () => {
    expect(shouldFocusNodeTab(null, 'n1', 'compliance')).toBe(true);
  });

  it('selecting a DIFFERENT node from the default lands on Node again', () => {
    expect(shouldFocusNodeTab('n1', 'n2', 'compliance')).toBe(true);
  });
});

describe('a chosen tab is never stolen — the cases that make the guard worth having', () => {
  it('does NOT fire while the author is inserting from Add', () => {
    // Insert selects the node it created. Without this, every insert bounces you out of the panel
    // you are inserting from.
    expect(shouldFocusNodeTab('n1', 'n2', 'add')).toBe(false);
  });

  it.each<PanelTab>(['history', 'settings', 'review', 'node'])(
    'does NOT fire from the %s tab', (tab) => {
      expect(shouldFocusNodeTab(null, 'n1', tab)).toBe(false);
    },
  );

  it('does NOT yank the tab back when the same node is re-reported', () => {
    // The author selected n1, went back to compliance on purpose, and the effect re-ran. The
    // selection did not change, so this is not a new selection.
    expect(shouldFocusNodeTab('n1', 'n1', 'compliance')).toBe(false);
  });

  it('does NOT fire when the selection is cleared', () => {
    expect(shouldFocusNodeTab('n1', null, 'compliance')).toBe(false);
  });

  it('does NOT fire with no selection at all', () => {
    expect(shouldFocusNodeTab(null, null, 'compliance')).toBe(false);
  });
});
