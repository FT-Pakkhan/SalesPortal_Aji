-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 088_receipt_currency
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Currency of a Temporary Receipt (FTS11TMPR) and a Temporary Receipt Request (FTS11OTRQ), as SAP's Incoming Payment:
--   DocCur     - the currency the money came in (SAP OCRN.CurrCode); NULL = the local currency (made before this).
--   DocRate    - SAP's exchange rate (ORTT) for the Posting Date; 1 for the local currency.
--   DocTotalFC - the Amount in that currency (0 when it is the local currency).
--   DocTotal stays in the local currency (approval template queries keep working). The payment means (CashSum,
--   CheckSum, TrsfrSum, CreditSum, BcgSum, the cheques), NoDocSum and the lines' BalanceDue / SumApplied are in DocCur.
-- FTS11TMP1.DocCur - the currency of the SAP document the line pays (NULL = the local currency); a receipt pays
--   documents in its own currency or in the local currency.
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'DocCur') IS NULL
    ALTER TABLE FTS11TMPR ADD DocCur NVARCHAR(3) NULL;
GO

IF COL_LENGTH('FTS11TMPR', 'DocRate') IS NULL
    ALTER TABLE FTS11TMPR ADD DocRate NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11TMPR_DocRate DEFAULT (1);
GO

IF COL_LENGTH('FTS11TMPR', 'DocTotalFC') IS NULL
    ALTER TABLE FTS11TMPR ADD DocTotalFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11TMPR_DocTotalFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11OTRQ', 'DocCur') IS NULL
    ALTER TABLE FTS11OTRQ ADD DocCur NVARCHAR(3) NULL;
GO

IF COL_LENGTH('FTS11OTRQ', 'DocRate') IS NULL
    ALTER TABLE FTS11OTRQ ADD DocRate NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OTRQ_DocRate DEFAULT (1);
GO

IF COL_LENGTH('FTS11OTRQ', 'DocTotalFC') IS NULL
    ALTER TABLE FTS11OTRQ ADD DocTotalFC NUMERIC(19,6) NOT NULL CONSTRAINT DF_FTS11OTRQ_DocTotalFC DEFAULT (0);
GO

IF COL_LENGTH('FTS11TMP1', 'DocCur') IS NULL
    ALTER TABLE FTS11TMP1 ADD DocCur NVARCHAR(3) NULL;
GO

