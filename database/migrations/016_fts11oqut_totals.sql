-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 016_fts11oqut_totals
-- Date: 2026-10-02
-- ============================================
-- Document totals of a sales quotation (mirrors SAP B1 OQUT), worked out from the lines:
--   Total Before Discount = sum of line Total (LC)           (shown on screen, not stored)
--   Discount              = DiscPrcnt % of it, or DiscSum typed; each is calculated from the other
--   Tax                   = sum of each line's (Total x (1 - DiscPrcnt / 100) x Tax %)
--   Total                 = Total Before Discount - Discount + Tax

-- ============================================
-- FTS11OQUT.DiscPrcnt - document discount %
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'DiscPrcnt')
    ALTER TABLE FTS11OQUT ADD DiscPrcnt NUMERIC(19,6) NOT NULL
        CONSTRAINT DF_FTS11OQUT_DiscPrcnt DEFAULT 0;
GO

-- ============================================
-- FTS11OQUT.DiscSum - document discount amount
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'DiscSum')
    ALTER TABLE FTS11OQUT ADD DiscSum NUMERIC(19,6) NOT NULL
        CONSTRAINT DF_FTS11OQUT_DiscSum DEFAULT 0;
GO

-- ============================================
-- FTS11OQUT.VatSum - total tax
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'VatSum')
    ALTER TABLE FTS11OQUT ADD VatSum NUMERIC(19,6) NOT NULL
        CONSTRAINT DF_FTS11OQUT_VatSum DEFAULT 0;
GO

-- ============================================
-- FTS11OQUT.DocTotal - document total (after discount, including tax)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'DocTotal')
    ALTER TABLE FTS11OQUT ADD DocTotal NUMERIC(19,6) NOT NULL
        CONSTRAINT DF_FTS11OQUT_DocTotal DEFAULT 0;
GO
