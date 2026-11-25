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
