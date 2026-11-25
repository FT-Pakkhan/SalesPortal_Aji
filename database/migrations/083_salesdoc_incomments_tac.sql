-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 083_salesdoc_incomments_tac
-- Date: 2026-11-12
-- ============================================

-- ============================================
-- InComments - Internal Remarks of a sales document, posted to SAP as the document's UDF U_InComments.
-- TAC - T&C of a sales document, posted to SAP as the document's UDF U_TAC (Terms & Condition).
-- 254 characters each, as SAP. Comments is shown as Trade Remarks.
-- On FTS11OQUT, FTS11ORDR and FTS11ORIN (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11OQUT', 'InComments') IS NULL
    ALTER TABLE FTS11OQUT ADD InComments NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11OQUT', 'TAC') IS NULL
    ALTER TABLE FTS11OQUT ADD TAC NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'InComments') IS NULL
    ALTER TABLE FTS11ORDR ADD InComments NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORDR', 'TAC') IS NULL
    ALTER TABLE FTS11ORDR ADD TAC NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'InComments') IS NULL
    ALTER TABLE FTS11ORIN ADD InComments NVARCHAR(254) NULL;
GO

IF COL_LENGTH('FTS11ORIN', 'TAC') IS NULL
    ALTER TABLE FTS11ORIN ADD TAC NVARCHAR(254) NULL;
GO
