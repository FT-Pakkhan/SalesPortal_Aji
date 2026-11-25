-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 027_linestatus
-- Date: 2026-10-03
-- ============================================

-- ============================================
-- LineStatus - like SAP B1 QUT1 / RDR1.LineStatus: OPEN while the line still has quantity open (OpenQty > 0),
-- CLOSED once it has been fully copied to a later document. Same words as the header's DocStatus.
-- Set automatically on every save together with OpenQty. Not shown on screen.
-- On both FTS11QUT1 and FTS11RDR1 (the two tables have the same fields).
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11QUT1') AND name = 'LineStatus')
    ALTER TABLE FTS11QUT1 ADD LineStatus NVARCHAR(10) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11RDR1') AND name = 'LineStatus')
    ALTER TABLE FTS11RDR1 ADD LineStatus NVARCHAR(10) NULL;
GO

-- Existing lines: from their current OpenQty
UPDATE FTS11QUT1 SET LineStatus = CASE WHEN OpenQty > 0 THEN 'OPEN' ELSE 'CLOSED' END WHERE LineStatus IS NULL;
UPDATE FTS11RDR1 SET LineStatus = CASE WHEN OpenQty > 0 THEN 'OPEN' ELSE 'CLOSED' END WHERE LineStatus IS NULL;
GO
