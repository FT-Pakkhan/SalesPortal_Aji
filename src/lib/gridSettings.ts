import type { SummaryType } from './gridSummary';

// A user's own view settings for one grid, remembered in this browser (localStorage) — nothing goes to the server.
// Small (a few hundred bytes) and read once when the grid opens, so it doesn't slow pages down.
// Reset View Settings clears them.

export interface GridSettings {
  /** Columns the user hid with the Column Chooser */
  hidden: string[];
  footerOn: boolean;
  /** Footer total chosen per column */
  summaries: Record<string, SummaryType>;
}

/** Whose settings: the logged-in user, so people sharing a PC each keep their own */
function currentUserId(): string {
  try {
    const user = JSON.parse(localStorage.getItem('user') ?? 'null') as { id?: number } | null;
    return user?.id != null ? String(user.id) : 'anonymous';
  } catch {
    return 'anonymous';
  }
}

const storageKey = (gridKey: string) => `portal-grid:${currentUserId()}:${gridKey}`;

export function loadGridSettings(gridKey: string): GridSettings | null {
  try {
    const raw = localStorage.getItem(storageKey(gridKey));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<GridSettings>;
    return {
      hidden: Array.isArray(s.hidden) ? s.hidden.filter((c) => typeof c === 'string') : [],
      footerOn: s.footerOn === true,
      summaries: s.summaries && typeof s.summaries === 'object' ? s.summaries : {},
    };
  } catch {
    // Private window / blocked storage / unreadable value: just use the default view
    return null;
  }
}

export function saveGridSettings(gridKey: string, settings: GridSettings): void {
  try {
    const isDefault = settings.hidden.length === 0 && !settings.footerOn && Object.keys(settings.summaries).length === 0;
    if (isDefault) localStorage.removeItem(storageKey(gridKey));
    else localStorage.setItem(storageKey(gridKey), JSON.stringify(settings));
  } catch {
    // Storage unavailable: the settings simply aren't remembered
  }
}
