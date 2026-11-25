-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 070_create_fts11ocrd
-- Date: 2026-10-22
-- ============================================

-- ============================================
-- FTS11OCRD - Convert to Customer: the request to create an OPEN lead (FTS11LEAD) in SAP B1 as a customer.
--   Made from a lead (LeadEntry): the lead's New Account Application Form is copied in and completed here, with the
--   SAP BP Code (CardCode) and the Approved Credit Limit (CreditLine) keyed in.
--   Save = DRAFT without a No.; Confirm = the form's * fields and the BP code are checked, DocNum from Document
--   Numbering (a series of type Convert to Customer), OPEN - or PENDING approval, as the other documents.
--   Once OPEN with no (more) approval needed it is posted to SAP automatically as a Business Partner (customer);
--   on SUCCESS the lead gets the CardCode, and the form as posted is copied back to the lead.
--   The form's columns have the same names and types as on FTS11LEAD.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OCRD')
CREATE TABLE FTS11OCRD (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    DocNum              NVARCHAR(100)       NULL,       -- Given on Confirm
    Series              INT                 NULL,       -- Numbering series (FTS11NNM1.DocEntry)
    ObjType             NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OCRD_ObjType DEFAULT ('FTS11OCRD'),
    LeadEntry           INT                 NOT NULL,   -- The lead converted (FTS11LEAD.DocEntry)
    CardCode            NVARCHAR(15)        NULL,       -- SAP BP Code keyed in (OCRD.CardCode), required on Confirm
    LeadName            NVARCHAR(100)       NOT NULL,   -- Company Name (the SAP BP name)
    SlpCode             INT                 NULL,       -- Sales Employee (OSLP)
    CreditLine          NUMERIC(19,6)       NULL,       -- Approved Credit Limit
    -- New Account Application Form (as FTS11LEAD)
    DocDate             DATETIME            NULL,
    RegNo               NVARCHAR(50)        NULL,
    YearsInBiz          INT                 NULL,
    BillStreet          NVARCHAR(254)       NULL,
    BillBlock           NVARCHAR(100)       NULL,
    BillCity            NVARCHAR(100)       NULL,
    BillZipCode         NVARCHAR(20)        NULL,
    BillState           NVARCHAR(3)         NULL,
    BillCountry         NVARCHAR(3)         NULL,
    ShipSameAsBill      BIT                 NOT NULL CONSTRAINT DF_FTS11OCRD_ShipSameAsBill DEFAULT (1),
    ShipStreet          NVARCHAR(254)       NULL,
    ShipBlock           NVARCHAR(100)       NULL,
    ShipCity            NVARCHAR(100)       NULL,
    ShipZipCode         NVARCHAR(20)        NULL,
    ShipState           NVARCHAR(3)         NULL,
    ShipCountry         NVARCHAR(3)         NULL,
    Email               NVARCHAR(100)       NULL,
    EInvEmail           NVARCHAR(100)       NULL,
    NatureOfBiz         NVARCHAR(254)       NULL,
    MainProducts        NVARCHAR(254)       NULL,
    Supplier1           NVARCHAR(100)       NULL,
    Supplier2           NVARCHAR(100)       NULL,
    RecCreditLine       NUMERIC(19,6)       NULL,       -- Recommended Credit Limit
    GroupNum            INT                 NULL,       -- Credit Term (OCTG)
    MsicCode            NVARCHAR(10)        NULL,
    TIN                 NVARCHAR(20)        NULL,
    SstNo               NVARCHAR(30)        NULL,
    -- Document
    Comments            NVARCHAR(254)       NULL,       -- Remarks
    DocStatus           NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OCRD_DocStatus DEFAULT ('DRAFT'),
    ApprStatus          NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OCRD_ApprStatus DEFAULT ('NO-APPROVAL'),
    PostStatus          NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OCRD_PostStatus DEFAULT ('NO-POSTING'),
    ErrorDesc           NVARCHAR(MAX)       NULL,
    ConfirmedBy         NVARCHAR(50)        NULL,
    ConfirmedDate       DATETIME            NULL,
    CanceledBy          NVARCHAR(50)        NULL,
    CanceledDate        DATETIME            NULL,
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11OCRD            PRIMARY KEY (DocEntry),
    CONSTRAINT FK_FTS11OCRD_Lead       FOREIGN KEY (LeadEntry) REFERENCES FTS11LEAD(DocEntry)
);
GO

-- A No. is unique once given (drafts have none)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OCRD_DocNum')
    CREATE UNIQUE INDEX UX_FTS11OCRD_DocNum ON FTS11OCRD (DocNum) WHERE DocNum IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11OCRD_LeadEntry')
    CREATE INDEX IX_FTS11OCRD_LeadEntry ON FTS11OCRD (LeadEntry);
GO

-- ============================================
-- FTS11CRD1 - Contact persons / directors of a Convert to Customer (as FTS11LED1 on the lead)
--   LineNum = the contact's permanent key, VisOrder = its position on screen
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11CRD1')
CREATE TABLE FTS11CRD1 (
    DocEntry            INT                 NOT NULL,   -- FTS11OCRD.DocEntry
    LineNum             INT                 NOT NULL,
    VisOrder            INT                 NOT NULL,
    Role                NVARCHAR(20)        NOT NULL,   -- PURCHASING / RECEIVING / ACCOUNT / DIRECTOR / OTHERS
    RoleDesc            NVARCHAR(100)       NULL,       -- Department, for OTHERS
    Name                NVARCHAR(100)       NOT NULL,
    Tel                 NVARCHAR(30)        NULL,
    Email               NVARCHAR(100)       NULL,
    CONSTRAINT PK_FTS11CRD1            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11CRD1_Header     FOREIGN KEY (DocEntry) REFERENCES FTS11OCRD(DocEntry)
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
SELECT 'FTS11OWTR' AS [Code], 'Inventory Transfer' as [Name]
UNION ALL
SELECT 'FTS11TMPR' AS [Code], 'Temporary Receipt' as [Name]
UNION ALL
SELECT 'FTS11OTRQ' AS [Code], 'Temporary Receipt Request' as [Name]
GO

-- ============================================
-- FTS_sp_ResetDatabase (063) - also empties Convert to Customer (FTS11CRD1, FTS11OCRD), before the leads
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
