-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 034_sapdocnum
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- SAPDocNum - the document's number in SAP B1 (OQUT / ORDR.DocNum) once it has been posted to SAP.
-- Empty until posted. INT, like SAP's DocNum. On both FTS11OQUT and FTS11ORDR (same fields).
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'SAPDocNum')
    ALTER TABLE FTS11OQUT ADD SAPDocNum INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11ORDR') AND name = 'SAPDocNum')
    ALTER TABLE FTS11ORDR ADD SAPDocNum INT NULL;
GO
