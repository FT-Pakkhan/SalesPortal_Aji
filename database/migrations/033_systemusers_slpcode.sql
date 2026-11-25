-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 033_systemusers_slpcode
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- SlpCode - the user's SAP B1 Sales Employee (OSLP.SlpCode). Empty = none.
-- Added at the end of the table (SQL Server can't insert a column in the middle without rebuilding the table);
-- on screen it shows after Email.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SystemUsers') AND name = 'SlpCode')
    ALTER TABLE SystemUsers ADD SlpCode INT NULL;
GO
