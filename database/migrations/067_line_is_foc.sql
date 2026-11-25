-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 067_line_is_foc
-- Date: 2026-10-12
-- ============================================

-- ============================================
-- FTS11QUT1 / FTS11RDR1 - IsFOC: the line is a free-of-charge item. A ticked line has Unit Price 0 (so Price after
-- Discount and Total are 0 too); it is posted to SAP as a line priced at 0. Copied with the line (Copy From / To).
-- ============================================
IF COL_LENGTH('FTS11QUT1', 'IsFOC') IS NULL
ALTER TABLE FTS11QUT1 ADD
    IsFOC               BIT                 NOT NULL CONSTRAINT DF_FTS11QUT1_IsFOC DEFAULT (0);
GO

IF COL_LENGTH('FTS11RDR1', 'IsFOC') IS NULL
ALTER TABLE FTS11RDR1 ADD
    IsFOC               BIT                 NOT NULL CONSTRAINT DF_FTS11RDR1_IsFOC DEFAULT (0);
GO