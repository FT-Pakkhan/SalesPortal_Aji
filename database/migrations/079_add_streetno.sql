-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 079_add_streetno
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- Address Line 2 (SAP CRD1.StreetNo). The address lines, as posted to SAP:
--   Address Line 1 = Street, Address Line 2 = StreetNo, Address Line 3 = Block, Address Line 4 = City
-- FTS11CRD2: Convert to Customer addresses
-- FTS11OCRD / FTS11LEAD: the default Bill To / Ship To kept in the application form (copied to the lead)
-- ============================================
IF COL_LENGTH('FTS11CRD2', 'StreetNo') IS NULL
    ALTER TABLE FTS11CRD2 ADD StreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11OCRD', 'BillStreetNo') IS NULL
    ALTER TABLE FTS11OCRD ADD BillStreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11OCRD', 'ShipStreetNo') IS NULL
    ALTER TABLE FTS11OCRD ADD ShipStreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11LEAD', 'BillStreetNo') IS NULL
    ALTER TABLE FTS11LEAD ADD BillStreetNo NVARCHAR(100) NULL;
GO

IF COL_LENGTH('FTS11LEAD', 'ShipStreetNo') IS NULL
    ALTER TABLE FTS11LEAD ADD ShipStreetNo NVARCHAR(100) NULL;
GO
