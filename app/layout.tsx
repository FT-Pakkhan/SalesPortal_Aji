import type { Metadata, Viewport } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { App as AntApp, ConfigProvider } from 'antd';
import '@ui5/webcomponents-react/styles.css';
import '@/styles/globals.css';
import { Ui5Provider } from './Ui5Provider';
import { LoadingOverlay } from '@/components/layout/LoadingOverlay';
import { Inter } from 'next/font/google';

// Used for the "Sales Portal" title in the shell bar
const inter = Inter({ subsets: ['latin'], weight: ['700'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Sales Portal',
  description: 'Sales Quotation & Sales Order Portal - SAP B1 Integrated',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <Ui5Provider>
          <AntdRegistry>
            {/* Keep fontFamily in sync with --app-font in globals.css */}
            {/* fontSize: keep in sync with the grid theme in DataGrid.tsx */}
            {/* modal.centered: every popup (and confirm box) sits in the middle of the screen */}
            <ConfigProvider
              theme={{ token: { fontFamily: "'72', '72full', Arial, Helvetica, sans-serif", fontSize: 13 } }}
              modal={{ centered: true }}
            >
              <AntApp>
                {children}
                {/* Dims the screen while server requests are in progress */}
                <LoadingOverlay />
              </AntApp>
            </ConfigProvider>
          </AntdRegistry>
        </Ui5Provider>
      </body>
    </html>
  );
}
