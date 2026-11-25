-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 080_fts11crd2_deliveryzone
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- FTS11CRD2 - Delivery Zone of a Convert to Customer address: the Code of a row of SAP UDT @DELIVERYZONE, posted to
--   SAP as the address's UDF CRD1.U_DeliveryZone
-- ============================================
IF COL_LENGTH('FTS11CRD2', 'DeliveryZone') IS NULL
    ALTER TABLE FTS11CRD2 ADD DeliveryZone NVARCHAR(50) NULL;
GO
