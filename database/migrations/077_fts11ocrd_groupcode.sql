-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 077_fts11ocrd_groupcode
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- GroupCode - BP Group of the customer to create (SAP OCRG.GroupCode, a customer group), chosen on Convert to
--   Customer and sent to SAP as the business partner's Group. Required on Confirm; a draft may be saved without it.
-- ============================================
IF COL_LENGTH('FTS11OCRD', 'GroupCode') IS NULL
    ALTER TABLE FTS11OCRD ADD GroupCode INT NULL;
GO
