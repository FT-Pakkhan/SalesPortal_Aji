'use client';

import '@ui5/webcomponents-react/dist/Assets.js';
import { ThemeProvider } from '@ui5/webcomponents-react';

export function Ui5Provider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider staticCssInjected>{children}</ThemeProvider>;
}
