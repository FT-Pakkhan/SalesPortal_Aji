-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 003_create_fts11wst1
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- FTS11WST1 - Approval Stage Authorizers (mirrors SAP B1 WST1)
-- One row per user who can approve at a stage
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11WST1')
CREATE TABLE FTS11WST1 (
    DocEntry        INT                 NOT NULL,   -- Stage (FTS11OWST.DocEntry)
    UserID          INT                 NOT NULL,   -- Authorizer (SystemUsers.DocEntry)
    CONSTRAINT PK_FTS11WST1        PRIMARY KEY (DocEntry, UserID),
    CONSTRAINT FK_FTS11WST1_Stage  FOREIGN KEY (DocEntry) REFERENCES FTS11OWST(DocEntry),
    CONSTRAINT FK_FTS11WST1_User   FOREIGN KEY (UserID)   REFERENCES SystemUsers(DocEntry)
);
GO
