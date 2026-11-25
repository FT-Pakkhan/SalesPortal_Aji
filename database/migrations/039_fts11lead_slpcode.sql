-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 039_fts11lead_slpcode
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- SlpCode - the lead's SAP B1 Sales Employee (OSLP.SlpCode); empty = none. On screen: "Sales Employee".
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11LEAD') AND name = 'SlpCode')
    ALTER TABLE FTS11LEAD ADD SlpCode INT NULL;
GO
