-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 012_add_fts11oqut_objtype
-- Date: 2026-10-02
-- ============================================

-- ============================================
-- FTS11OQUT.ObjType - document type of every row, always 'FTS11OQUT' (Sales Quotation in FTS_vw_ObjType)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'ObjType')
    ALTER TABLE FTS11OQUT ADD ObjType NVARCHAR(20) NOT NULL
        CONSTRAINT DF_FTS11OQUT_ObjType DEFAULT 'FTS11OQUT';
GO
