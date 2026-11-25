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
