-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 093_salesdoc_bankinfo
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- BankInfo - Bank Info of a sales document: a Code of SAP's user table @SELLERBANK (Seller Bank: Code, Name).
--   Optional, starts empty. Posted to SAP into the document header's UDF U_BankInfo.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'BankInfo') IS NULL
    ALTER TABLE FTS11OQUT ADD BankInfo NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'BankInfo') IS NULL
    ALTER TABLE FTS11ORDR ADD BankInfo NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'BankInfo') IS NULL
    ALTER TABLE FTS11ORIN ADD BankInfo NVARCHAR(50) NULL;
GO
