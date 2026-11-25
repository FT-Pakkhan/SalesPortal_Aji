-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 010_add_fts11owtm_objdoc
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- FTS11OWTM.ObjDoc - the document the template applies to (FTS_vw_ObjType.Code)
-- A view can't be the target of a foreign key, so the portal checks the value against the view.
-- NOT NULL is fine because FTS11OWTM had no rows when this was added.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OWTM') AND name = 'ObjDoc')
    ALTER TABLE FTS11OWTM ADD ObjDoc NVARCHAR(20) NOT NULL;   -- e.g. 'FTS11OQUT' = Sales Quotation, 'FTS11ORDR' = Sales Order
GO
