-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 002_create_fts11owst
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- FTS11OWST - Approval Stages (mirrors SAP B1 OWST)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OWST')
CREATE TABLE FTS11OWST (
    DocEntry        INT IDENTITY(1,1)   NOT NULL,
    WstCode         NVARCHAR(100)       NOT NULL,   -- Stage code
    WstName         NVARCHAR(100)       NOT NULL,   -- Stage name
    MaxReqr         SMALLINT            NULL,       -- No. of approvals required
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11OWST          PRIMARY KEY (DocEntry),
    CONSTRAINT UQ_FTS11OWST_WstCode  UNIQUE (WstCode)
);
GO
