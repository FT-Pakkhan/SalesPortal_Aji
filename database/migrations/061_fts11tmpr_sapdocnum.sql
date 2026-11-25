-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 061_fts11tmpr_sapdocnum
-- Date: 2026-10-09
-- ============================================

-- ============================================
-- FTS11TMPR - the SAP B1 Incoming Payment a Temporary Receipt was posted as (Post to SAP), as on the other documents
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'SAPDocNum') IS NULL
ALTER TABLE FTS11TMPR ADD
    SAPDocNum           INT                 NULL,       -- SAP B1 Incoming Payment No. once posted
    SAPDocEntry         INT                 NULL;
GO
