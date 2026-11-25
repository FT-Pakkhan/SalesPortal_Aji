-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 086_salesdoc_line_salesqty
-- Date: 2026-11-14
-- ============================================

-- ============================================
-- SalesQty - Sales Quantity of a sales document line, posted to SAP as the line's UDF U_SalesQty. For information
--            only: it doesn't change the line's Quantity, price or total. Optional.
-- SalesUoM - Sales UoM of the line (an SAP unit of measure, OUOM.UomCode), posted to SAP as the line's UDF U_SalesUoM
--            (10 characters, as SAP). Optional.
-- On FTS11QUT1, FTS11RDR1 and FTS11RIN1 (the three tables have the same fields); shown on the quotation and order only.
-- ============================================
IF COL_LENGTH('FTS11QUT1', 'SalesQty') IS NULL
    ALTER TABLE FTS11QUT1 ADD SalesQty NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11QUT1', 'SalesUoM') IS NULL
    ALTER TABLE FTS11QUT1 ADD SalesUoM NVARCHAR(10) NULL;
GO

IF COL_LENGTH('FTS11RDR1', 'SalesQty') IS NULL
    ALTER TABLE FTS11RDR1 ADD SalesQty NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RDR1', 'SalesUoM') IS NULL
    ALTER TABLE FTS11RDR1 ADD SalesUoM NVARCHAR(10) NULL;
GO

IF COL_LENGTH('FTS11RIN1', 'SalesQty') IS NULL
    ALTER TABLE FTS11RIN1 ADD SalesQty NUMERIC(19,6) NULL;
GO

IF COL_LENGTH('FTS11RIN1', 'SalesUoM') IS NULL
    ALTER TABLE FTS11RIN1 ADD SalesUoM NVARCHAR(10) NULL;
GO

