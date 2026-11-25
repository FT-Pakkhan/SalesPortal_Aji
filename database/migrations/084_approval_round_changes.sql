-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 084_approval_round_changes
-- Date: 2026-11-13
-- ============================================

-- ============================================
-- FTS11WDD1 - Round: which time the document was sent for approval (1, 2, ...). A rejected Convert to Customer can
--   be changed and sent again: its new approval rows get the next Round, and only the latest Round counts for the
--   stages; the earlier ones stay as history on the Approval tab. Existing rows are Round 1.
-- ============================================
IF COL_LENGTH('FTS11WDD1', 'Round') IS NULL
    ALTER TABLE FTS11WDD1 ADD Round INT NOT NULL CONSTRAINT DF_FTS11WDD1_Round DEFAULT (1);
GO

-- ============================================
-- FTS11WDD2 - Changes made to a document by an approver while approving it (Temporary Receipt): who, when and the
--   reason. Shown on the document's Approval tab; the person who sent it for approval is told in the bell.
--   ObjType + DocEntry   the document (FTS_vw_ObjType.Code, e.g. FTS11TMPR, and its DocEntry)
--   UserID               the approver who changed it (SystemUsers.DocEntry)
--   ChangeDate           when
--   Remarks              the reason for the change (optional)
-- ============================================
IF OBJECT_ID('FTS11WDD2') IS NULL
BEGIN
    CREATE TABLE FTS11WDD2 (
        AbsEntry     INT           IDENTITY(1,1) NOT NULL,
        ObjType      NVARCHAR(20)  NOT NULL,
        DocEntry     INT           NOT NULL,
        UserID       INT           NOT NULL,
        ChangeDate   DATETIME      NOT NULL CONSTRAINT DF_FTS11WDD2_ChangeDate DEFAULT (GETDATE()),
        Remarks      NVARCHAR(254) NULL,
        CONSTRAINT PK_FTS11WDD2 PRIMARY KEY (AbsEntry),
        CONSTRAINT FK_FTS11WDD2_User FOREIGN KEY (UserID) REFERENCES SystemUsers (DocEntry)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11WDD2_Document')
    CREATE INDEX IX_FTS11WDD2_Document ON FTS11WDD2 (ObjType, DocEntry);
GO

-- ============================================
-- FTS11ONTF - one more notification type:
--   APPR_CHANGED   an approver changed the document while approving it (with the reason) -> who sent it for approval
-- ============================================
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FTS11ONTF_NtfType')
    ALTER TABLE FTS11ONTF DROP CONSTRAINT CK_FTS11ONTF_NtfType;
GO
ALTER TABLE FTS11ONTF ADD CONSTRAINT CK_FTS11ONTF_NtfType
    CHECK (NtfType IN ('APPR_WAITING', 'APPR_STAGE', 'APPR_DONE', 'APPR_REJECTED', 'APPR_CHANGED', 'POST_FAILED'));
GO

-- ============================================
-- FTS11OCRD - BaseEntry: an Update Customer document - the Convert to Customer (FTS11OCRD.DocEntry) it was made from.
--   Empty = a new customer. When approved, an update changes the existing SAP business partner instead of adding one.
--   Approval template queries can tell them apart with BaseEntry IS NULL / IS NOT NULL.
-- ============================================
IF COL_LENGTH('FTS11OCRD', 'BaseEntry') IS NULL
    ALTER TABLE FTS11OCRD ADD BaseEntry INT NULL;
GO

-- ============================================
-- FTS_sp_ResetDatabase (063, 070, 071) - also empties the approval changes (FTS11WDD2) and the Convert to Customer
--   addresses (FTS11CRD2, 078; before, a reset failed once a conversion had addresses)
-- ============================================
-- QUOTED_IDENTIFIER ON is kept with the procedure: the portal's filtered indexes refuse DELETE without it
SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE FTS_sp_ResetDatabase
    @Confirm NVARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISNULL(@Confirm, '') <> 'RESET'
    BEGIN
        RAISERROR('Nothing was deleted. To reset the portal database run: EXEC FTS_sp_ResetDatabase @Confirm = ''RESET''', 16, 1);
        RETURN;
    END;

    DECLARE @AdminID INT = (SELECT DocEntry FROM SystemUsers WHERE UserName = 'Admin');
    IF @AdminID IS NULL
    BEGIN
        RAISERROR('Nothing was deleted: the user Admin was not found.', 16, 1);
        RETURN;
    END;

    BEGIN TRANSACTION;

    -- Approval: decisions, then stages / templates
    DELETE FROM FTS11WDD2;
    DELETE FROM FTS11WDD1;
    DELETE FROM FTS11WTM1;
    DELETE FROM FTS11WST1;
    DELETE FROM FTS11OWTM;
    DELETE FROM FTS11OWST;

    -- Notifications, e-mail log, reports
    DELETE FROM FTS11ONTF;
    DELETE FROM FTS11OEML;
    DELETE FROM FTS11RPT2;
    DELETE FROM FTS11RPT1;
    DELETE FROM FTS11SRPT;

    -- Dashboard widgets and their roles
    DELETE FROM FTS11DSH1;
    DELETE FROM FTS11ODSH;

    -- Documents and their lines
    DELETE FROM FTS11QUT1;
    DELETE FROM FTS11OQUT;
    DELETE FROM FTS11RDR1;
    DELETE FROM FTS11ORDR;
    DELETE FROM FTS11RIN1;
    DELETE FROM FTS11ORIN;
    DELETE FROM FTS11TMP1;
    DELETE FROM FTS11TMP2;
    DELETE FROM FTS11TMPR;
    DELETE FROM FTS11TRQ1;
    DELETE FROM FTS11OTRQ;
    DELETE FROM FTS11WTR1;
    DELETE FROM FTS11OWTR;
    DELETE FROM FTS11CRD2;
    DELETE FROM FTS11CRD1;
    DELETE FROM FTS11OCRD;
    DELETE FROM FTS11LED1;
    DELETE FROM FTS11LEAD;
    DELETE FROM FTS11SCIN;
    DELETE FROM FTS11ATC1;

    -- Setup: print layouts, numbering series
    DELETE FROM FTS11SLYT;
    DELETE FROM FTS11NNM2;
    DELETE FROM FTS11NNM1;

    -- Roles: only the admin role(s) stay, with Admin as their only member
    DELETE T0
        FROM FTS11ROL1 T0
        JOIN FTS11OROL T1 ON T1.DocEntry = T0.DocEntry
        WHERE T1.IsAdmin = 0
        OR T0.UserID <> @AdminID;
    DELETE T0
        FROM FTS11ROL2 T0
        JOIN FTS11OROL T1 ON T1.DocEntry = T0.DocEntry
        WHERE T1.IsAdmin = 0;
    DELETE FROM FTS11OROL WHERE IsAdmin = 0;
    IF NOT EXISTS (SELECT 1 FROM FTS11ROL1 T0 JOIN FTS11OROL T1 ON T1.DocEntry = T0.DocEntry WHERE T1.IsAdmin = 1 AND T0.UserID = @AdminID)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM FTS11OROL WHERE IsAdmin = 1)
            INSERT INTO FTS11OROL (RoleName, IsAdmin) VALUES ('Administrator', 1);
        INSERT INTO FTS11ROL1 (DocEntry, UserID) SELECT MIN(DocEntry), @AdminID FROM FTS11OROL WHERE IsAdmin = 1;
    END;

    -- Users: only Admin
    DELETE FROM SystemUsers WHERE DocEntry <> @AdminID;

    -- Identities: next value = highest kept + 1 (1 for an emptied table). A table that never had a row is left alone
    -- (reseeding it would make its first value 0).
    DECLARE @Table SYSNAME, @Column SYSNAME, @Sql NVARCHAR(MAX);
    DECLARE IdentityTables CURSOR LOCAL FAST_FORWARD FOR
        SELECT
            OBJECT_NAME(T0.object_id) AS [TableName],
            T0.name AS [ColumnName]
            FROM sys.identity_columns T0
            JOIN sys.tables T1 ON T1.object_id = T0.object_id
            WHERE T0.last_value IS NOT NULL
            AND (T1.name LIKE 'FTS11%' OR T1.name = 'SystemUsers');
    OPEN IdentityTables;
    FETCH NEXT FROM IdentityTables INTO @Table, @Column;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Sql = N'DECLARE @Seed INT = ISNULL((SELECT MAX(' + QUOTENAME(@Column) + N') FROM ' + QUOTENAME(@Table) + N'), 0); '
                 + N'DBCC CHECKIDENT (''' + @Table + N''', RESEED, @Seed) WITH NO_INFOMSGS;';
        EXEC sp_executesql @Sql;
        FETCH NEXT FROM IdentityTables INTO @Table, @Column;
    END;
    CLOSE IdentityTables;
    DEALLOCATE IdentityTables;

    COMMIT TRANSACTION;

    PRINT 'Portal database reset: only the user Admin, the admin role(s) and General Settings are kept.';
END;
GO
