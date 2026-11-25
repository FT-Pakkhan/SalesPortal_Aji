-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 089_lead_currency
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Currency - the lead's currency (SAP OCRN.CurrCode); NULL = the local currency (leads made before this).
--   A Sales Quotation for the lead is in it; it can be changed until the lead's first quotation. Convert to Customer
--   creates the SAP customer in it (OCRD.Currency); All Currencies is not offered for now.
-- ============================================
IF COL_LENGTH('FTS11LEAD', 'Currency') IS NULL
    ALTER TABLE FTS11LEAD ADD Currency NVARCHAR(3) NULL;
GO
