-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 094_salesdoc_address_lines
-- Date: 2026-11-15
-- ============================================

-- ============================================
-- Bill To / Ship To parts of a sales document (the Delivery tab), as on Convert to Customer:
--   BillStreet / ShipStreet         - Address Line 1 (SAP Street)
--   BillStreetNo / ShipStreetNo     - Address Line 2 (SAP StreetNo)
--   BillBlock / ShipBlock           - Address Line 3 (SAP Block)
--   BillCity / ShipCity             - Address Line 4 (SAP City)
--   BillDeliveryZone / ShipDeliveryZone - Delivery Zone (Code of SAP UDT @DELIVERYZONE)
-- Filled from the chosen SAP address (PayToCode / ShipToCode) and editable; Address / Address2 are built from them.
-- Posted to SAP on the order's address tab (Street, StreetNo, Block, City; U_DeliveryZoneB / U_DeliveryZoneS).
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'BillStreet') IS NULL
    ALTER TABLE FTS11OQUT ADD BillStreet NVARCHAR(100) NULL, BillStreetNo NVARCHAR(100) NULL, BillBlock NVARCHAR(100) NULL, BillCity NVARCHAR(100) NULL, BillDeliveryZone NVARCHAR(50) NULL, ShipStreet NVARCHAR(100) NULL, ShipStreetNo NVARCHAR(100) NULL, ShipBlock NVARCHAR(100) NULL, ShipCity NVARCHAR(100) NULL, ShipDeliveryZone NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'BillStreet') IS NULL
    ALTER TABLE FTS11ORDR ADD BillStreet NVARCHAR(100) NULL, BillStreetNo NVARCHAR(100) NULL, BillBlock NVARCHAR(100) NULL, BillCity NVARCHAR(100) NULL, BillDeliveryZone NVARCHAR(50) NULL, ShipStreet NVARCHAR(100) NULL, ShipStreetNo NVARCHAR(100) NULL, ShipBlock NVARCHAR(100) NULL, ShipCity NVARCHAR(100) NULL, ShipDeliveryZone NVARCHAR(50) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'BillStreet') IS NULL
    ALTER TABLE FTS11ORIN ADD BillStreet NVARCHAR(100) NULL, BillStreetNo NVARCHAR(100) NULL, BillBlock NVARCHAR(100) NULL, BillCity NVARCHAR(100) NULL, BillDeliveryZone NVARCHAR(50) NULL, ShipStreet NVARCHAR(100) NULL, ShipStreetNo NVARCHAR(100) NULL, ShipBlock NVARCHAR(100) NULL, ShipCity NVARCHAR(100) NULL, ShipDeliveryZone NVARCHAR(50) NULL;
GO
