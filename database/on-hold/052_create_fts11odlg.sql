-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 052_create_fts11odlg
-- Date: 2026-10-07
-- ============================================

-- ============================================
-- FTS11ODLG - Approval Substitute: while an approver is away (From Date - To Date), another user may approve
--   for them. Set up by the approver (My Profile) or an administrator (System Initialization > Approval Substitute).
--   During the period the documents waiting for UserID also show in SubUserID's Approvals list; both may decide.
--   The substitute gets an e-mail when the substitute period is saved and when a document starts waiting for UserID.
--   Rules (checked by the portal): substitute active, not the approver; no substitute of a substitute;
--   periods of one approver don't overlap.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ODLG')
CREATE TABLE FTS11ODLG (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    UserID              INT                 NOT NULL,   -- Approver who is away (SystemUsers.DocEntry)
    SubUserID           INT                 NOT NULL,   -- Substitute (SystemUsers.DocEntry)
    FromDate            DATE                NOT NULL,
    ToDate              DATE                NOT NULL,   -- Last day of the period (inclusive)
    Reason              NVARCHAR(254)       NULL,       -- e.g. Annual leave
    IsActive            BIT                 NOT NULL CONSTRAINT DF_FTS11ODLG_IsActive DEFAULT (1),
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11ODLG            PRIMARY KEY (DocEntry),
    CONSTRAINT FK_FTS11ODLG_User       FOREIGN KEY (UserID) REFERENCES SystemUsers(DocEntry),
    CONSTRAINT FK_FTS11ODLG_SubUser    FOREIGN KEY (SubUserID) REFERENCES SystemUsers(DocEntry),
    CONSTRAINT CK_FTS11ODLG_NotSelf    CHECK (UserID <> SubUserID),
    CONSTRAINT CK_FTS11ODLG_Dates      CHECK (ToDate >= FromDate)
);
GO

-- ============================================
-- FTS11WDD1 - ActedBy: the user who actually approved / rejected the request. Normally the approver (UserID);
--   a substitute's user when they decided on the approver's behalf ("Approved by X on behalf of Y").
-- ============================================
IF COL_LENGTH('FTS11WDD1', 'ActedBy') IS NULL
    ALTER TABLE FTS11WDD1 ADD ActedBy INT NULL;     -- SystemUsers.DocEntry
GO
