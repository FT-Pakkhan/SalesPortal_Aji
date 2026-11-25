-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 065_lead_tmpr_created_by
-- Date: 2026-10-10
-- ============================================

-- ============================================
-- FTS11LEAD / FTS11TMPR - who saved the document first and when, as on the other documents
-- (the Dashboard's "My Drafts" lists a user's own drafts by it)
-- ============================================
IF COL_LENGTH('FTS11LEAD', 'CreatedBy') IS NULL
ALTER TABLE FTS11LEAD ADD
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL;
GO

IF COL_LENGTH('FTS11TMPR', 'CreatedBy') IS NULL
ALTER TABLE FTS11TMPR ADD
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL;
GO