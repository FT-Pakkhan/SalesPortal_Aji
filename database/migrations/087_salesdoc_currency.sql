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

