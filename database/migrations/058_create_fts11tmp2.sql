-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 058_create_fts11tmp2
-- Date: 2026-10-09
-- ============================================

-- ============================================
-- FTS11TMP2 - Cheques of a Temporary Receipt (Payment Means > Cheque tab): a customer may pay with several cheques,
--   each with its own No. and amount (as SAP B1's RCT1). FTS11TMPR.CheckSum = the total of the receipt's cheques.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11TMP2')
CREATE TABLE FTS11TMP2 (
    DocEntry            INT                 NOT NULL,   -- Temporary Receipt (FTS11TMPR.DocEntry)
    LineNum             INT                 NOT NULL,   -- 0, 1, 2 ... in screen order
    CheckNum            NVARCHAR(20)        NOT NULL,   -- Cheque No.
    CheckSum            NUMERIC(19,6)       NOT NULL,   -- Cheque amount
    CONSTRAINT PK_FTS11TMP2            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11TMP2_Receipt    FOREIGN KEY (DocEntry) REFERENCES FTS11TMPR(DocEntry),
    CONSTRAINT CK_FTS11TMP2_CheckSum   CHECK (CheckSum > 0)
);
GO

-- The single Cheque No. on the receipt (057) is replaced by the cheque lines above
IF COL_LENGTH('FTS11TMPR', 'CheckNum') IS NOT NULL
    ALTER TABLE FTS11TMPR DROP COLUMN CheckNum;
GO
