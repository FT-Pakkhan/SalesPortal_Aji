import { create } from 'zustand';
import { usePathname } from 'next/navigation';
import { rolesAPI } from '@/lib/apiClient';
import { accessTo, screenOfPath } from '@/lib/screens';
import type { MyAccess, ScreenAccess } from '@/lib/screens';

/** What the logged-in user may do (their roles), loaded by the portal layout after login */
interface AccessState {
  /** null until loaded */
  access: MyAccess | null;
  setAccess: (access: MyAccess | null) => void;
  /** Read it again from the server (after login, and after a role is saved) */
  loadAccess: () => Promise<void>;
}

export const useAccessStore = create<AccessState>((set) => ({
  access: null,
  setAccess: (access) => set({ access }),
  loadAccess: async () => {
    try {
      const res = await rolesAPI.getMine();
      if (res.success) {
        set({
          access: {
            isAdmin: res.data.isAdmin,
            screens: Object.fromEntries(res.data.screenList.map((s) => [s.code, s.level])),
          },
        });
      }
    } catch {
      // No access known: nothing restricted is shown
      set({ access: { isAdmin: false, screens: {} } });
    }
  },
}));

/**
 * Access to the screen of the current page: FULL, READ or NONE (pages every user has, e.g. Dashboard, are FULL).
 * A document opened from Approvals (?from=approvals) is at least READ, so its approvers can see it and decide.
 */
export function useScreenAccess(): ScreenAccess {
  const pathname = usePathname();
  const access = useAccessStore((s) => s.access);
  const screen = screenOfPath(pathname);
  if (!screen) return 'FULL';
  const level = accessTo(access, screen.code);
  // Read from the address bar, not useSearchParams (that would need a Suspense boundary around every page)
  if (level === 'NONE' && fromApprovals()) return 'READ';
  return level;
}

/** The page was opened from the Approvals list (?from=approvals) */
export const fromApprovals = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('from') === 'approvals';

/** The current screen may be changed (New, Edit, Confirm ... shown); false = Read Only */
export const useCanChange = (): boolean => useScreenAccess() === 'FULL';
