-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 096_salesdoc_line_exportprice
-- Date: 2026-11-25
-- ============================================

-- ============================================
-- SalesPrice - Export Unit Price of a sales document line (Sales Type EXPORT), the price per Export UoM, posted to
--              SAP as the line's UDF U_SalesPrice (deploy\scripts\sap-salesprice-udf.ps1 adds it). Optional.
--              The screen fills in the Unit Price from it: Export Unit Price x Export Qty / Quantity (still editable).
-- SalesQty / SalesUoM (086) are now shown as Export Qty / Export UoM, also only on an EXPORT document; a document of
-- another Sales Type keeps the three empty.
-- On FTS11QUT1, FTS11RDR1 and FTS11RIN1 (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11QUT1', 'SalesPrice') IS NULL
    ALTER TABLE FTS11QUT1 ADD SalesPrice NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RDR1', 'SalesPrice') IS NULL
    ALTER TABLE FTS11RDR1 ADD SalesPrice NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RIN1', 'SalesPrice') IS NULL
    ALTER TABLE FTS11RIN1 ADD SalesPrice NUMERIC(19,6) NULL;
GO
