'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, Typography, Empty, Tour, ConfigProvider, App as AntApp } from 'antd';
import type { TourProps } from 'antd';
import { UserOutlined, LogoutOutlined, SwapOutlined } from '@ant-design/icons';
import { ShellBar } from '@ui5/webcomponents-react/ShellBar';
import { ShellBarItem } from '@ui5/webcomponents-react/ShellBarItem';
import { NavigationLayout } from '@ui5/webcomponents-react/NavigationLayout';
import { SideNavigation } from '@ui5/webcomponents-react/SideNavigation';
import { SideNavigationItem } from '@ui5/webcomponents-react/SideNavigationItem';
import { SideNavigationGroup } from '@ui5/webcomponents-react/SideNavigationGroup';
import { Avatar } from '@ui5/webcomponents-react/Avatar';
import { Button as Ui5Button } from '@ui5/webcomponents-react/Button';
import type { NavigationLayoutDomRef } from '@ui5/webcomponents-react/NavigationLayout';
import type { ShellBarDomRef } from '@ui5/webcomponents-react/ShellBar';
import type { SideNavigationPropTypes, SideNavigationDomRef } from '@ui5/webcomponents-react/SideNavigation';
import type { ShellBarItemDomRef } from '@ui5/webcomponents-react/ShellBarItem';
import questionMarkIcon from '@ui5/webcomponents-icons/dist/question-mark.js';
import bellIcon from '@ui5/webcomponents-icons/dist/bell.js';
import menuIcon from '@ui5/webcomponents-icons/dist/menu.js';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useAccessStore, useScreenAccess } from '@/stores/accessStore';
import { useReportMenuStore } from '@/stores/reportMenuStore';
import { NotificationPanel, useNotifications } from './NotificationPanel';
import { SideNavigationSubItem } from '@ui5/webcomponents-react/SideNavigationSubItem';
import { SCREENS, accessTo } from '@/lib/screens';
import { sidebarIcon } from '@/lib/sidebarIcons';
import styles from './PortalLayout.module.css';

interface PortalLayoutProps {
  children: React.ReactNode;
}

/** Popup anchored to a ShellBar DOM element (notifications bell, profile icon, etc.) */
function ShellBarPopup({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: () => HTMLElement | null | undefined;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const el = anchorRef();
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    }
  }, [anchorRef]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!pos) return null;

  return (
    <div
      ref={popupRef}
      style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 1050 }}
    >
      {children}
    </div>
  );
}

const { Text } = Typography;

export default function PortalLayout({ children }: PortalLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, logout, loadFromStorage } = useAuthStore();
  // What the user's roles allow: sidebar items and pages without access are hidden
  const { access, loadAccess, setAccess } = useAccessStore();
  const { reports, loadReports, clear: clearReports } = useReportMenuStore();
  const screenAccess = useScreenAccess();

  const [tourOpen, setTourOpen] = useState(false);
  const [notifOpen, setNotifOpenState] = useState(false);
  // The bell: unread count checked in the background; the list loads when it is opened
  const notifications = useNotifications(isAuthenticated && !user?.chgPwdOnLogon, pathname);
  const setNotifOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setNotifOpenState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      notifications.setOpen(value);
      return value;
    });
  const [profileOpen, setProfileOpen] = useState(false);
  const [navMode, setNavMode] = useState<'Auto' | 'Collapsed' | 'Expanded'>('Auto');
  const shellBarRef = useRef<ShellBarDomRef>(null);
  const navLayoutRef = useRef<NavigationLayoutDomRef>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sideNavRef = useRef<SideNavigationDomRef>(null);
  const profileAnchorRef = useRef<HTMLSpanElement>(null);
  const notifBellRef = useRef<ShellBarItemDomRef>(null);

  // Determine page title
  const getPageTitle = () => {
    if (pathname.includes('/dashboard')) return 'Dashboard';
    if (pathname.startsWith('/approvals')) return 'Approvals';
    if (pathname.includes('/admin/users')) return 'Users';
    if (pathname.includes('/admin/roles')) return 'Role';
    if (pathname.includes('/profile')) return 'My Profile';
    if (pathname.includes('/system/approval-stages')) return 'Approval Stage';
    if (pathname.includes('/system/approval-templates')) return 'Approval Template';
    if (pathname.includes('/system/print-layouts')) return 'Layouts';
    if (pathname.includes('/system/general-settings')) return 'General Settings';
    if (pathname.includes('/system/document-numbering')) return 'Document Numbering';
    if (pathname.includes('/system/dashboard-settings')) return 'Dashboard Settings';
    if (pathname.startsWith('/leads')) return 'Lead';
    if (pathname.startsWith('/convert-to-customer')) return 'Convert to Customer';
    if (pathname.includes('/sales-quotations')) return 'Sales Quotation';
    if (pathname.includes('/sales-orders')) return 'Sales Order';
    if (pathname.startsWith('/credit-memos')) return 'Credit Memo';
    if (pathname.startsWith('/sales-check-ins')) return 'Sales Check In';
    if (pathname.includes('/banking/temporary-receipts')) return 'Temporary Receipt';
    if (pathname.includes('/inventory/transfers')) return 'Inventory Transfer';
    return 'Sales Portal';
  };

  const tourSteps: TourProps['steps'] = [
    {
      title: getPageTitle(),
      description: 'This is your current page. Use the sidebar to navigate to other sections of the portal.',
      target: () => contentRef.current ?? document.body,
    },
    {
      title: 'Sidebar Navigation',
      description: 'Browse My Profile, Dashboard, Approvals, System Initialization, A/R Sales, Banking and Inventory from here.',
      target: () => (sideNavRef.current as unknown as HTMLElement) ?? document.body,
    },
    {
      title: 'Shell Bar',
      description: 'The top bar gives you quick access to notifications, help, and your profile menu.',
      target: () => (shellBarRef.current as unknown as HTMLElement) ?? null,
    },
  ];

  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    loadFromStorage();
    setAuthChecked(true);
  }, [loadFromStorage]);

  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      router.push('/login');
    }
  }, [authChecked, isAuthenticated, router]);

  // After a password reset the user must choose a new password before using the portal
  useEffect(() => {
    if (isAuthenticated && user?.chgPwdOnLogon) router.replace('/change-password');
  }, [isAuthenticated, user?.chgPwdOnLogon, router]);

  // The user's access, once logged in (again for another user after logging in as someone else)
  useEffect(() => {
    if (isAuthenticated) void loadAccess();
    else setAccess(null);
  }, [isAuthenticated, user?.id]);

  // The reports this user may run (sidebar tree), once their access shows the Reports screen
  const showReports = access !== null && accessTo(access, 'REPORTS') !== 'NONE';
  useEffect(() => {
    if (isAuthenticated && showReports) void loadReports();
    else clearReports();
  }, [isAuthenticated, user?.id, showReports]);

  // Read Only: a page that would change something (?edit=1 from a list's Edit button) opens in view mode instead
  useEffect(() => {
    if (screenAccess !== 'READ') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') {
      params.delete('edit');
      const rest = params.toString();
      router.replace(rest ? `${pathname}?${rest}` : pathname);
    }
  }, [screenAccess, pathname]);

  // Position the profile dropdown anchor at the ShellBar's profile icon
  useEffect(() => {
    const updateProfileAnchor = () => {
      const el = shellBarRef.current?.profileDomRef;
      const anchor = profileAnchorRef.current;
      if (el && anchor) {
        const rect = el.getBoundingClientRect();
        anchor.style.top = `${rect.bottom}px`;
        anchor.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      }
    };
    // Position after ShellBar renders (web components render async)
    const timer = setTimeout(updateProfileAnchor, 200);
    return () => clearTimeout(timer);
  }, [profileOpen]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const notifAnchorRef = useCallback(() => notifBellRef.current as HTMLElement | null, []);
  const closeNotifPopup = useCallback(() => {
    setNotifOpenState(false);
    notifications.setOpen(false);
  }, [notifications.setOpen]);

  const userMenuItems = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 500 }}>{user?.displayName || user?.userName}</div>
          <div style={{ fontSize: 12, color: '#6A6D70' }}>{user?.userName}</div>
          {user?.company && <div style={{ fontSize: 12, color: '#6A6D70' }}>{user.company.name}</div>}
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'My Profile',
      onClick: () => router.push('/profile'),
    },
    // Several companies: back to the login screen to choose another
    ...(user?.company
      ? [{ key: 'change-company', icon: <SwapOutlined />, label: 'Change Company', onClick: handleLogout }]
      : []),
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Log Out',
      onClick: handleLogout,
    },
  ];

  const handleSideNavSelection: SideNavigationPropTypes['onSelectionChange'] = useCallback((e) => {
    const item = e.detail.item as HTMLElement;
    const path = item.dataset.path;
    if (path) {
      router.push(path);
      // Auto-collapse sidebar on mobile after navigation
      if (window.innerWidth <= 768) {
        setNavMode('Collapsed');
      }
    }
  }, [router]);

  // Native click handler: go back to the list when clicking the already-selected sidebar item
  // (UI5 SideNavigation doesn't fire onSelectionChange for already-selected items,
  // e.g. clicking "Users" while on a user's detail view)
  useEffect(() => {
    const el = sideNavRef.current as unknown as HTMLElement | null;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      const navItem = target.closest('[data-path]') as HTMLElement | null;
      if (!navItem?.dataset.path) return;
      const clickedPath = navItem.dataset.path;
      // If already on this section (exact match or subpage), refresh/navigate to list
      if (pathname === clickedPath || pathname.startsWith(clickedPath + '/')) {
        e.stopPropagation();
        router.push(clickedPath);
        router.refresh();
      }
    };
    el.addEventListener('click', handler, true);
    return () => el.removeEventListener('click', handler, true);
  }, [router, pathname, isAuthenticated]);

  if (!isAuthenticated || user?.chgPwdOnLogon) return null;

  // Determine selected path for SideNavigation
  const getSelectedPath = () => {
    if (pathname.startsWith('/dashboard')) return '/dashboard';
    if (pathname.startsWith('/approvals')) return '/approvals';
    if (pathname.startsWith('/admin/users')) return '/admin/users';
    if (pathname.startsWith('/admin/roles')) return '/admin/roles';
    if (pathname.startsWith('/profile')) return '/profile';
    if (pathname.startsWith('/system/approval-stages')) return '/system/approval-stages';
    if (pathname.startsWith('/system/approval-templates')) return '/system/approval-templates';
    if (pathname.startsWith('/system/print-layouts')) return '/system/print-layouts';
    if (pathname.startsWith('/system/general-settings')) return '/system/general-settings';
    if (pathname.startsWith('/system/document-numbering')) return '/system/document-numbering';
    if (pathname.startsWith('/leads')) return '/leads';
    if (pathname.startsWith('/convert-to-customer')) return '/convert-to-customer';
    if (pathname.startsWith('/sales-quotations')) return '/sales-quotations';
    if (pathname.startsWith('/sales-orders')) return '/sales-orders';
    if (pathname.startsWith('/credit-memos')) return '/credit-memos';
    if (pathname.startsWith('/sales-check-ins')) return '/sales-check-ins';
    if (pathname.startsWith('/banking/temporary-receipts')) return '/banking/temporary-receipts';
    if (pathname.startsWith('/banking/receipt-requests')) return '/banking/receipt-requests';
    if (pathname.startsWith('/inventory/transfers')) return '/inventory/transfers';
    if (pathname.startsWith('/system/report-settings')) return '/system/report-settings';
    if (pathname.startsWith('/system/dashboard-settings')) return '/system/dashboard-settings';
    return pathname;
  };

  const selectedPath = getSelectedPath();

  // Sidebar: a screen shows when the user's roles give it Read Only or Full; a group when any of its screens shows
  const show = (code: string) => accessTo(access, code) !== 'NONE';
  const showGroup = (group: string) => SCREENS.some((s) => s.group === group && show(s.code));

  // The page itself: no access to its screen (or a New page on a Read Only screen) -> a message instead
  const blocked =
    access !== null && (screenAccess === 'NONE' || (screenAccess === 'READ' && /\/new$/.test(pathname)));
  const noAccess = (
    <div className={styles.noAccess}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          screenAccess === 'READ'
            ? 'You have Read Only access to this screen, so you cannot create here.'
            : "You don't have access to this screen. Ask your administrator to add it to one of your roles."
        }
      />
    </div>
  );

  // Notification dropdown: newest notifications (FTS11ONTF), Mark all as read, View all
  const notifPopupRender = () => (
    <NotificationPanel
      items={notifications.items}
      unread={notifications.unread}
      onMarkRead={notifications.markRead}
      onClose={closeNotifPopup}
    />
  );

  // Toggle sidebar visibility (for mobile menu button)
  const handleMenuToggle = () => {
    if (navLayoutRef.current) {
      const collapsed = navLayoutRef.current.isSideCollapsed();
      setNavMode(collapsed ? 'Expanded' : 'Collapsed');
    } else {
      setNavMode((prev) => prev === 'Expanded' ? 'Collapsed' : 'Expanded');
    }
  };

  // ShellBar header for NavigationLayout
  const shellBar = (
    <ShellBar
      ref={shellBarRef}
      primaryTitle="SAP Business One"
      // Rendered in the content slot instead of secondaryTitle so its font can be styled
      content={
        <span className={styles.portalTitle}>
          AJI Sales Portal
          {/* Several companies: the one logged in to */}
          {user?.company && <span className={styles.companyName}>{user.company.name}</span>}
        </span>
      }
      startButton={
        <Ui5Button icon={menuIcon} onClick={handleMenuToggle} />
      }
      onProfileClick={() => { setNotifOpen(false); setProfileOpen((prev) => !prev); }}
      profile={
        <Avatar
          initials={user?.userName?.charAt(0).toUpperCase()}
          colorScheme="Accent6"
        />
      }
    >
      <ShellBarItem
        ref={notifBellRef}
        icon={bellIcon}
        text="Notifications"
        // Unread count as the bell's badge (none when 0)
        count={notifications.unread > 0 ? String(notifications.unread > 99 ? '99+' : notifications.unread) : undefined}
        onClick={() => { setProfileOpen(false); setNotifOpen((prev) => !prev); }}
      />
      <ShellBarItem
        icon={questionMarkIcon}
        text="Help"
        onClick={() => setTourOpen(true)}
      />
    </ShellBar>
  );

  // Reports by category, in the order the server gives (no category first, then by category and name)
  const reportTree = [...reports.reduce((map, r) => {
    const category = r.category || null;
    map.set(category, [...(map.get(category) ?? []), r]);
    return map;
  }, new Map<string | null, typeof reports>())];

  // SideNavigation for NavigationLayout
  const sideNav = (
    <SideNavigation
      ref={sideNavRef}
      // Compact density: tighter rows than UI5's default
      data-ui5-compact-size
      onSelectionChange={handleSideNavSelection}
    >
      <SideNavigationItem
        text="My Profile"
        icon={sidebarIcon('profile')}
        data-path="/profile"
        selected={selectedPath === '/profile'}
      />
      <SideNavigationItem
        text="Dashboard"
        icon={sidebarIcon('home')}
        data-path="/dashboard"
        selected={selectedPath === '/dashboard'}
      />
      {/* Documents waiting for my approval: shown when one of the user's roles has the Approvals screen */}
      {show('APPROVALS') && (
        <SideNavigationItem
          text="Approvals"
          icon={sidebarIcon('approval-stage')}
          data-path="/approvals"
          selected={selectedPath === '/approvals'}
        />
      )}
      {showGroup('System Initialization') && (
      <SideNavigationGroup text="System Initialization">
        {show('USERS') && (
          <SideNavigationItem
            text="Users"
            icon={sidebarIcon('users')}
            data-path="/admin/users"
            selected={selectedPath === '/admin/users'}
          />
        )}
        {show('ROLES') && (
          <SideNavigationItem
            text="Role"
            icon={sidebarIcon('role')}
            data-path="/admin/roles"
            selected={selectedPath === '/admin/roles'}
          />
        )}
        {show('GENERAL_SETTINGS') && (
          <SideNavigationItem
            text="General Settings"
            icon={sidebarIcon('general-settings')}
            data-path="/system/general-settings"
            selected={selectedPath === '/system/general-settings'}
          />
        )}
        {show('DOC_NUMBERING') && (
          <SideNavigationItem
            text="Document Numbering"
            icon={sidebarIcon('document-numbering')}
            data-path="/system/document-numbering"
            selected={selectedPath === '/system/document-numbering'}
          />
        )}
        {show('APPR_STAGE') && (
          <SideNavigationItem
            text="Approval Stage"
            icon={sidebarIcon('approval-stage')}
            data-path="/system/approval-stages"
            selected={selectedPath === '/system/approval-stages'}
          />
        )}
        {show('APPR_TEMPLATE') && (
          <SideNavigationItem
            text="Approval Template"
            icon={sidebarIcon('approval-template')}
            data-path="/system/approval-templates"
            selected={selectedPath === '/system/approval-templates'}
          />
        )}
        {/* Crystal Reports layouts a document can be printed with */}
        {show('LAYOUTS') && (
          <SideNavigationItem
            text="Layouts"
            icon={sidebarIcon('sales-quotation')}
            data-path="/system/print-layouts"
            selected={selectedPath === '/system/print-layouts'}
          />
        )}
        {/* Crystal Reports for the Reports module */}
        {show('REPORT_SETTINGS') && (
          <SideNavigationItem
            text="Report Settings"
            icon={sidebarIcon('report-settings')}
            data-path="/system/report-settings"
            selected={selectedPath === '/system/report-settings'}
          />
        )}
        {/* Dashboard widgets and who sees them */}
        {show('DASH_SETTINGS') && (
          <SideNavigationItem
            text="Dashboard Settings"
            icon={sidebarIcon('home')}
            data-path="/system/dashboard-settings"
            selected={selectedPath === '/system/dashboard-settings'}
          />
        )}
        {/* Reports e-mailed from the portal */}
        {show('EMAIL_LOG') && (
          <SideNavigationItem
            text="E-mail Log"
            icon={sidebarIcon('mail')}
            data-path="/system/email-log"
            selected={selectedPath === '/system/email-log'}
          />
        )}
      </SideNavigationGroup>
      )}
      {showGroup('A/R Sales') && (
      <SideNavigationGroup text="A/R Sales">
        {show('LEAD') && (
          <SideNavigationItem
            text="Lead"
            icon={sidebarIcon('users')}
            data-path="/leads"
            selected={selectedPath === '/leads'}
          />
        )}
        {show('CNVC') && (
          <SideNavigationItem
            text="Convert to Customer"
            icon={sidebarIcon('profile')}
            data-path="/convert-to-customer"
            selected={selectedPath === '/convert-to-customer'}
          />
        )}
        {show('SCIN') && (
          <SideNavigationItem
            text="Sales Check In"
            icon={sidebarIcon('sales-check-in')}
            data-path="/sales-check-ins"
            selected={selectedPath === '/sales-check-ins'}
          />
        )}
        {show('OQUT') && (
          <SideNavigationItem
            text="Sales Quotation"
            icon={sidebarIcon('sales-quotation')}
            data-path="/sales-quotations"
            selected={selectedPath === '/sales-quotations'}
          />
        )}
        {show('ORDR') && (
          <SideNavigationItem
            text="Sales Order"
            icon={sidebarIcon('sales-order')}
            data-path="/sales-orders"
            selected={selectedPath === '/sales-orders'}
          />
        )}
        {show('ORIN') && (
          <SideNavigationItem
            text="Credit Memo"
            icon={sidebarIcon('credit-memo')}
            data-path="/credit-memos"
            selected={selectedPath === '/credit-memos'}
          />
        )}
      </SideNavigationGroup>
      )}
      {showGroup('Banking') && (
      <SideNavigationGroup text="Banking">
        {/* Payments noted down before the receipt; copied into Temporary Receipts */}
        {show('TRRQ') && (
          <SideNavigationItem
            text="Temporary Receipt Request"
            icon={sidebarIcon('temporary-receipt')}
            data-path="/banking/receipt-requests"
            selected={selectedPath === '/banking/receipt-requests'}
          />
        )}
        {show('TMPR') && (
          <SideNavigationItem
            text="Temporary Receipt"
            icon={sidebarIcon('temporary-receipt')}
            data-path="/banking/temporary-receipts"
            selected={selectedPath === '/banking/temporary-receipts'}
          />
        )}
      </SideNavigationGroup>
      )}
      {showGroup('Inventory') && (
      <SideNavigationGroup text="Inventory">
        {show('OWTR') && (
          <SideNavigationItem
            text="Inventory Transfer"
            icon={sidebarIcon('inventory-transfer')}
            data-path="/inventory/transfers"
            selected={selectedPath === '/inventory/transfers'}
          />
        )}
      </SideNavigationGroup>
      )}
      {/* The reports the user's roles may run: those without a category straight under Reports, the others in
          their category's folder (Reports > Category > Report). Every report has the same report icon. */}
      {show('REPORTS') && reports.length > 0 && (
      <SideNavigationGroup text="Reports">
        {reportTree.map(([category, items]) =>
          category === null ? (
            items.map((r) => (
              <SideNavigationItem
                key={r.docEntry}
                text={r.reportName}
                icon={sidebarIcon('report')}
                data-path={`/reports/${r.docEntry}`}
                selected={pathname === `/reports/${r.docEntry}`}
              />
            ))
          ) : (
            <SideNavigationItem key={category} text={category} icon={sidebarIcon('report-folder')} unselectable>
              {items.map((r) => (
                <SideNavigationSubItem
                  key={r.docEntry}
                  text={r.reportName}
                  icon={sidebarIcon('report')}
                  data-path={`/reports/${r.docEntry}`}
                  selected={pathname === `/reports/${r.docEntry}`}
                />
              ))}
            </SideNavigationItem>
          )
        )}
      </SideNavigationGroup>
      )}
    </SideNavigation>
  );

  return (
    // Every popup (and confirm box) in the middle of the screen
    <ConfigProvider modal={{ centered: true }}>
      <AntApp>
      <NavigationLayout
        ref={navLayoutRef}
        header={shellBar}
        sideContent={sideNav}
        mode={navMode}
      >
        <div ref={contentRef} className={styles.content}>
          {/* Nothing until the user's access is known (the LOADING overlay shows meanwhile) */}
          {access === null ? null : blocked ? noAccess : children}
        </div>
      </NavigationLayout>

      {/* Notification dropdown - anchored to ShellBar bell icon */}
      {notifOpen && (
        <ShellBarPopup
          anchorRef={notifAnchorRef}
          onClose={closeNotifPopup}
        >
          {notifPopupRender()}
        </ShellBarPopup>
      )}

      {/* User menu dropdown - anchored to ShellBar profile icon */}
      <Dropdown
        open={profileOpen}
        onOpenChange={setProfileOpen}
        menu={{ items: userMenuItems }}
        placement="bottomRight"
        trigger={['click']}
        getPopupContainer={() => document.body}
      >
        <span ref={profileAnchorRef} style={{ position: 'fixed', width: 1, height: 1, pointerEvents: 'none' }} />
      </Dropdown>

      {tourOpen && (
        <Tour
          open
          onClose={() => setTourOpen(false)}
          steps={tourSteps}
        />
      )}
      </AntApp>
    </ConfigProvider>
  );
}
