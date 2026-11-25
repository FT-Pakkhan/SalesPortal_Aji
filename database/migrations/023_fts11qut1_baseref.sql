-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 023_fts11qut1_baseref
-- Date: 2026-10-03
-- ============================================

-- ============================================
-- FTS11QUT1.BaseRef - No. (DocNum) of the base document, mirrors SAP B1 QUT1.BaseRef
-- Used with BaseType / BaseEntry / BaseLine; kept in the database only, not shown on screen
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11QUT1') AND name = 'BaseRef')
    ALTER TABLE FTS11QUT1 ADD BaseRef NVARCHAR(20) NULL;
GO
