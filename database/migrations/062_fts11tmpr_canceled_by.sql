-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 062_fts11tmpr_canceled_by
-- Date: 2026-10-09
-- ============================================

-- ============================================
-- FTS11TMPR - who cancelled a Temporary Receipt (Cancel Doc) and when, as on the other documents
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'CanceledBy') IS NULL
ALTER TABLE FTS11TMPR ADD
    CanceledBy          NVARCHAR(50)        NULL,
    CanceledDate        DATETIME            NULL;
GO