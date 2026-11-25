-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 030_line_closed_canceled_by
-- Date: 2026-10-04
-- ============================================

-- ============================================
-- Who closed / canceled the line, and when (same as the headers' columns from 029).
-- On both FTS11QUT1 and FTS11RDR1 (the two tables have the same fields). Empty until it happens.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11QUT1') AND name = 'ClosedBy')
    ALTER TABLE FTS11QUT1 ADD ClosedBy     NVARCHAR(50) NULL,
                              ClosedDate   DATETIME     NULL,
                              CanceledBy   NVARCHAR(50) NULL,
                              CanceledDate DATETIME     NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11RDR1') AND name = 'ClosedBy')
    ALTER TABLE FTS11RDR1 ADD ClosedBy     NVARCHAR(50) NULL,
                              ClosedDate   DATETIME     NULL,
                              CanceledBy   NVARCHAR(50) NULL,
                              CanceledDate DATETIME     NULL;
GO
