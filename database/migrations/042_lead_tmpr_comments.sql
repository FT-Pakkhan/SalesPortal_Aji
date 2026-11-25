-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 042_lead_tmpr_comments
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- Comments - free remarks on a Lead / Temporary Receipt (on screen: "Remarks"), like the quotation's Comments.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11LEAD') AND name = 'Comments')
    ALTER TABLE FTS11LEAD ADD Comments NVARCHAR(254) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11TMPR') AND name = 'Comments')
    ALTER TABLE FTS11TMPR ADD Comments NVARCHAR(254) NULL;
GO
