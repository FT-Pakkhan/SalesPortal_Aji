-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 068_fts11oadm_default_price_list
-- Date: 2026-10-18
-- ============================================

-- ============================================
-- FTS11OADM - Default Price List (General Settings): the SAP price list (OPLN.ListNum) item prices come from when
--   the document has no SAP customer to take one from (a lead, or no customer chosen yet). A customer's own price
--   list (OCRD.ListNum) always comes first, as in SAP B1.
-- ============================================
IF COL_LENGTH('FTS11OADM', 'DefaultPriceList') IS NULL
ALTER TABLE FTS11OADM ADD
    DefaultPriceList    INT                 NULL;
GO