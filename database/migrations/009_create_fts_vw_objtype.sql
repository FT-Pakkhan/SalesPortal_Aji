-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 009_create_fts_vw_objtype
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- FTS_vw_ObjType - Document types an approval template can apply to
-- (copy of the view created directly in the database, kept here so it can be rebuilt)
-- ============================================
CREATE OR ALTER VIEW [dbo].[FTS_vw_ObjType] AS
SELECT 'FTS11OQUT' AS [Code], 'Sales Quotation' as [Name]
UNION ALL
SELECT 'FTS11ORDR' AS [Code], 'Sales Order' as [Name]
GO
