import GeneralSettingsDetail from '@/components/system/GeneralSettingsDetail';

// One settings record for the whole portal, so there is no list view: the sidebar opens the detail view
export default function GeneralSettingsPage() {
  return <GeneralSettingsDetail />;
}
