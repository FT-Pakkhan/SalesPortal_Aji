-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 021_create_fts_vw_svrtyp
-- Date: 2026-10-03
-- ============================================

-- ============================================
-- FTS_vw_SvrTyp - SAP B1 database server types, for General Settings (FTS11OADM.SapDbServerType)
-- Replaces SE_FASvrTyp (same rows, renamed to match the other FTS views) and adds MSSQL 2022
-- ============================================
CREATE OR ALTER VIEW [dbo].[FTS_vw_SvrTyp] AS

SELECT 'MSSQL2005' AS [Code], 'MSSQL 2005' AS [Name]
UNION ALL
SELECT 'MSSQL2008' AS [Code], 'MSSQL 2008' AS [Name]
UNION ALL
SELECT 'MSSQL2012' AS [Code], 'MSSQL 2012' AS [Name]
UNION ALL
SELECT 'MSSQL2014' AS [Code], 'MSSQL 2014' AS [Name]
UNION ALL
SELECT 'MSSQL2016' AS [Code], 'MSSQL 2016' AS [Name]
UNION ALL
SELECT 'MSSQL2017' AS [Code], 'MSSQL 2017' AS [Name]
UNION ALL
SELECT 'MSSQL2019' AS [Code], 'MSSQL 2019' AS [Name]
UNION ALL
SELECT 'MSSQL2022' AS [Code], 'MSSQL 2022' AS [Name]
GO

IF OBJECT_ID('dbo.SE_FASvrTyp', 'V') IS NOT NULL
    DROP VIEW [dbo].[SE_FASvrTyp];
GO
