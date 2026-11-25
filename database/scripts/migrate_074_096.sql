-- ============================================
-- Portal_Sales_AJI - migrations 074 to 096 in one script (run on the portal database, in this order).
-- Each part is the migration file as it is; all are safe to run again (they skip what is already there).
-- 075 reads the SAP database from General Settings (SAP Database): set it to the live SAP database first.
-- Check before and after with database\scripts\check_migrations.sql.
-- ============================================


-- ############################################
-- 074_salesdoc_groupnum.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 074_salesdoc_groupnum
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- GroupNum - Payment Terms of a sales document (SAP OCTG.GroupNum), as in SAP B1. Optional: empty = the customer's
--   own payment terms in SAP. Defaults on screen from the customer (OCRD.GroupNum) or the lead's Credit Term.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'GroupNum') IS NULL
    ALTER TABLE FTS11OQUT ADD GroupNum INT NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'GroupNum') IS NULL
    ALTER TABLE FTS11ORDR ADD GroupNum INT NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'GroupNum') IS NULL
    ALTER TABLE FTS11ORIN ADD GroupNum INT NULL;
GO


-- ############################################
-- 075_fn_unreconciled_docs_downpayment.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 075_fn_unreconciled_docs_downpayment
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- FTS_fn_UnreconciledDocs(@CardCode) - now also lists A/R Down Payment Invoices (203) not fully paid, so a
-- Temporary Receipt can pay them (posted to SAP as InvoiceType 203 with the ODPI DocEntry).
--
--   A/R Invoice               (13)  not fully paid
--   A/R Credit Memo           (14)  not fully used
--   A/R Down Payment Invoice (203)  not fully paid
--   Journal Entry             (30)  posted to the customer
--   Payment                (24/46)  not fully used; shown as a Journal Entry (TransType 30, DocNum = journal No.)
-- A/R Down Payment Requests post no journal entry, so they are not on the customer's account and are not listed.
--
-- OriTransType / OriDocEntry = the original document:
--   13 = OINV.DocEntry, 14 = ORIN.DocEntry, 203 = ODPI.DocEntry, 24 = ORCT.DocEntry, 46 = OVPM.DocEntry, 30 = OJDT.TransId
--
-- The SAP company database it reads: the SAP Database in General Settings (FTS11OADM.SapCompanyDB); if that is
-- empty, the one the function reads now (e.g. set by set-sap-database.sql); else SBODemoGB.
-- ============================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @SapDb SYSNAME = (SELECT TOP 1 NULLIF(LTRIM(RTRIM(T0.SapCompanyDB)), '') FROM FTS11OADM T0 WHERE T0.DocEntry = 1);
DECLARE @Def NVARCHAR(MAX) = OBJECT_DEFINITION(OBJECT_ID('dbo.FTS_fn_UnreconciledDocs'));
DECLARE @At INT = CHARINDEX('.dbo.JDT1', ISNULL(@Def, ''));
IF @SapDb IS NULL AND @At > 0
    SET @SapDb = REPLACE(REPLACE(LTRIM(RIGHT(LEFT(@Def, @At - 1), CHARINDEX(' ', REVERSE(LEFT(@Def, @At - 1))) - 1)), '[', ''), ']', '');
IF @SapDb IS NULL SET @SapDb = N'SBODemoGB';
IF DB_ID(@SapDb) IS NULL
BEGIN
    RAISERROR('SAP database %s does not exist on this server: check the SAP Database in General Settings.', 16, 1, @SapDb);
    RETURN;
END;

DECLARE @Sql NVARCHAR(MAX) = N'
CREATE OR ALTER FUNCTION [dbo].[FTS_fn_UnreconciledDocs] (@CardCode NVARCHAR(50))
RETURNS TABLE
AS
RETURN
(
    SELECT
        T0.ShortName AS [CardCode],
        T1.CardName AS [CardName],
        CASE WHEN T0.TransType IN (''24'', ''46'') THEN ''30'' ELSE T0.TransType END AS [TransType],
        T0.TransType AS [OriTransType],
        CASE T0.TransType WHEN ''13'' THEN ''A/R Invoice'' WHEN ''14'' THEN ''A/R Credit Memo'' WHEN ''203'' THEN ''A/R Down Payment Invoice'' ELSE ''Journal Entry'' END AS [DocType],
        CASE WHEN T0.TransType IN (''24'', ''46'') THEN CAST(T0.TransId AS NVARCHAR(20)) ELSE T0.BaseRef END AS [DocNum],
        T0.CreatedBy AS [OriDocEntry],
        T0.TransId AS [TransId],
        T0.Line_ID AS [Line_ID],
        T0.RefDate AS [PostingDate],
        T0.DueDate AS [DueDate],
        CASE WHEN T0.DueDate < CAST(GETDATE() AS DATE) THEN DATEDIFF(DAY, T0.DueDate, CAST(GETDATE() AS DATE)) ELSE 0 END AS [DaysOverdue],
        T0.Debit - T0.Credit AS [OriginalAmount],
        T0.BalDueDeb - T0.BalDueCred AS [BalanceDue],
        T0.FCCurrency AS [FCCurrency],
        T0.BalFcDeb - T0.BalFcCred AS [BalanceDueFC],
        T0.LineMemo AS [Remarks]
        FROM ' + QUOTENAME(@SapDb) + N'.dbo.JDT1 T0
        JOIN ' + QUOTENAME(@SapDb) + N'.dbo.OCRD T1 ON T1.CardCode = T0.ShortName
        WHERE T1.CardType = ''C''
        AND T0.TransType IN (''13'', ''14'', ''203'', ''30'', ''24'', ''46'')
        AND (T0.BalDueDeb <> 0 OR T0.BalDueCred <> 0)
        AND (@CardCode IS NULL OR T0.ShortName = @CardCode)
);';
EXEC sp_executesql @Sql;
PRINT 'FTS_fn_UnreconciledDocs reads ' + @SapDb;
GO


-- ############################################
-- 076_tmpr_dates.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 076_tmpr_dates
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- DocDate - Posting Date of a Temporary Receipt (FTS11TMPR), as in SAP B1's Incoming Payment: required, locked once
--   confirmed (the No. is made from it), the incoming payment's Posting Date in SAP.
-- TaxDate - Document Date: optional, the incoming payment's Document Date in SAP (empty = the Posting Date).
-- Receipts saved before this get the date they were confirmed on, or else the date they were created on.
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'DocDate') IS NULL
    ALTER TABLE FTS11TMPR ADD DocDate DATETIME NULL;
GO

IF COL_LENGTH('FTS11TMPR', 'TaxDate') IS NULL
    ALTER TABLE FTS11TMPR ADD TaxDate DATETIME NULL;
GO

UPDATE T0
SET T0.DocDate = CAST(ISNULL(T0.ConfirmedDate, T0.CreatedDate) AS DATE),
    T0.TaxDate = CAST(ISNULL(T0.ConfirmedDate, T0.CreatedDate) AS DATE)
FROM FTS11TMPR T0
WHERE T0.DocDate IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11TMPR') AND name = 'DocDate' AND is_nullable = 1)
    ALTER TABLE FTS11TMPR ALTER COLUMN DocDate DATETIME NOT NULL;
GO


-- ############################################
-- 077_fts11ocrd_groupcode.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 077_fts11ocrd_groupcode
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- GroupCode - BP Group of the customer to create (SAP OCRG.GroupCode, a customer group), chosen on Convert to
--   Customer and sent to SAP as the business partner's Group. Required on Confirm; a draft may be saved without it.
-- ============================================
IF COL_LENGTH('FTS11OCRD', 'GroupCode') IS NULL
    ALTER TABLE FTS11OCRD ADD GroupCode INT NULL;
GO


-- ############################################
-- 078_create_fts11crd2.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 078_create_fts11crd2
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- FTS11CRD2 - Convert to Customer addresses, as SAP B1's BP addresses (CRD1): any number of Bill To and Ship To
--   addresses, each with its Address ID (unique within its type), one default per type. Posted to SAP as the
--   business partner's addresses; the defaults are its default Bill To / Ship To. The defaults are also kept in
--   FTS11OCRD's Bill* / Ship* columns (copied to the lead when the customer is created in SAP).
-- ============================================
IF OBJECT_ID('FTS11CRD2', 'U') IS NULL
BEGIN
    CREATE TABLE FTS11CRD2 (
        DocEntry            INT                 NOT NULL,   -- FTS11OCRD.DocEntry
        LineNum             INT                 NOT NULL,
        VisOrder            INT                 NOT NULL,
        AdresType           CHAR(1)             NOT NULL,   -- B = Bill To, S = Ship To
        Address             NVARCHAR(50)        NOT NULL,   -- Address ID
        Street              NVARCHAR(254)       NULL,
        Block               NVARCHAR(100)       NULL,
        City                NVARCHAR(100)       NULL,
        ZipCode             NVARCHAR(20)        NULL,
        State               NVARCHAR(3)         NULL,       -- SAP OCST.Code
        Country             NVARCHAR(3)         NULL,       -- SAP OCRY.Code
        IsDefault           BIT                 NOT NULL    CONSTRAINT DF_FTS11CRD2_IsDefault DEFAULT 0,
        CONSTRAINT PK_FTS11CRD2            PRIMARY KEY (DocEntry, LineNum),
        CONSTRAINT FK_FTS11CRD2_Header     FOREIGN KEY (DocEntry) REFERENCES FTS11OCRD(DocEntry),
        CONSTRAINT CK_FTS11CRD2_AdresType  CHECK (AdresType IN ('B', 'S'))
    );
END
GO

-- ============================================
-- Existing conversions: their Business Address becomes Bill To "Bill To" and their Delivery Address (or the business
--   address) Ship To "Ship To", both default - as they were posted to SAP until now
-- ============================================
IF NOT EXISTS (SELECT 1 FROM FTS11CRD2)
BEGIN
    INSERT INTO FTS11CRD2 (DocEntry, LineNum, VisOrder, AdresType, Address, Street, Block, City, ZipCode, State, Country, IsDefault)
    SELECT
        T0.DocEntry AS [DocEntry],
        0 AS [LineNum],
        0 AS [VisOrder],
        'B' AS [AdresType],
        'Bill To' AS [Address],
        T0.BillStreet AS [Street],
        T0.BillBlock AS [Block],
        T0.BillCity AS [City],
        T0.BillZipCode AS [ZipCode],
        T0.BillState AS [State],
        T0.BillCountry AS [Country],
        1 AS [IsDefault]
    FROM FTS11OCRD T0
    WHERE COALESCE(T0.BillStreet, T0.BillBlock, T0.BillCity, T0.BillZipCode, T0.BillState, T0.BillCountry) IS NOT NULL;

    INSERT INTO FTS11CRD2 (DocEntry, LineNum, VisOrder, AdresType, Address, Street, Block, City, ZipCode, State, Country, IsDefault)
    SELECT
        T0.DocEntry AS [DocEntry],
        1 AS [LineNum],
        1 AS [VisOrder],
        'S' AS [AdresType],
        'Ship To' AS [Address],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillStreet ELSE T0.ShipStreet END AS [Street],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillBlock ELSE T0.ShipBlock END AS [Block],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillCity ELSE T0.ShipCity END AS [City],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillZipCode ELSE T0.ShipZipCode END AS [ZipCode],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillState ELSE T0.ShipState END AS [State],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillCountry ELSE T0.ShipCountry END AS [Country],
        1 AS [IsDefault]
    FROM FTS11OCRD T0
    WHERE T0.ShipSameAsBill = 1 AND COALESCE(T0.BillStreet, T0.BillBlock, T0.BillCity, T0.BillZipCode, T0.BillState, T0.BillCountry) IS NOT NULL
       OR T0.ShipSameAsBill = 0 AND COALESCE(T0.ShipStreet, T0.ShipBlock, T0.ShipCity, T0.ShipZipCode, T0.ShipState, T0.ShipCountry) IS NOT NULL;
END
GO


-- ############################################
-- 079_add_streetno.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 079_add_streetno
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- Address Line 2 (SAP CRD1.StreetNo). The address lines, as posted to SAP:
--   Address Line 1 = Street, Address Line 2 = StreetNo, Address Line 3 = Block, Address Line 4 = City
-- FTS11CRD2: Convert to Customer addresses
-- FTS11OCRD / FTS11LEAD: the default Bill To / Ship To kept in the application form (copied to the lead)
-- ============================================
IF COL_LENGTH('FTS11CRD2', 'StreetNo') IS NULL
    ALTER TABLE FTS11CRD2 ADD StreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11OCRD', 'BillStreetNo') IS NULL
    ALTER TABLE FTS11OCRD ADD BillStreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11OCRD', 'ShipStreetNo') IS NULL
    ALTER TABLE FTS11OCRD ADD ShipStreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11LEAD', 'BillStreetNo') IS NULL
    ALTER TABLE FTS11LEAD ADD BillStreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11LEAD', 'ShipStreetNo') IS NULL
    ALTER TABLE FTS11LEAD ADD ShipStreetNo NVARCHAR(100) NULL;
GO


-- ############################################
-- 080_fts11crd2_deliveryzone.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 080_fts11crd2_deliveryzone
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- FTS11CRD2 - Delivery Zone of a Convert to Customer address: the Code of a row of SAP UDT @DELIVERYZONE, posted to
--   SAP as the address's UDF CRD1.U_DeliveryZone
-- ============================================
IF COL_LENGTH('FTS11CRD2', 'DeliveryZone') IS NULL
    ALTER TABLE FTS11CRD2 ADD DeliveryZone NVARCHAR(50) NULL;
GO


-- ############################################
-- 081_salesdoc_coa.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 081_salesdoc_coa
-- Date: 2026-11-12
-- ============================================

-- ============================================
-- COA - COA of a sales document: 'Y' (Yes) / 'N' (No), empty = not chosen. Posted to SAP
--   as the document's UDF U_COA (valid values Y / N).
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'COA') IS NULL
    ALTER TABLE FTS11OQUT ADD COA NVARCHAR(1) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'COA') IS NULL
    ALTER TABLE FTS11ORDR ADD COA NVARCHAR(1) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'COA') IS NULL
    ALTER TABLE FTS11ORIN ADD COA NVARCHAR(1) NULL;
GO


-- ############################################
-- 082_branch.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 082_branch
-- Date: 2026-11-12
-- ============================================

-- ============================================
-- Branch - an SAP cost centre of Dimension 1 (OOCR.OcrCode where DimCode = 1). Optional everywhere.
--   SystemUsers.Branch: the user's branch; a new Sales Quotation / Sales Order / Credit Memo starts with it.
--   FTS11OQUT / FTS11ORDR / FTS11ORIN.Branch: the document's branch (changeable on a draft, locked once confirmed).
--   Posting a Sales Order / Credit Memo to SAP puts it on every line as the Dimension 1 cost centre (CostingCode).
-- ============================================
IF COL_LENGTH('SystemUsers', 'Branch') IS NULL
    ALTER TABLE SystemUsers ADD Branch NVARCHAR(8) NULL;
GO

IF COL_LENGTH('FTS11OQUT', 'Branch') IS NULL
    ALTER TABLE FTS11OQUT ADD Branch NVARCHAR(8) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'Branch') IS NULL
    ALTER TABLE FTS11ORDR ADD Branch NVARCHAR(8) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'Branch') IS NULL
    ALTER TABLE FTS11ORIN ADD Branch NVARCHAR(8) NULL;
GO


-- ############################################
-- 083_salesdoc_incomments_tac.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 083_salesdoc_incomments_tac
-- Date: 2026-11-12
-- ============================================

-- ============================================
-- InComments - Internal Remarks of a sales document, posted to SAP as the document's UDF U_InComments.
-- TAC - T&C of a sales document, posted to SAP as the document's UDF U_TAC (Terms & Condition).
-- 254 characters each, as SAP. Comments is shown as Trade Remarks.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'InComments') IS NULL
    ALTER TABLE FTS11OQUT ADD InComments NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11OQUT', 'TAC') IS NULL
    ALTER TABLE FTS11OQUT ADD TAC NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'InComments') IS NULL
    ALTER TABLE FTS11ORDR ADD InComments NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'TAC') IS NULL
    ALTER TABLE FTS11ORDR ADD TAC NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'InComments') IS NULL
    ALTER TABLE FTS11ORIN ADD InComments NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'TAC') IS NULL
    ALTER TABLE FTS11ORIN ADD TAC NVARCHAR(254) NULL;
GO


-- ############################################
-- 084_approval_round_changes.sql
-- ############################################
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

-- ############################################
-- 085_approval_email.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 085_approval_email
-- Date: 2026-11-14
-- ============================================

-- ============================================
-- E-mail approval notifications (General Settings > SMTP):
--   ApprEmail - 1 = e-mail the approvers when a document waits for them, and the sender when it is approved,
--               rejected or changed while approving (the same events as the bell). 0 = bell only.
--   PortalUrl - the portal's address as users open it (e.g. https://portal.company.com), for the e-mail's link.
-- Each user's e-mail address is SystemUsers.Email; a user without one gets the bell only.
-- ============================================
IF COL_LENGTH('FTS11OADM', 'ApprEmail') IS NULL
    ALTER TABLE FTS11OADM ADD ApprEmail BIT NOT NULL CONSTRAINT DF_FTS11OADM_ApprEmail DEFAULT (0);
GO

IF COL_LENGTH('FTS11OADM', 'PortalUrl') IS NULL
    ALTER TABLE FTS11OADM ADD PortalUrl NVARCHAR(200) NULL;
GO


-- ############################################
-- 086_salesdoc_line_salesqty.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 086_salesdoc_line_salesqty
-- Date: 2026-11-14
-- ============================================

-- ============================================
-- SalesQty - Sales Quantity of a sales document line, posted to SAP as the line's UDF U_SalesQty. For information
--            only: it doesn't change the line's Quantity, price or total. Optional.
-- SalesUoM - Sales UoM of the line (an SAP unit of measure, OUOM.UomCode), posted to SAP as the line's UDF U_SalesUoM
--            (10 characters, as SAP). Optional.
-- On FTS11QUT1, FTS11RDR1 and FTS11RIN1 (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11QUT1', 'SalesQty') IS NULL
    ALTER TABLE FTS11QUT1 ADD SalesQty NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11QUT1', 'SalesUoM') IS NULL
    ALTER TABLE FTS11QUT1 ADD SalesUoM NVARCHAR(10) NULL;
GO

IF COL_LENGTH('FTS11RDR1', 'SalesQty') IS NULL
    ALTER TABLE FTS11RDR1 ADD SalesQty NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RDR1', 'SalesUoM') IS NULL
    ALTER TABLE FTS11RDR1 ADD SalesUoM NVARCHAR(10) NULL;
GO

IF COL_LENGTH('FTS11RIN1', 'SalesQty') IS NULL
    ALTER TABLE FTS11RIN1 ADD SalesQty NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RIN1', 'SalesUoM') IS NULL
    ALTER TABLE FTS11RIN1 ADD SalesUoM NVARCHAR(10) NULL;
GO


-- ############################################
-- 087_salesdoc_currency.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 087_salesdoc_currency
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Currency of a sales document (Sales Quotation, Sales Order, Credit Memo), as in SAP B1:
--   DocCur     - document currency (SAP OCRN.CurrCode); NULL = the local currency (documents made before this).
--   DocRate    - SAP's exchange rate (ORTT) for the Posting Date; 1 for the local currency.
--   DiscSumFC / VatSumFC / DocTotalFC - discount, tax and total in the document currency (0 when it is local).
--   DiscSum / VatSum / DocTotal stay in the local currency (approval template queries keep working).
-- Lines: PriceBefDi / Price are in the document currency; LineTotal stays in the local currency;
--   TotalFrgn - the line total in the document currency (0 when it is local).
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'DocCur') IS NULL
    ALTER TABLE FTS11OQUT ADD DocCur NVARCHAR(3) NULL;
GO

IF COL_LENGTH('FTS11OQUT', 'DocRate') IS NULL
    ALTER TABLE FTS11OQUT ADD DocRate NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OQUT_DocRate DEFAULT (1);
GO

IF COL_LENGTH('FTS11OQUT', 'DiscSumFC') IS NULL
    ALTER TABLE FTS11OQUT ADD DiscSumFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OQUT_DiscSumFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11OQUT', 'VatSumFC') IS NULL
    ALTER TABLE FTS11OQUT ADD VatSumFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OQUT_VatSumFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11OQUT', 'DocTotalFC') IS NULL
    ALTER TABLE FTS11OQUT ADD DocTotalFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OQUT_DocTotalFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11ORDR', 'DocCur') IS NULL
    ALTER TABLE FTS11ORDR ADD DocCur NVARCHAR(3) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'DocRate') IS NULL
    ALTER TABLE FTS11ORDR ADD DocRate NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORDR_DocRate DEFAULT (1);
GO

IF COL_LENGTH('FTS11ORDR', 'DiscSumFC') IS NULL
    ALTER TABLE FTS11ORDR ADD DiscSumFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORDR_DiscSumFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11ORDR', 'VatSumFC') IS NULL
    ALTER TABLE FTS11ORDR ADD VatSumFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORDR_VatSumFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11ORDR', 'DocTotalFC') IS NULL
    ALTER TABLE FTS11ORDR ADD DocTotalFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORDR_DocTotalFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11ORIN', 'DocCur') IS NULL
    ALTER TABLE FTS11ORIN ADD DocCur NVARCHAR(3) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'DocRate') IS NULL
    ALTER TABLE FTS11ORIN ADD DocRate NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORIN_DocRate DEFAULT (1);
GO

IF COL_LENGTH('FTS11ORIN', 'DiscSumFC') IS NULL
    ALTER TABLE FTS11ORIN ADD DiscSumFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORIN_DiscSumFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11ORIN', 'VatSumFC') IS NULL
    ALTER TABLE FTS11ORIN ADD VatSumFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORIN_VatSumFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11ORIN', 'DocTotalFC') IS NULL
    ALTER TABLE FTS11ORIN ADD DocTotalFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11ORIN_DocTotalFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11QUT1', 'TotalFrgn') IS NULL
    ALTER TABLE FTS11QUT1 ADD TotalFrgn NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11QUT1_TotalFrgn DEFAULT (0);
GO

IF COL_LENGTH('FTS11RDR1', 'TotalFrgn') IS NULL
    ALTER TABLE FTS11RDR1 ADD TotalFrgn NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11RDR1_TotalFrgn DEFAULT (0);
GO

IF COL_LENGTH('FTS11RIN1', 'TotalFrgn') IS NULL
    ALTER TABLE FTS11RIN1 ADD TotalFrgn NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11RIN1_TotalFrgn DEFAULT (0);
GO


-- ############################################
-- 088_receipt_currency.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 088_receipt_currency
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Currency of a Temporary Receipt (FTS11TMPR) and a Temporary Receipt Request (FTS11OTRQ), as SAP's Incoming Payment:
--   DocCur     - the currency the money came in (SAP OCRN.CurrCode); NULL = the local currency (made before this).
--   DocRate    - SAP's exchange rate (ORTT) for the Posting Date; 1 for the local currency.
--   DocTotalFC - the Amount in that currency (0 when it is the local currency).
--   DocTotal stays in the local currency (approval template queries keep working). The payment means (CashSum,
--   CheckSum, TrsfrSum, CreditSum, BcgSum, the cheques), NoDocSum and the lines' BalanceDue / SumApplied are in DocCur.
-- FTS11TMP1.DocCur - the currency of the SAP document the line pays (NULL = the local currency); a receipt pays
--   documents in its own currency or in the local currency.
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'DocCur') IS NULL
    ALTER TABLE FTS11TMPR ADD DocCur NVARCHAR(3) NULL;
GO

IF COL_LENGTH('FTS11TMPR', 'DocRate') IS NULL
    ALTER TABLE FTS11TMPR ADD DocRate NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11TMPR_DocRate DEFAULT (1);
GO

IF COL_LENGTH('FTS11TMPR', 'DocTotalFC') IS NULL
    ALTER TABLE FTS11TMPR ADD DocTotalFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11TMPR_DocTotalFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11OTRQ', 'DocCur') IS NULL
    ALTER TABLE FTS11OTRQ ADD DocCur NVARCHAR(3) NULL;
GO

IF COL_LENGTH('FTS11OTRQ', 'DocRate') IS NULL
    ALTER TABLE FTS11OTRQ ADD DocRate NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OTRQ_DocRate DEFAULT (1);
GO

IF COL_LENGTH('FTS11OTRQ', 'DocTotalFC') IS NULL
    ALTER TABLE FTS11OTRQ ADD DocTotalFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OTRQ_DocTotalFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11TMP1', 'DocCur') IS NULL
    ALTER TABLE FTS11TMP1 ADD DocCur NVARCHAR(3) NULL;
GO


-- ############################################
-- 089_lead_currency.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 089_lead_currency
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Currency - the lead's currency (SAP OCRN.CurrCode); NULL = the local currency (leads made before this).
--   A Sales Quotation for the lead is in it; it can be changed until the lead's first quotation. Convert to Customer
--   creates the SAP customer in it (OCRD.Currency); All Currencies is not offered for now.
-- ============================================
IF COL_LENGTH('FTS11LEAD', 'Currency') IS NULL
    ALTER TABLE FTS11LEAD ADD Currency NVARCHAR(3) NULL;
GO


-- ############################################
-- 090_salesdoc_disctype.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 090_salesdoc_disctype
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- DiscType - Discount Type of a sales document: a Code of SAP's user table @DISCOUNTTYPE (Code, Name). Optional.
--   Posted to SAP into the document header's UDF U_DiscType.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'DiscType') IS NULL
    ALTER TABLE FTS11OQUT ADD DiscType NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'DiscType') IS NULL
    ALTER TABLE FTS11ORDR ADD DiscType NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'DiscType') IS NULL
    ALTER TABLE FTS11ORIN ADD DiscType NVARCHAR(50) NULL;
GO


-- ############################################
-- 091_salesdoc_address.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 091_salesdoc_address
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Bill To / Ship To of a sales document (the Delivery tab), SAP's own field names:
--   PayToCode  - the customer's Bill To address (SAP CRD1.Address, AdresType 'B'); NULL = none chosen
--   ShipToCode - the customer's Ship To address (SAP CRD1.Address, AdresType 'S'); NULL = none chosen
--   Address    - Bill To address text, filled from the chosen address and editable (free text for a lead)
--   Address2   - Ship To address text, the same
-- Posted to SAP on the order's PayToCode / ShipToCode / Address / Address2.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'PayToCode') IS NULL
    ALTER TABLE FTS11OQUT ADD PayToCode NVARCHAR(50) NULL, ShipToCode NVARCHAR(50) NULL, Address NVARCHAR(254) NULL, Address2 NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'PayToCode') IS NULL
    ALTER TABLE FTS11ORDR ADD PayToCode NVARCHAR(50) NULL, ShipToCode NVARCHAR(50) NULL, Address NVARCHAR(254) NULL, Address2 NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'PayToCode') IS NULL
    ALTER TABLE FTS11ORIN ADD PayToCode NVARCHAR(50) NULL, ShipToCode NVARCHAR(50) NULL, Address NVARCHAR(254) NULL, Address2 NVARCHAR(254) NULL;
GO


-- ############################################
-- 092_salesdoc_disctype5.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 092_salesdoc_disctype5
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Five Discount Types instead of one: DiscType is renamed DiscType1, and DiscType2 .. DiscType5 are added.
-- Each is a Code of SAP's user table @DISCOUNTTYPE (Code, Name), optional; one document can't have the same one twice.
--   Posted to SAP into the document header's UDFs U_DiscType1 .. U_DiscType5 (deploy\scripts\sap-disctype-udf.ps1
--   replaces SAP's U_DiscType with them).
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'DiscType1') IS NULL AND COL_LENGTH('FTS11OQUT', 'DiscType') IS NOT NULL
    EXEC sp_rename 'FTS11OQUT.DiscType', 'DiscType1', 'COLUMN';
GO

IF COL_LENGTH('FTS11OQUT', 'DiscType1') IS NULL
    ALTER TABLE FTS11OQUT ADD DiscType1 NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11OQUT', 'DiscType2') IS NULL
    ALTER TABLE FTS11OQUT ADD DiscType2 NVARCHAR(50) NULL, DiscType3 NVARCHAR(50) NULL, DiscType4 NVARCHAR(50) NULL, DiscType5 NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'DiscType1') IS NULL AND COL_LENGTH('FTS11ORDR', 'DiscType') IS NOT NULL
    EXEC sp_rename 'FTS11ORDR.DiscType', 'DiscType1', 'COLUMN';
GO

IF COL_LENGTH('FTS11ORDR', 'DiscType1') IS NULL
    ALTER TABLE FTS11ORDR ADD DiscType1 NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'DiscType2') IS NULL
    ALTER TABLE FTS11ORDR ADD DiscType2 NVARCHAR(50) NULL, DiscType3 NVARCHAR(50) NULL, DiscType4 NVARCHAR(50) NULL, DiscType5 NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'DiscType1') IS NULL AND COL_LENGTH('FTS11ORIN', 'DiscType') IS NOT NULL
    EXEC sp_rename 'FTS11ORIN.DiscType', 'DiscType1', 'COLUMN';
GO

IF COL_LENGTH('FTS11ORIN', 'DiscType1') IS NULL
    ALTER TABLE FTS11ORIN ADD DiscType1 NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'DiscType2') IS NULL
    ALTER TABLE FTS11ORIN ADD DiscType2 NVARCHAR(50) NULL, DiscType3 NVARCHAR(50) NULL, DiscType4 NVARCHAR(50) NULL, DiscType5 NVARCHAR(50) NULL;
GO

-- ############################################
-- 093_salesdoc_bankinfo.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 093_salesdoc_bankinfo
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- BankInfo - Bank Info of a sales document: a Code of SAP's user table @SELLERBANK (Seller Bank: Code, Name).
--   Optional, starts empty. Posted to SAP into the document header's UDF U_BankInfo.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'BankInfo') IS NULL
    ALTER TABLE FTS11OQUT ADD BankInfo NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'BankInfo') IS NULL
    ALTER TABLE FTS11ORDR ADD BankInfo NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'BankInfo') IS NULL
    ALTER TABLE FTS11ORIN ADD BankInfo NVARCHAR(50) NULL;
GO

-- ############################################
-- 094_salesdoc_address_lines.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 094_salesdoc_address_lines
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Bill To / Ship To parts of a sales document (the Delivery tab), as on Convert to Customer:
--   BillStreet / ShipStreet         - Address Line 1 (SAP Street)
--   BillStreetNo / ShipStreetNo     - Address Line 2 (SAP StreetNo)
--   BillBlock / ShipBlock           - Address Line 3 (SAP Block)
--   BillCity / ShipCity             - Address Line 4 (SAP City)
--   BillDeliveryZone / ShipDeliveryZone - Delivery Zone (Code of SAP UDT @DELIVERYZONE)
-- Filled from the chosen SAP address (PayToCode / ShipToCode) and editable; Address / Address2 are built from them.
-- Posted to SAP on the order's address tab (Street, StreetNo, Block, City; U_DeliveryZoneB / U_DeliveryZoneS).
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'BillStreet') IS NULL
    ALTER TABLE FTS11OQUT ADD BillStreet NVARCHAR(100) NULL, BillStreetNo NVARCHAR(100) NULL, BillBlock NVARCHAR(100) NULL, BillCity NVARCHAR(100) NULL, BillDeliveryZone NVARCHAR(50) NULL, ShipStreet NVARCHAR(100) NULL, ShipStreetNo NVARCHAR(100) NULL, ShipBlock NVARCHAR(100) NULL, ShipCity NVARCHAR(100) NULL, ShipDeliveryZone NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'BillStreet') IS NULL
    ALTER TABLE FTS11ORDR ADD BillStreet NVARCHAR(100) NULL, BillStreetNo NVARCHAR(100) NULL, BillBlock NVARCHAR(100) NULL, BillCity NVARCHAR(100) NULL, BillDeliveryZone NVARCHAR(50) NULL, ShipStreet NVARCHAR(100) NULL, ShipStreetNo NVARCHAR(100) NULL, ShipBlock NVARCHAR(100) NULL, ShipCity NVARCHAR(100) NULL, ShipDeliveryZone NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'BillStreet') IS NULL
    ALTER TABLE FTS11ORIN ADD BillStreet NVARCHAR(100) NULL, BillStreetNo NVARCHAR(100) NULL, BillBlock NVARCHAR(100) NULL, BillCity NVARCHAR(100) NULL, BillDeliveryZone NVARCHAR(50) NULL, ShipStreet NVARCHAR(100) NULL, ShipStreetNo NVARCHAR(100) NULL, ShipBlock NVARCHAR(100) NULL, ShipCity NVARCHAR(100) NULL, ShipDeliveryZone NVARCHAR(50) NULL;
GO


-- ############################################
-- 095_layout_email.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 095_layout_email
-- Date: 2026-11-19
-- ============================================

-- ============================================
-- FTS11SLYT - EmailAllowed: the printed layout's window shows an E-mail button (System Initialization > Layouts,
--   "Allow E-mail"). The e-mail form is filled in with the customer's e-mail (SAP OCRD.E_Mail; Lead / Convert to
--   Customer: their own E-mail), subject and attachment "<Document> <No.>", and sent through General Settings > SMTP.
-- ============================================
IF COL_LENGTH('FTS11SLYT', 'EmailAllowed') IS NULL
    ALTER TABLE FTS11SLYT ADD EmailAllowed BIT NOT NULL CONSTRAINT DF_FTS11SLYT_EmailAllowed DEFAULT (0);
GO

-- ============================================
-- FTS11OEML - the E-mail Log also keeps layouts e-mailed from a document:
--   ReportEntry  - now empty for a layout
--   LayoutEntry  - Layout (FTS11SLYT.DocEntry), empty for a report
--   ObjType      - Document type of the layout's document (FTS_vw_ObjType.Code)
--   DocEntry     - Document's DocEntry
--   DocRef       - Document as shown, e.g. Sales Order 1238
-- ============================================
IF COL_LENGTH('FTS11OEML', 'LayoutEntry') IS NULL
BEGIN
    ALTER TABLE FTS11OEML DROP CONSTRAINT FK_FTS11OEML_Report;
    ALTER TABLE FTS11OEML ALTER COLUMN ReportEntry INT NULL;
    ALTER TABLE FTS11OEML ADD CONSTRAINT FK_FTS11OEML_Report FOREIGN KEY (ReportEntry) REFERENCES FTS11SRPT(DocEntry);
    ALTER TABLE FTS11OEML ADD LayoutEntry INT NULL, ObjType NVARCHAR(20) NULL, DocEntry INT NULL, DocRef NVARCHAR(100) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FTS11OEML_Layout')
    ALTER TABLE FTS11OEML ADD CONSTRAINT FK_FTS11OEML_Layout FOREIGN KEY (LayoutEntry) REFERENCES FTS11SLYT(DocEntry);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FTS11OEML_Source')
    ALTER TABLE FTS11OEML ADD CONSTRAINT CK_FTS11OEML_Source CHECK (ReportEntry IS NOT NULL OR LayoutEntry IS NOT NULL);
GO


-- ############################################
-- 096_salesdoc_line_exportprice.sql
-- ############################################
-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 096_salesdoc_line_exportprice
-- Date: 2026-11-25
-- ============================================

-- ============================================
-- SalesPrice - Export Unit Price of a sales document line (Sales Type EXPORT), the price per Export UoM, posted to
--              SAP as the line's UDF U_SalesPrice (deploy\scripts\sap-salesprice-udf.ps1 adds it). Optional.
--              The screen fills in the Unit Price from it: Export Unit Price x Export Qty / Quantity (still editable).
-- SalesQty / SalesUoM (086) are now shown as Export Qty / Export UoM, also only on an EXPORT document; a document of
-- another Sales Type keeps the three empty.
-- On FTS11QUT1, FTS11RDR1 and FTS11RIN1 (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11QUT1', 'SalesPrice') IS NULL
    ALTER TABLE FTS11QUT1 ADD SalesPrice NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RDR1', 'SalesPrice') IS NULL
    ALTER TABLE FTS11RDR1 ADD SalesPrice NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RIN1', 'SalesPrice') IS NULL
    ALTER TABLE FTS11RIN1 ADD SalesPrice NUMERIC(19,6) NULL;
GO


PRINT 'Migrations 074 to 096 done.';
GO
