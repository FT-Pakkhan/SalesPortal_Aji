-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 017_fts11qut1_base
-- Date: 2026-10-02
-- ============================================
-- Link of a quotation line to the line it was copied from (mirrors SAP B1 QUT1.BaseEntry / BaseLine).
-- Kept in the database only, not shown on screen.

-- ============================================
-- FTS11QUT1.BaseEntry - DocEntry of the base document
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11QUT1') AND name = 'BaseEntry')
    ALTER TABLE FTS11QUT1 ADD BaseEntry INT NULL;
GO

-- ============================================
-- FTS11QUT1.BaseLine - LineNum of the base document's line
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11QUT1') AND name = 'BaseLine')
    ALTER TABLE FTS11QUT1 ADD BaseLine INT NULL;
GO
