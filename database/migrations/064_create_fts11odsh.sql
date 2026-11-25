-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 064_create_fts11odsh
-- Date: 2026-10-10
-- ============================================

-- ============================================
-- FTS11ODSH - Dashboard Settings: the widgets shown on the Dashboard, each one the result of a query.
--   One layout for everyone: widgets are shown in Sequence order; a user sees the active widgets of their roles
--   (FTS11DSH1), an admin role sees them all. Users can't move or hide widgets themselves.
--   WidgetType: KPI   = one number (1st column of the 1st row); an optional 2nd column is the figure to compare with
--                       (e.g. last month), shown as up / down %
--               BAR / LINE = 1st column = label (e.g. month), every other column = a series named after the column
--               PIE   = 1st column = label, 2nd column = value
--               TABLE = the rows as returned (at most 50)
--   Query:      a SELECT; may use @UserID @UserName @SlpCode @Today @MonthStart @YearStart. Read-only, 15 s timeout.
--   UseSapConn: runs in the SAP company database (no "SBODemoGB.." needed), as on Report Settings
--   Width:      1 = a quarter of the row, 2 = half, 4 = the whole row
--   ValueFormat: NUMBER / AMOUNT (2 decimals) / PERCENT - how KPI and chart values are shown
--   LinkPath:   optional portal page opened when the widget is clicked, e.g. /sales-orders
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ODSH')
CREATE TABLE FTS11ODSH (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    WidgetCode          NVARCHAR(50)        NOT NULL,   -- Short unique code, e.g. SALES-MTD
    Title               NVARCHAR(100)       NOT NULL,   -- Shown on the widget, e.g. Sales This Month
    WidgetType          NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11ODSH_WidgetType DEFAULT ('KPI'),
    Query               NVARCHAR(MAX)       NOT NULL,
    UseSapConn          BIT                 NOT NULL CONSTRAINT DF_FTS11ODSH_UseSapConn DEFAULT (0),
    Width               INT                 NOT NULL CONSTRAINT DF_FTS11ODSH_Width DEFAULT (1),
    Sequence            INT                 NOT NULL CONSTRAINT DF_FTS11ODSH_Sequence DEFAULT (0),
    ValueFormat         NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11ODSH_ValueFormat DEFAULT ('NUMBER'),
    LinkPath            NVARCHAR(254)       NULL,
    Remarks             NVARCHAR(254)       NULL,       -- Shown as the widget's tooltip
    IsActive            BIT                 NOT NULL CONSTRAINT DF_FTS11ODSH_IsActive DEFAULT (1),
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11ODSH             PRIMARY KEY (DocEntry),
    CONSTRAINT UX_FTS11ODSH_WidgetCode  UNIQUE (WidgetCode),
    CONSTRAINT CK_FTS11ODSH_WidgetType  CHECK (WidgetType IN ('KPI', 'BAR', 'LINE', 'PIE', 'TABLE')),
    CONSTRAINT CK_FTS11ODSH_Width       CHECK (Width IN (1, 2, 4)),
    CONSTRAINT CK_FTS11ODSH_ValueFormat CHECK (ValueFormat IN ('NUMBER', 'AMOUNT', 'PERCENT'))
);
GO

-- ============================================
-- FTS11DSH1 - Roles that see the widget (the widget's "Roles" tab). Users in an admin role see every widget.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11DSH1')
CREATE TABLE FTS11DSH1 (
    DocEntry            INT                 NOT NULL,   -- Widget (FTS11ODSH.DocEntry)
    RoleEntry           INT                 NOT NULL,   -- Role (FTS11OROL.DocEntry)
    CONSTRAINT PK_FTS11DSH1             PRIMARY KEY (DocEntry, RoleEntry),
    CONSTRAINT FK_FTS11DSH1_Widget      FOREIGN KEY (DocEntry) REFERENCES FTS11ODSH(DocEntry),
    CONSTRAINT FK_FTS11DSH1_Role        FOREIGN KEY (RoleEntry) REFERENCES FTS11OROL(DocEntry)
);
GO
