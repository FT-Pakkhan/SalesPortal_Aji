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

