-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 063_fts_sp_resetdatabase
-- Date: 2026-10-09
-- ============================================

-- ============================================
-- FTS_sp_ResetDatabase - empty the portal back to a clean start, keeping only:
--   SystemUsers  the user Admin
--   FTS11OROL    the admin role(s) (Is Admin ticked), with Admin as their only member, so Admin keeps full access
--   FTS11OADM    General Settings (SAP connection, SMTP, attachments, incoming payment)
-- Everything else is deleted: all documents and their lines (quotations, orders, temporary receipts, receipt
-- requests, inventory transfers, leads, sales check-ins), attachments records, approval stages / templates /
-- decisions, notifications, e-mail log, report settings, dashboard widgets, print layouts, numbering series, the other roles and users.
-- Identities are reset: an emptied table starts again at 1; SystemUsers / FTS11OROL continue after what is kept.
-- Only the portal database: nothing in SAP B1, and the attachment files on disk are not deleted.
--
-- Run:  EXEC FTS_sp_ResetDatabase @Confirm = 'RESET'   (anything else does nothing - a guard against running it by mistake)
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
    DELETE FROM FTS11TMP1;
    DELETE FROM FTS11TMP2;
    DELETE FROM FTS11TMPR;
    DELETE FROM FTS11TRQ1;
    DELETE FROM FTS11OTRQ;
    DELETE FROM FTS11WTR1;
    DELETE FROM FTS11OWTR;
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
