-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 074_salesdoc_groupnum
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- GroupNum - Payment Terms of a sales document (SAP OCTG.GroupNum), as in SAP B1. Optional: empty = the customer's
--   own payment terms in SAP. Defaults on screen from the customer (OCRD.GroupNum) or the lead's Credit Term.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'GroupNum') IS NULL
    ALTER TABLE FTS11OQUT ADD GroupNum INT NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'GroupNum') IS NULL
    ALTER TABLE FTS11ORDR ADD GroupNum INT NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'GroupNum') IS NULL
    ALTER TABLE FTS11ORIN ADD GroupNum INT NULL;
GO
