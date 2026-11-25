-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 048_rename_fts11cvst_to_fts11scin
-- Date: 2026-10-06
-- ============================================

-- ============================================
-- Customer Visit is renamed Sales Check In: FTS11CVST -> FTS11SCIN (data kept), with its constraints and index,
-- the document type of its numbering series, the role screen code (CVST -> SCIN) and FTS_vw_ObjType.
-- ============================================
SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID('FTS11CVST') IS NOT NULL AND OBJECT_ID('FTS11SCIN') IS NULL
BEGIN
    EXEC sp_rename 'FTS11CVST', 'FTS11SCIN';
    EXEC sp_rename 'PK_FTS11CVST', 'PK_FTS11SCIN', 'OBJECT';
    EXEC sp_rename 'UX_FTS11CVST_DocNum', 'UX_FTS11SCIN_DocNum', 'OBJECT';
    EXEC sp_rename 'DF_FTS11CVST_DocStatus', 'DF_FTS11SCIN_DocStatus', 'OBJECT';
    EXEC sp_rename 'FTS11SCIN.IX_FTS11CVST_SlpCode', 'IX_FTS11SCIN_SlpCode', 'INDEX';
END

-- Numbering series of this document type, and the screen in roles
UPDATE FTS11NNM1 SET ObjType = 'FTS11SCIN' WHERE ObjType = 'FTS11CVST';
UPDATE FTS11ROL2 SET ScreenCode = 'SCIN' WHERE ScreenCode = 'CVST';

COMMIT;
GO

-- The document type list (the user's view; only its Customer Visits row changes)
CREATE OR ALTER VIEW [dbo].[FTS_vw_ObjType] AS
SELECT 'FTS11SCIN' AS [Code], 'Sales Check In' as [Name]
UNION
SELECT 'FTS11LEAD' AS [Code], 'Lead' as [Name]
UNION ALL
SELECT 'FTS11OQUT' AS [Code], 'Sales Quotation' as [Name]
UNION ALL
SELECT 'FTS11ORDR' AS [Code], 'Sales Order' as [Name]
UNION ALL
SELECT 'FTS11OWTR' AS [Code], 'Inventory Transfer' as [Name]
UNION ALL
SELECT 'FTS11TMPR' AS [Code], 'Temporary Receipt' as [Name]
GO
