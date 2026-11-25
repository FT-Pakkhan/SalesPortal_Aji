-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 059_create_fts11otrq
-- Date: 2026-10-09
-- ============================================

-- ============================================
-- FTS11OTRQ - Temporary Receipt Request: a payment noted down before the Temporary Receipt is made - header and
--   Payment Means only (no documents to pay, no posting to SAP). Copied into a Temporary Receipt later.
--   Save = DRAFT without a No.; Confirm = DocNum from Document Numbering (a series of type Temporary Receipt
--   Request), OPEN (or PENDING approval, as the other documents). Copy To Temporary Receipt -> CLOSED.
--   KnownCust: ticked = the customer is chosen from SAP (CardCode, its name filled in); not ticked = only the name is
--              typed (CardCode stays empty) - the Temporary Receipt then needs the customer chosen.
--   Payment Means as on the Temporary Receipt: cheques in FTS11TRQ1, Bank Transfer (+ bank), Credit Card, Cash and one
--   Bank Charge. PayTyp / DocTotal are worked out by the portal (the one mean used or MP; means + bank charge).
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OTRQ')
CREATE TABLE FTS11OTRQ (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    DocNum              NVARCHAR(100)       NULL,       -- Given on Confirm
    Series              INT                 NULL,       -- Numbering series (FTS11NNM1.DocEntry)
    ObjType             NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OTRQ_ObjType DEFAULT ('FTS11OTRQ'),
    DocDate             DATETIME            NOT NULL,   -- Date of the request
    KnownCust           BIT                 NOT NULL CONSTRAINT DF_FTS11OTRQ_KnownCust DEFAULT (0),
    CardCode            NVARCHAR(100)       NULL,       -- SAP customer (OCRD), only when KnownCust
    CardName            NVARCHAR(200)       NOT NULL,   -- Customer name: from SAP, or typed
    SlpCode             INT                 NULL,       -- Sales Employee (OSLP), defaults to the user's
    PayTyp              NVARCHAR(20)        NULL,       -- FTS_vw_PayTyp.Code, from the Payment Means
    DocTotal            NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11OTRQ_DocTotal DEFAULT (0),
    CheckSum            NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11OTRQ_CheckSum DEFAULT (0),   -- Total of the cheques
    TrsfrSum            NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11OTRQ_TrsfrSum DEFAULT (0),
    TrsfrBank           INT                 NULL,       -- SAP house bank account (DSC1.AbsEntry)
    CreditSum           NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11OTRQ_CreditSum DEFAULT (0),
    CashSum             NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11OTRQ_CashSum DEFAULT (0),
    BcgSum              NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11OTRQ_BcgSum DEFAULT (0),     -- Bank Charge
    Comments            NVARCHAR(254)       NULL,       -- Remarks
    DocStatus           NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OTRQ_DocStatus DEFAULT ('DRAFT'),
    ApprStatus          NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OTRQ_ApprStatus DEFAULT ('NO-APPROVAL'),
    ConfirmedBy         NVARCHAR(50)        NULL,
    ConfirmedDate       DATETIME            NULL,
    CanceledBy          NVARCHAR(50)        NULL,
    CanceledDate        DATETIME            NULL,
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11OTRQ            PRIMARY KEY (DocEntry),
    CONSTRAINT CK_FTS11OTRQ_Customer   CHECK (KnownCust = 0 OR CardCode IS NOT NULL)
);
GO

-- A No. is unique once given (drafts have none)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OTRQ_DocNum')
    CREATE UNIQUE INDEX UX_FTS11OTRQ_DocNum ON FTS11OTRQ (DocNum) WHERE DocNum IS NOT NULL;
GO

-- ============================================
-- FTS11TRQ1 - Cheques of a Temporary Receipt Request (Payment Means > Cheque tab), as FTS11TMP2 on the receipt
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11TRQ1')
CREATE TABLE FTS11TRQ1 (
    DocEntry            INT                 NOT NULL,   -- Request (FTS11OTRQ.DocEntry)
    LineNum             INT                 NOT NULL,
    CheckNum            NVARCHAR(20)        NOT NULL,   -- Cheque No.
    CheckSum            NUMERIC(19,6)       NOT NULL,   -- Cheque amount
    CONSTRAINT PK_FTS11TRQ1            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11TRQ1_Request    FOREIGN KEY (DocEntry) REFERENCES FTS11OTRQ(DocEntry),
    CONSTRAINT CK_FTS11TRQ1_CheckSum   CHECK (CheckSum > 0)
);
GO

-- ============================================
-- FTS11TMPR - the request a Temporary Receipt was copied from (Copy To; the Relationship Map follows it)
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'BaseEntry') IS NULL
ALTER TABLE FTS11TMPR ADD
    BaseType            NVARCHAR(20)        NULL,       -- FTS11OTRQ
    BaseEntry           INT                 NULL;       -- FTS11OTRQ.DocEntry
GO

-- ============================================
-- FTS_vw_ObjType (the user's view) - add the new document type, so it can have Document Numbering series,
-- approval templates, attachments and print layouts
-- ============================================
CREATE OR ALTER VIEW [dbo].[FTS_vw_ObjType] AS
SELECT 'FTS11SCIN' AS [Code], 'Sales Check In' as [Name]
UNION
SELECT 'FTS11LEAD' AS [Code], 'Lead' as [Name]
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
