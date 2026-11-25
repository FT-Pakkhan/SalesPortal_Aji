-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 022_fts11oadm_compnyname_optional
-- Date: 2026-10-03
-- ============================================

-- ============================================
-- FTS11OADM.CompnyName - no longer mandatory
-- ============================================
ALTER TABLE FTS11OADM ALTER COLUMN CompnyName NVARCHAR(100) NULL;
GO
