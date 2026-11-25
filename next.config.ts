import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Publishing: `next build` also writes .next/standalone, a self-contained server (server.js + only the node_modules
  // it needs) that runs on the server with Node.js alone - see scripts/build-release.ps1
  output: 'standalone',
  // The SQL Server driver is loaded by Node itself, not bundled: bundling let the dev server hold two copies after a
  // reload, and a parameter type from one copy isn't recognised by the other ("parameter.type.validate is not a
  // function"). One copy, loaded once, also keeps the connection pool single.
  serverExternalPackages: ['mssql', 'tedious'],
  transpilePackages: [
    'antd',
    '@ant-design/icons',
    '@ui5/webcomponents',
    '@ui5/webcomponents-base',
    '@ui5/webcomponents-fiori',
    '@ui5/webcomponents-icons',
    '@ui5/webcomponents-react',
    '@ui5/webcomponents-react-base',
    '@ui5/webcomponents-theming',
    '@ui5/webcomponents-localization',
  ],
};

export default nextConfig;
