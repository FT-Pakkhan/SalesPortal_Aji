import { create } from 'zustand';

/** Counts server requests in progress, so the whole screen can show a loading overlay */
interface LoadingState {
  pending: number;
  start: () => void;
  finish: () => void;
}

export const useLoadingStore = create<LoadingState>((set) => ({
  pending: 0,
  start: () => set((state) => ({ pending: state.pending + 1 })),
  finish: () => set((state) => ({ pending: Math.max(0, state.pending - 1) })),
}));
