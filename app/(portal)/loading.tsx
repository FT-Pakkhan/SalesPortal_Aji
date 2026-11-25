import { LoadingOverlay } from '@/components/layout/LoadingOverlay';

// Shown while a portal page is loading after a click in the sidebar or a list
export default function PortalLoading() {
  return <LoadingOverlay forceActive />;
}
