-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 076_tmpr_dates
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- DocDate - Posting Date of a Temporary Receipt (FTS11TMPR), as in SAP B1's Incoming Payment: required, locked once
--   confirmed (the No. is made from it), the incoming payment's Posting Date in SAP.
-- TaxDate - Document Date: optional, the incoming payment's Document Date in SAP (empty = the Posting Date).
-- Receipts saved before this get the date they were confirmed on, or else the date they were created on.
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'DocDate') IS NULL
    ALTER TABLE FTS11TMPR ADD DocDate DATETIME NULL;
GO

IF COL_LENGTH('FTS11TMPR', 'TaxDate') IS NULL
    ALTER TABLE FTS11TMPR ADD TaxDate DATETIME NULL;
GO

UPDATE T0
SET T0.DocDate = CAST(ISNULL(T0.ConfirmedDate, T0.CreatedDate) AS DATE),
    T0.TaxDate = CAST(ISNULL(T0.ConfirmedDate, T0.CreatedDate) AS DATE)
FROM FTS11TMPR T0
WHERE T0.DocDate IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11TMPR') AND name = 'DocDate' AND is_nullable = 1)
    ALTER TABLE FTS11TMPR ALTER COLUMN DocDate DATETIME NOT NULL;
GO
