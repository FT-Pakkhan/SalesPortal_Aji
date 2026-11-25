-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 071_create_fts11orin_rin1
-- Date: 2026-10-23
-- ============================================
-- Credit Memo: the same fields as Sales Order (FTS11ORDR / FTS11RDR1, including migrations 026, 028, 029, 034,
-- 036, 067 and 069); only the table names and the ObjType default differ. Posted to SAP B1 as an A/R Credit Memo
-- (ORIN) once confirmed (or fully approved). No Copy From / Copy To, no Close: Cancel Doc only (in SAP too once
-- posted).

-- ============================================
-- FTS11ORIN - Credit Memo header (mirrors SAP B1 ORIN)
-- Saved first as DRAFT (no No.); Confirm assigns the No. from the series and makes it OPEN
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ORIN')
CREATE TABLE FTS11ORIN (
    DocEntry        INT IDENTITY(1,1)   NOT NULL,
    DocNum          NVARCHAR(100)       NULL,       -- No. (empty until confirmed)
    ObjType         NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11ORIN_ObjType    DEFAULT 'FTS11ORIN',      -- Document type (FTS_vw_ObjType.Code)
    DocStatus       NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11ORIN_DocStatus  DEFAULT 'DRAFT',          -- FTS_vw_DocStatus.Code: DRAFT, OPEN, CANCELED
    Series          INT                 NULL,       -- Numbering series (FTS11NNM1.DocEntry)
    CardCode        NVARCHAR(100)       NOT NULL,   -- Customer (SAP OCRD.CardCode)
    CardName        NVARCHAR(200)       NULL,       -- Name
    CntctCode       INT                 NULL,       -- Contact Person (SAP OCPR.CntctCode)
    NumAtCard       NVARCHAR(200)       NULL,       -- Customer Ref. No.
    Comments        NVARCHAR(254)       NULL,       -- Remarks
    DocDate         DATETIME            NOT NULL,   -- Posting Date (locked once confirmed)
    DocDueDate      DATETIME            NOT NULL,   -- Due Date
    TaxDate         DATETIME            NULL,       -- Document Date
    SlpCode         INT                 NULL,       -- Sales Employee (SAP OSLP.SlpCode)
    DiscPrcnt       NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORIN_DiscPrcnt  DEFAULT 0,                -- Document discount %
    DiscSum         NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORIN_DiscSum    DEFAULT 0,                -- Document discount amount
    VatSum          NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORIN_VatSum     DEFAULT 0,                -- Total tax
    DocTotal        NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORIN_DocTotal   DEFAULT 0,                -- Total
    ConfirmedBy     NVARCHAR(50)        NULL,
    ConfirmedDate   DATETIME            NULL,
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    SalesTyp        NVARCHAR(20)        NULL,       -- Sales Type (FTS_vw_SalesTyp.Code)
    ApprStatus      NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11ORIN_ApprStatus DEFAULT ('NO-APPROVAL'),  -- FTS_vw_ApprStatus.Code
    PostStatus      NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11ORIN_PostStatus DEFAULT ('NO-POSTING'),   -- FTS_vw_PostStatus.Code
    ErrorDesc       NVARCHAR(MAX)       NULL,       -- The posting error from SAP B1
    ClosedBy        NVARCHAR(50)        NULL,
    ClosedDate      DATETIME            NULL,
    CanceledBy      NVARCHAR(50)        NULL,
    CanceledDate    DATETIME            NULL,
    SAPDocNum       INT                 NULL,       -- SAP B1 ORIN.DocNum once posted
    SAPDocEntry     INT                 NULL,       -- SAP B1 ORIN.DocEntry once posted
    CONSTRAINT PK_FTS11ORIN         PRIMARY KEY (DocEntry),
    CONSTRAINT FK_FTS11ORIN_Series  FOREIGN KEY (Series) REFERENCES FTS11NNM1(DocEntry)
);
GO

-- No. is unique once assigned; drafts (no No. yet) are skipped
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11ORIN_DocNum')
CREATE UNIQUE INDEX UX_FTS11ORIN_DocNum ON FTS11ORIN (DocNum) WHERE DocNum IS NOT NULL;
GO

-- ============================================
-- FTS11RIN1 - Credit Memo lines (mirrors SAP B1 RIN1)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11RIN1')
CREATE TABLE FTS11RIN1 (
    DocEntry        INT                 NOT NULL,   -- Credit Memo (FTS11ORIN.DocEntry)
    LineNum         INT                 NOT NULL,   -- The line's permanent key (0, 1, 2 ... never reused)
    ItemCode        NVARCHAR(50)        NOT NULL,   -- Item (SAP OITM.ItemCode)
    Dscription      NVARCHAR(200)       NULL,       -- Item description (SAP's spelling)
    Quantity        NUMERIC(19,6)       NOT NULL,
    OpenQty         NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11RIN1_OpenQty    DEFAULT 0,       -- Kept as on the other sales documents (= Quantity)
    UomCode         NVARCHAR(20)        NULL,       -- Unit of measure (SAP OUOM.UomCode)
    PriceBefDi      NUMERIC(19,6)       NULL,       -- Unit price before discount
    DiscPrcnt       NUMERIC(19,6)       NULL,       -- Discount %
    Price           NUMERIC(19,6)       NULL,       -- Unit price after discount
    VatGroup        NVARCHAR(8)         NULL,       -- Tax code (SAP OVTG.Code)
    VatPrcnt        NUMERIC(19,6)       NULL,       -- Tax %
    LineTotal       NUMERIC(19,6)       NULL,       -- Quantity x Price, before tax
    WhsCode         NVARCHAR(8)         NULL,       -- Warehouse the items come back into (SAP OWHS.WhsCode)
    Text            NVARCHAR(MAX)       NULL,       -- Item details: long line text
    BaseType        NVARCHAR(20)        NULL,       -- Base document (unused: no Copy From), as on the other sales documents
    BaseEntry       INT                 NULL,
    BaseLine        INT                 NULL,
    BaseRef         NVARCHAR(20)        NULL,
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    LineStatus      NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11RIN1_LineStatus DEFAULT ('OPEN'),    -- FTS_vw_LineStatus.Code
    ClosedBy        NVARCHAR(50)        NULL,
    ClosedDate      DATETIME            NULL,
    CanceledBy      NVARCHAR(50)        NULL,
    CanceledDate    DATETIME            NULL,
    IsFOC           BIT                 NOT NULL    CONSTRAINT DF_FTS11RIN1_IsFOC      DEFAULT (0),     -- Free-of-charge line (Unit Price 0)
    VisOrder        INT                 NOT NULL,   -- The line's position on screen (0, 1, 2 ...)
    CONSTRAINT PK_FTS11RIN1          PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11RIN1_Document FOREIGN KEY (DocEntry) REFERENCES FTS11ORIN(DocEntry)
);
GO

-- ============================================
-- FTS_vw_ObjType (the user's view) - add the new document type, so it can have Document Numbering series,
-- approval templates and attachments
-- ============================================
CREATE OR ALTER VIEW [dbo].[FTS_vw_ObjType] AS
SELECT 'FTS11SCIN' AS [Code], 'Sales Check In' as [Name]
UNION
SELECT 'FTS11LEAD' AS [Code], 'Lead' as [Name]
UNION ALL
SELECT 'FTS11OCRD' AS [Code], 'Convert to Customer' as [Name]
UNION ALL
SELECT 'FTS11OQUT' AS [Code], 'Sales Quotation' as [Name]
UNION ALL
SELECT 'FTS11ORDR' AS [Code], 'Sales Order' as [Name]
UNION ALL
SELECT 'FTS11ORIN' AS [Code], 'Credit Memo' as [Name]
UNION ALL
SELECT 'FTS11OWTR' AS [Code], 'Inventory Transfer' as [Name]
UNION ALL
SELECT 'FTS11TMPR' AS [Code], 'Temporary Receipt' as [Name]
UNION ALL
SELECT 'FTS11OTRQ' AS [Code], 'Temporary Receipt Request' as [Name]
GO

-- ============================================
-- FTS_sp_ResetDatabase (063, 070) - also empties Credit Memo (FTS11RIN1, FTS11ORIN)
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
    DELETE FROM FTS11RIN1;
    DELETE FROM FTS11ORIN;
    DELETE FROM FTS11TMP1;
    DELETE FROM FTS11TMP2;
    DELETE FROM FTS11TMPR;
    DELETE FROM FTS11TRQ1;
    DELETE FROM FTS11OTRQ;
    DELETE FROM FTS11WTR1;
    DELETE FROM FTS11OWTR;
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
