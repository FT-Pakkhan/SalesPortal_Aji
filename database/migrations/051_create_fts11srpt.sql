-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 051_create_fts11srpt
-- Date: 2026-10-07
-- ============================================

-- ============================================
-- FTS11SRPT - Report Settings: Crystal Reports (.rpt) shown in the Reports module.
--   ReportPath: full path of the .rpt file on the server, e.g. D:\SalesPortal_Reports\SalesAnalysis.rpt
--   Category:   optional group the report is listed under in the Reports module, e.g. Sales, Inventory
--   Only active reports are listed, and only to users in one of the report's roles (FTS11RPT2) or an admin role.
--   The result is shown as a PDF.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11SRPT')
CREATE TABLE FTS11SRPT (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    ReportCode          NVARCHAR(50)        NOT NULL,   -- Short unique code, e.g. SALES-ANALYSIS
    ReportName          NVARCHAR(100)       NOT NULL,   -- Name shown in the Reports module
    ReportPath          NVARCHAR(254)       NOT NULL,   -- .rpt file on the server
    Category            NVARCHAR(50)        NULL,
    Remarks             NVARCHAR(254)       NULL,
    IsActive            BIT                 NOT NULL CONSTRAINT DF_FTS11SRPT_IsActive DEFAULT (1),
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11SRPT            PRIMARY KEY (DocEntry),
    CONSTRAINT UX_FTS11SRPT_ReportCode UNIQUE (ReportCode)
);
GO

-- ============================================
-- FTS11RPT1 - Report parameters (the report's "Parameters" tab): what the user fills in before running it.
--   ParamName: the parameter's name exactly as in the .rpt (filled by "Read Parameters from Report")
--   ParamType: STRING / INTEGER / DECIMAL / DATE / DATETIME / BOOLEAN - how it is keyed in and passed to the report
--   InputType: KEYIN = typed by the user; LIST = chosen from the result of Query
--   Query:     for LIST - a SELECT; 1st column = value passed to the report, 2nd column (optional) = description shown
--   AllowMulti: several values may be chosen / keyed in (the .rpt parameter must allow multiple values)
--   IsRange:   a From - To range (a range parameter in the .rpt, e.g. Item No. from A00001 to A00010)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11RPT1')
CREATE TABLE FTS11RPT1 (
    DocEntry            INT                 NOT NULL,   -- Report (FTS11SRPT.DocEntry)
    LineNum             INT                 NOT NULL,   -- 0, 1, 2 ... the order shown on the run screen
    ParamName           NVARCHAR(100)       NOT NULL,
    Caption             NVARCHAR(100)       NOT NULL,   -- Label the user sees, e.g. From Date
    ParamType           NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11RPT1_ParamType DEFAULT ('STRING'),
    InputType           NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11RPT1_InputType DEFAULT ('KEYIN'),
    Query               NVARCHAR(MAX)       NULL,
    AllowMulti          BIT                 NOT NULL CONSTRAINT DF_FTS11RPT1_AllowMulti DEFAULT (0),
    IsRange             BIT                 NOT NULL CONSTRAINT DF_FTS11RPT1_IsRange DEFAULT (0),
    Mandatory           BIT                 NOT NULL CONSTRAINT DF_FTS11RPT1_Mandatory DEFAULT (0),
    DefaultValue        NVARCHAR(254)       NULL,       -- Filled in when the run screen opens
    CONSTRAINT PK_FTS11RPT1            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT UX_FTS11RPT1_ParamName  UNIQUE (DocEntry, ParamName),
    CONSTRAINT FK_FTS11RPT1_Report     FOREIGN KEY (DocEntry) REFERENCES FTS11SRPT(DocEntry),
    CONSTRAINT CK_FTS11RPT1_ParamType  CHECK (ParamType IN ('STRING', 'INTEGER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN')),
    CONSTRAINT CK_FTS11RPT1_InputType  CHECK (InputType IN ('KEYIN', 'LIST'))
);
GO

-- ============================================
-- FTS11RPT2 - Roles that may run the report (the report's "Roles" tab). Users in an admin role may run every report.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11RPT2')
CREATE TABLE FTS11RPT2 (
    DocEntry            INT                 NOT NULL,   -- Report (FTS11SRPT.DocEntry)
    RoleEntry           INT                 NOT NULL,   -- Role (FTS11OROL.DocEntry)
    CONSTRAINT PK_FTS11RPT2            PRIMARY KEY (DocEntry, RoleEntry),
    CONSTRAINT FK_FTS11RPT2_Report     FOREIGN KEY (DocEntry) REFERENCES FTS11SRPT(DocEntry),
    CONSTRAINT FK_FTS11RPT2_Role       FOREIGN KEY (RoleEntry) REFERENCES FTS11OROL(DocEntry)
);
GO
