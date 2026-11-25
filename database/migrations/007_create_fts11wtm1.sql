-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 007_create_fts11wtm1
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- FTS11WTM1 - Approval Template Stages
-- The approval stages a document goes through under this template
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11WTM1')
CREATE TABLE FTS11WTM1 (
    DocEntry        INT                 NOT NULL,   -- Template (FTS11OWTM.DocEntry)
    WstDocEntry     INT                 NOT NULL,   -- Approval stage (FTS11OWST.DocEntry)
    CONSTRAINT PK_FTS11WTM1           PRIMARY KEY (DocEntry, WstDocEntry),
    CONSTRAINT FK_FTS11WTM1_Template  FOREIGN KEY (DocEntry)    REFERENCES FTS11OWTM(DocEntry),
    CONSTRAINT FK_FTS11WTM1_Stage     FOREIGN KEY (WstDocEntry) REFERENCES FTS11OWST(DocEntry)
);
GO
