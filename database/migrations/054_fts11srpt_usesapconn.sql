-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 054_fts11srpt_usesapconn
-- Date: 2026-10-08
-- ============================================

-- ============================================
-- FTS11SRPT.UseSapConn - which connection the Crystal report logs on with:
--   0 = the portal database setting (the portal's server and login; a table designed on another database is
--       switched to the SAP company database)
--   1 = the SAP DI API setting in General Settings (SAP DB Server, DB User Name / Password or Windows login,
--       SAP Database): every table of the report reads the SAP company database
-- ============================================
IF COL_LENGTH('FTS11SRPT', 'UseSapConn') IS NULL
    ALTER TABLE FTS11SRPT ADD UseSapConn BIT NOT NULL CONSTRAINT DF_FTS11SRPT_UseSapConn DEFAULT (0);
GO
