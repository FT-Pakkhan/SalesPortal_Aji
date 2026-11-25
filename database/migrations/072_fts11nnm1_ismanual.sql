-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 072_fts11nnm1_ismanual
-- Date: 2026-10-23
-- ============================================

-- ============================================
-- FTS11NNM1 - IsManual: a manual series, as in SAP B1. A document on a manual series gets the No. the user keys in
--   on Confirm (up to 15 characters, unique within the document type) instead of Prefix + Seq + Suffix, which a
--   manual series doesn't use. Not for Sales Check In (numbered on check in, without a Confirm).
-- ============================================
IF COL_LENGTH('FTS11NNM1', 'IsManual') IS NULL
ALTER TABLE FTS11NNM1 ADD
    IsManual        BIT                 NOT NULL    CONSTRAINT DF_FTS11NNM1_IsManual DEFAULT 0;   -- 1 = No. keyed in on Confirm
GO
