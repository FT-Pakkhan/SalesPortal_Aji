-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 040_create_fts11tmpr
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- FTS11TMPR - Temporary Receipts: a payment received from a customer, kept as a document (like an incoming payment):
--   Save = DRAFT without a No.; Confirm = DocNum from Document Numbering (a series of type Temporary Receipt), OPEN.
--   Series       numbering series (FTS11NNM1.DocEntry); DocNum = the No. given on Confirm (unique once given)
--   CardCode     the SAP B1 customer (OCRD) and its name
--   PayTyp       how it was paid (FTS_vw_PayTyp: CA cash, BT bank transfer, CC credit card, CH cheque)
--   DocTotal     amount received
--   DocStatus / ApprStatus / PostStatus (+ ErrorDesc) as on the other documents
-- ============================================
IF OBJECT_ID('FTS11TMPR') IS NULL
BEGIN
    CREATE TABLE FTS11TMPR (
        DocEntry     INT            IDENTITY(1,1) NOT NULL,
        DocNum       NVARCHAR(100)  NULL,
        Series       INT            NULL,
        CardCode     NVARCHAR(100)  NOT NULL,
        CardName     NVARCHAR(200)  NULL,
        DocStatus    NVARCHAR(20)   NOT NULL CONSTRAINT DF_FTS11TMPR_DocStatus  DEFAULT ('DRAFT'),
        ApprStatus   NVARCHAR(20)   NOT NULL CONSTRAINT DF_FTS11TMPR_ApprStatus DEFAULT ('NO-APPROVAL'),
        PostStatus   NVARCHAR(20)   NOT NULL CONSTRAINT DF_FTS11TMPR_PostStatus DEFAULT ('NO-POSTING'),
        ErrorDesc    NVARCHAR(MAX)  NULL,
        PayTyp       NVARCHAR(20)   NOT NULL,
        DocTotal     NUMERIC(19,6)  NOT NULL CONSTRAINT DF_FTS11TMPR_DocTotal   DEFAULT (0),
        CONSTRAINT PK_FTS11TMPR PRIMARY KEY (DocEntry)
    );
END
GO

-- A No. is unique once given (drafts have none)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11TMPR_DocNum')
    CREATE UNIQUE INDEX UX_FTS11TMPR_DocNum ON FTS11TMPR (DocNum) WHERE DocNum IS NOT NULL;
GO
