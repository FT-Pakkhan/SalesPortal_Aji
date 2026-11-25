import { create } from 'zustand';
import { reportsAPI } from '@/lib/apiClient';
import type { MyReport } from '@/types';

/** The reports the user may run, shown as a tree in the sidebar (Reports > Category > Report) */
interface ReportMenuState {
  reports: MyReport[];
  /** Read them again (after login, and after a report is saved in Report Settings) */
  loadReports: () => Promise<void>;
  clear: () => void;
}

export const useReportMenuStore = create<ReportMenuState>((set) => ({
  reports: [],
  loadReports: async () => {
    try {
      const res = await reportsAPI.getList();
      if (res.success) set({ reports: res.data });
    } catch {
      set({ reports: [] });
    }
  },
  clear: () => set({ reports: [] }),
}));
