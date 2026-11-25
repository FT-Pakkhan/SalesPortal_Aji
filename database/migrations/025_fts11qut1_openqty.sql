-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 025_fts11qut1_openqty
-- Date: 2026-10-03
-- ============================================

-- ============================================
-- FTS11QUT1.OpenQty - quantity not yet copied to a later document (mirrors SAP B1 QUT1.OpenQty)
-- Starts equal to Quantity; FTS11RDR1 has the same column (created in 024)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11QUT1') AND name = 'OpenQty')
BEGIN
    ALTER TABLE FTS11QUT1 ADD OpenQty NUMERIC(19,6) NOT NULL
        CONSTRAINT DF_FTS11QUT1_OpenQty DEFAULT 0;
END
GO

-- Lines saved before this column existed: nothing has been copied yet, so all of the quantity is open
UPDATE FTS11QUT1 SET OpenQty = Quantity WHERE OpenQty = 0 AND Quantity <> 0;
GO
