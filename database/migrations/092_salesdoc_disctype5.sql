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
