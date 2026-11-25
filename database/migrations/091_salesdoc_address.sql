-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 091_salesdoc_address
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Bill To / Ship To of a sales document (the Delivery tab), SAP's own field names:
--   PayToCode  - the customer's Bill To address (SAP CRD1.Address, AdresType 'B'); NULL = none chosen
--   ShipToCode - the customer's Ship To address (SAP CRD1.Address, AdresType 'S'); NULL = none chosen
--   Address    - Bill To address text, filled from the chosen address and editable (free text for a lead)
--   Address2   - Ship To address text, the same
-- Posted to SAP on the order's PayToCode / ShipToCode / Address / Address2.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'PayToCode') IS NULL
    ALTER TABLE FTS11OQUT ADD PayToCode NVARCHAR(50) NULL, ShipToCode NVARCHAR(50) NULL, Address NVARCHAR(254) NULL, Address2 NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'PayToCode') IS NULL
    ALTER TABLE FTS11ORDR ADD PayToCode NVARCHAR(50) NULL, ShipToCode NVARCHAR(50) NULL, Address NVARCHAR(254) NULL, Address2 NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'PayToCode') IS NULL
    ALTER TABLE FTS11ORIN ADD PayToCode NVARCHAR(50) NULL, ShipToCode NVARCHAR(50) NULL, Address NVARCHAR(254) NULL, Address2 NVARCHAR(254) NULL;
GO
