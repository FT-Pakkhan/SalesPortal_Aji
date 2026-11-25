-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 032_fts11wtm1_stageno
-- Date: 2026-10-04
-- ============================================

-- ============================================
-- StageNo - order of a stage in its approval template (1, 2, 3 ...): the order the stages were assigned.
-- Stages are approved in this order. Without it the order was lost (the table returns rows by stage ID).
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11WTM1') AND name = 'StageNo')
    ALTER TABLE FTS11WTM1 ADD StageNo INT NULL;
GO

-- Existing templates: numbered by stage code
UPDATE t
SET StageNo = n.StageNo
FROM FTS11WTM1 t
JOIN (SELECT w.DocEntry, w.WstDocEntry,
             ROW_NUMBER() OVER (PARTITION BY w.DocEntry ORDER BY s.WstCode) AS StageNo
      FROM FTS11WTM1 w
      JOIN FTS11OWST s ON s.DocEntry = w.WstDocEntry) n
  ON n.DocEntry = t.DocEntry AND n.WstDocEntry = t.WstDocEntry
WHERE t.StageNo IS NULL;
GO

ALTER TABLE FTS11WTM1 ALTER COLUMN StageNo INT NOT NULL;
GO
