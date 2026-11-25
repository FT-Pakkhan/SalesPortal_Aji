-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 036_sapdocentry
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- SAPDocEntry - the document's key in SAP B1 (OQUT / ORDR.DocEntry) once it has been posted to SAP; unlike SAP's
-- DocNum (SAPDocNum) it never repeats, so it finds the exact SAP document later. Empty until posted. Not on screen.
-- On both FTS11OQUT and FTS11ORDR (same fields).
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'SAPDocEntry')
    ALTER TABLE FTS11OQUT ADD SAPDocEntry INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11ORDR') AND name = 'SAPDocEntry')
    ALTER TABLE FTS11ORDR ADD SAPDocEntry INT NULL;
GO
