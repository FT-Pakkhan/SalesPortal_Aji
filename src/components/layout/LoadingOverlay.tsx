'use client';

import React, { useEffect, useState } from 'react';
import { useLoadingStore } from '@/stores/loadingStore';
import styles from './LoadingOverlay.module.css';

// Only show the overlay if loading takes longer than this, so quick actions don't flash
const SHOW_DELAY_MS = 300;

interface LoadingOverlayProps {
  /** Show regardless of server requests (used while a page is loading) */
  forceActive?: boolean;
}

/** Dims the whole screen, blocks clicks and shows "Loading..." while the portal is busy */
export function LoadingOverlay({ forceActive = false }: LoadingOverlayProps) {
  const pending = useLoadingStore((state) => state.pending);
  const active = forceActive || pending > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} role="alert" aria-busy="true" aria-live="polite">
      <div className={styles.card}>
        <div className={styles.text}>
          LOADING<span className={styles.dot}>.</span><span className={styles.dot}>.</span><span className={styles.dot}>.</span>
        </div>
        <div className={styles.pill}>
          <div className={styles.track}>
            <BeadRow />
            <div className={styles.fill}>
              <BeadRow />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 30 beads; on small screens CSS shows 18 (the extra ones fall outside the shorter track)
const BEAD_COUNT = 30;

function BeadRow() {
  return (
    <div className={styles.beads}>
      {Array.from({ length: BEAD_COUNT }, (_, i) => (
        <span key={i} className={styles.bead} />
      ))}
    </div>
  );
}
