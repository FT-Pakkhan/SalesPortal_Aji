-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 018_fts11qut1_basetype
-- Date: 2026-10-02
-- ============================================

-- ============================================
-- FTS11QUT1.BaseType - document type of the base document (FTS_vw_ObjType.Code), mirrors SAP B1 QUT1.BaseType
-- Used with BaseEntry / BaseLine; kept in the database only, not shown on screen
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11QUT1') AND name = 'BaseType')
    ALTER TABLE FTS11QUT1 ADD BaseType NVARCHAR(20) NULL;
GO
