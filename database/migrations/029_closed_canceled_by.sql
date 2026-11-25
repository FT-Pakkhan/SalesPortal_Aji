-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 029_closed_canceled_by
-- Date: 2026-10-04
-- ============================================

-- ============================================
-- Who closed / canceled the document, and when (like ConfirmedBy / ConfirmedDate).
-- On both FTS11OQUT and FTS11ORDR (the two tables have the same fields). Empty until it happens.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'ClosedBy')
    ALTER TABLE FTS11OQUT ADD ClosedBy     NVARCHAR(50) NULL,
                              ClosedDate   DATETIME     NULL,
                              CanceledBy   NVARCHAR(50) NULL,
                              CanceledDate DATETIME     NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11ORDR') AND name = 'ClosedBy')
    ALTER TABLE FTS11ORDR ADD ClosedBy     NVARCHAR(50) NULL,
                              ClosedDate   DATETIME     NULL,
                              CanceledBy   NVARCHAR(50) NULL,
                              CanceledDate DATETIME     NULL;
GO
