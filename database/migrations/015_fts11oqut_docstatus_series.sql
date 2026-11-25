-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 015_fts11oqut_docstatus_series
-- Date: 2026-10-02
-- ============================================
-- A quotation is saved first as DRAFT (no number yet). Confirm assigns the No. from its
-- numbering series, sets it to OPEN and locks the Posting Date.

-- ============================================
-- FTS11OQUT.DocStatus - document status (FTS_vw_DocStatus.Code): DRAFT, OPEN, CLOSED, CANCELED
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'DocStatus')
    ALTER TABLE FTS11OQUT ADD DocStatus NVARCHAR(20) NOT NULL
        CONSTRAINT DF_FTS11OQUT_DocStatus DEFAULT 'DRAFT';
GO

-- ============================================
-- FTS11OQUT.Series - numbering series the No. comes from (FTS11NNM1.DocEntry)
-- Defaults to the document type's Default series on a new quotation
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'Series')
    ALTER TABLE FTS11OQUT ADD Series INT NULL
        CONSTRAINT FK_FTS11OQUT_Series FOREIGN KEY REFERENCES FTS11NNM1(DocEntry);
GO

-- ============================================
-- FTS11OQUT.ConfirmedBy / ConfirmedDate - who confirmed the quotation and when (empty while DRAFT)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'ConfirmedBy')
    ALTER TABLE FTS11OQUT ADD ConfirmedBy NVARCHAR(50) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'ConfirmedDate')
    ALTER TABLE FTS11OQUT ADD ConfirmedDate DATETIME NULL;
GO

-- ============================================
-- FTS11OQUT.DocNum - empty until the quotation is confirmed
-- The unique constraint becomes a unique index that skips empty numbers (drafts)
-- ============================================
IF EXISTS (SELECT 1 FROM sys.objects WHERE name = 'UQ_FTS11OQUT_DocNum')
    ALTER TABLE FTS11OQUT DROP CONSTRAINT UQ_FTS11OQUT_DocNum;
GO

ALTER TABLE FTS11OQUT ALTER COLUMN DocNum NVARCHAR(100) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OQUT_DocNum')
    CREATE UNIQUE INDEX UX_FTS11OQUT_DocNum ON FTS11OQUT (DocNum) WHERE DocNum IS NOT NULL;
GO
