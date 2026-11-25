-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 069_line_visorder
-- Date: 2026-10-22
-- ============================================

-- ============================================
-- FTS11QUT1 / FTS11RDR1 / FTS11WTR1 / FTS11TMP1 / FTS11LED1 - VisOrder: the line's position on screen (0, 1, 2 ...),
--   as in SAP B1. LineNum is now the line's permanent key: a line keeps its LineNum when lines above it are removed
--   or moved, and a new line gets the next number after the highest one saved on the document. Lines are
--   shown, printed and posted in VisOrder order. Copy links (BaseLine) point at LineNum, so they never move.
--   Existing lines: VisOrder = their position by LineNum (the same as LineNum, as lines were numbered 0, 1, 2 ...).
-- ============================================
IF COL_LENGTH('FTS11QUT1', 'VisOrder') IS NULL
ALTER TABLE FTS11QUT1 ADD
    VisOrder            INT                 NULL;
GO

IF COL_LENGTH('FTS11RDR1', 'VisOrder') IS NULL
ALTER TABLE FTS11RDR1 ADD
    VisOrder            INT                 NULL;
GO

IF COL_LENGTH('FTS11WTR1', 'VisOrder') IS NULL
ALTER TABLE FTS11WTR1 ADD
    VisOrder            INT                 NULL;
GO

IF COL_LENGTH('FTS11TMP1', 'VisOrder') IS NULL
ALTER TABLE FTS11TMP1 ADD
    VisOrder            INT                 NULL;
GO

IF COL_LENGTH('FTS11LED1', 'VisOrder') IS NULL
ALTER TABLE FTS11LED1 ADD
    VisOrder            INT                 NULL;
GO

UPDATE T0 SET T0.VisOrder = T0.Pos FROM (SELECT VisOrder, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY LineNum) - 1 AS Pos FROM FTS11QUT1) T0 WHERE T0.VisOrder IS NULL;
UPDATE T0 SET T0.VisOrder = T0.Pos FROM (SELECT VisOrder, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY LineNum) - 1 AS Pos FROM FTS11RDR1) T0 WHERE T0.VisOrder IS NULL;
UPDATE T0 SET T0.VisOrder = T0.Pos FROM (SELECT VisOrder, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY LineNum) - 1 AS Pos FROM FTS11WTR1) T0 WHERE T0.VisOrder IS NULL;
UPDATE T0 SET T0.VisOrder = T0.Pos FROM (SELECT VisOrder, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY LineNum) - 1 AS Pos FROM FTS11TMP1) T0 WHERE T0.VisOrder IS NULL;
UPDATE T0 SET T0.VisOrder = T0.Pos FROM (SELECT VisOrder, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY LineNum) - 1 AS Pos FROM FTS11LED1) T0 WHERE T0.VisOrder IS NULL;
GO

ALTER TABLE FTS11QUT1 ALTER COLUMN VisOrder INT NOT NULL;
ALTER TABLE FTS11RDR1 ALTER COLUMN VisOrder INT NOT NULL;
ALTER TABLE FTS11WTR1 ALTER COLUMN VisOrder INT NOT NULL;
ALTER TABLE FTS11TMP1 ALTER COLUMN VisOrder INT NOT NULL;
ALTER TABLE FTS11LED1 ALTER COLUMN VisOrder INT NOT NULL;
GO
