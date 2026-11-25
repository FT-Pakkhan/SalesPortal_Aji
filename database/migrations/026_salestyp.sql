-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 026_salestyp
-- Date: 2026-10-03
-- ============================================

-- ============================================
-- SalesTyp - Sales Type of a sales document (FTS_vw_SalesTyp.Code, e.g. LC LOCAL, EX EXPORT, SR SAMPLE REQUEST)
-- On both FTS11OQUT and FTS11ORDR (the two tables have the same fields).
-- Mandatory on screen and checked on every save; NULL allowed here only so documents saved before this column existed load.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'SalesTyp')
    ALTER TABLE FTS11OQUT ADD SalesTyp NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11ORDR') AND name = 'SalesTyp')
    ALTER TABLE FTS11ORDR ADD SalesTyp NVARCHAR(20) NULL;
GO
