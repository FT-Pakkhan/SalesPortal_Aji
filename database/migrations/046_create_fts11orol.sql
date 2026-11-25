-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 046_create_fts11orol
-- Date: 2026-10-06
-- ============================================

-- ============================================
-- FTS11OROL - Roles (Administration > Role)
--   IsAdmin = 1: administrator - every screen with Full access, whatever FTS11ROL2 says.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OROL')
CREATE TABLE FTS11OROL (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    RoleName            NVARCHAR(100)       NOT NULL,   -- e.g. Administrator, Sales Executive, Finance
    IsAdmin             BIT                 NOT NULL CONSTRAINT DF_FTS11OROL_IsAdmin DEFAULT (0),
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11OROL            PRIMARY KEY (DocEntry),
    CONSTRAINT UX_FTS11OROL_RoleName   UNIQUE (RoleName)
);
GO

-- ============================================
-- FTS11ROL1 - Users of a role (the role's "Users" tab)
--   A user may have several roles: their access to a screen is the best of their roles (FULL > READ > NONE), and
--   any administrator role makes them an administrator. A user with no role has no access.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ROL1')
CREATE TABLE FTS11ROL1 (
    DocEntry            INT                 NOT NULL,   -- Role (FTS11OROL.DocEntry)
    UserID              INT                 NOT NULL,   -- User (SystemUsers.DocEntry)
    CONSTRAINT PK_FTS11ROL1            PRIMARY KEY (DocEntry, UserID),
    CONSTRAINT FK_FTS11ROL1_Role       FOREIGN KEY (DocEntry) REFERENCES FTS11OROL(DocEntry),
    CONSTRAINT FK_FTS11ROL1_User       FOREIGN KEY (UserID) REFERENCES SystemUsers(DocEntry)
);
GO

-- ============================================
-- FTS11ROL2 - Screens of a role (the role's "Screens" tab)
--   ScreenCode: the portal screen (e.g. LEAD, OQUT, ORDR, CVST, TMPR, USERS, ROLES ...).
--   Access: FULL (view and change), READ (view only), NONE (hidden). A screen with no row = NONE.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ROL2')
CREATE TABLE FTS11ROL2 (
    DocEntry            INT                 NOT NULL,   -- Role (FTS11OROL.DocEntry)
    ScreenCode          NVARCHAR(50)        NOT NULL,
    Access              NVARCHAR(10)        NOT NULL CONSTRAINT DF_FTS11ROL2_Access DEFAULT ('FULL'),
    CONSTRAINT PK_FTS11ROL2            PRIMARY KEY (DocEntry, ScreenCode),
    CONSTRAINT CK_FTS11ROL2_Access     CHECK (Access IN ('FULL', 'READ', 'NONE')),
    CONSTRAINT FK_FTS11ROL2_Role       FOREIGN KEY (DocEntry) REFERENCES FTS11OROL(DocEntry)
);
GO

-- Users with no role have no access: start with an Administrator role holding the Admin user, so Role can be set up
IF NOT EXISTS (SELECT 1 FROM FTS11OROL WHERE RoleName = 'Administrator')
    INSERT INTO FTS11OROL (RoleName, IsAdmin, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES ('Administrator', 1, 'Admin', GETDATE(), 'Admin', GETDATE());
GO

INSERT INTO FTS11ROL1 (DocEntry, UserID)
SELECT r.DocEntry, u.DocEntry
FROM FTS11OROL r
JOIN SystemUsers u ON u.UserName = 'Admin'
WHERE r.RoleName = 'Administrator'
  AND NOT EXISTS (SELECT 1 FROM FTS11ROL1 x WHERE x.DocEntry = r.DocEntry AND x.UserID = u.DocEntry);
GO
