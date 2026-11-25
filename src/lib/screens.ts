// The portal's screens, for roles (Administration > Role): which screens a role can use, and how.
// Kept in the program: a new screen always comes with code, so it is added here at the same time.
// Shared by the server (roles) and the browser (sidebar, page access).

/** FULL = view and change; READ = view only (change buttons hidden); NONE = hidden */
export type ScreenAccess = 'FULL' | 'READ' | 'NONE';

export const ACCESS_LEVELS: { value: ScreenAccess; label: string }[] = [
  { value: 'FULL', label: 'Full' },
  { value: 'READ', label: 'Read Only' },
  { value: 'NONE', label: 'None' },
];

export interface Screen {
  /** Stored in FTS11ROL2.ScreenCode */
  code: string;
  name: string;
  /** Sidebar group it is in */
  group: string;
  /** Its list / main page; detail pages are below it (e.g. /leads/5) */
  path: string;
}

/** In sidebar order. Dashboard and My Profile aren't here: every logged-in user has them. */
export const SCREENS: Screen[] = [
  // Documents waiting for my approval (approvers are set per approval stage; the role decides if the list shows)
  { code: 'APPROVALS', name: 'Approvals', group: 'Main', path: '/approvals' },
  { code: 'USERS', name: 'Users', group: 'System Initialization', path: '/admin/users' },
  { code: 'ROLES', name: 'Role', group: 'System Initialization', path: '/admin/roles' },
  { code: 'GENERAL_SETTINGS', name: 'General Settings', group: 'System Initialization', path: '/system/general-settings' },
  { code: 'DOC_NUMBERING', name: 'Document Numbering', group: 'System Initialization', path: '/system/document-numbering' },
  { code: 'APPR_STAGE', name: 'Approval Stage', group: 'System Initialization', path: '/system/approval-stages' },
  { code: 'APPR_TEMPLATE', name: 'Approval Template', group: 'System Initialization', path: '/system/approval-templates' },
  { code: 'LAYOUTS', name: 'Layouts', group: 'System Initialization', path: '/system/print-layouts' },
  // Crystal Reports for the Reports module: parameters and the roles that may run each one
  { code: 'REPORT_SETTINGS', name: 'Report Settings', group: 'System Initialization', path: '/system/report-settings' },
  // Dashboard widgets (query-based KPI / chart / table) and the roles that see each one
  { code: 'DASH_SETTINGS', name: 'Dashboard Settings', group: 'System Initialization', path: '/system/dashboard-settings' },
  // Reports e-mailed from the portal (sent / failed)
  { code: 'EMAIL_LOG', name: 'E-mail Log', group: 'System Initialization', path: '/system/email-log' },
  { code: 'LEAD', name: 'Lead', group: 'A/R Sales', path: '/leads' },
  // Creates an OPEN lead in SAP B1 as a customer (application form, SAP BP Code, approval)
  { code: 'CNVC', name: 'Convert to Customer', group: 'A/R Sales', path: '/convert-to-customer' },
  { code: 'SCIN', name: 'Sales Check In', group: 'A/R Sales', path: '/sales-check-ins' },
  { code: 'OQUT', name: 'Sales Quotation', group: 'A/R Sales', path: '/sales-quotations' },
  { code: 'ORDR', name: 'Sales Order', group: 'A/R Sales', path: '/sales-orders' },
  { code: 'ORIN', name: 'Credit Memo', group: 'A/R Sales', path: '/credit-memos' },
  { code: 'TRRQ', name: 'Temporary Receipt Request', group: 'Banking', path: '/banking/receipt-requests' },
  { code: 'TMPR', name: 'Temporary Receipt', group: 'Banking', path: '/banking/temporary-receipts' },
  { code: 'OWTR', name: 'Inventory Transfer', group: 'Inventory', path: '/inventory/transfers' },
  // Lists the reports the user's roles may run (set per report in Report Settings)
  { code: 'REPORTS', name: 'Reports', group: 'Reports', path: '/reports' },
];

export const SCREEN_CODES = new Set(SCREENS.map((s) => s.code));

/** The screen a page belongs to (its own path or below it); undefined for pages every user has */
export const screenOfPath = (pathname: string): Screen | undefined =>
  SCREENS.find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`));

const RANK: Record<ScreenAccess, number> = { NONE: 0, READ: 1, FULL: 2 };

/** The better of two access levels (a user with several roles gets the best) */
export const bestAccess = (a: ScreenAccess, b: ScreenAccess): ScreenAccess => (RANK[a] >= RANK[b] ? a : b);

/** What the logged-in user may do: administrators everything, others per screen (missing = NONE) */
export interface MyAccess {
  isAdmin: boolean;
  screens: Record<string, ScreenAccess>;
}

export const accessTo = (my: MyAccess | null, code: string): ScreenAccess =>
  my?.isAdmin ? 'FULL' : my?.screens[code] ?? 'NONE';
