-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 006_create_fts11owtm
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- FTS11OWTM - Approval Templates (mirrors SAP B1 OWTM)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OWTM')
CREATE TABLE FTS11OWTM (
    DocEntry        INT IDENTITY(1,1)   NOT NULL,
    WtmCode         NVARCHAR(100)       NOT NULL,   -- Template code
    WtmName         NVARCHAR(100)       NOT NULL,   -- Template name / description
    ObjDoc          NVARCHAR(20)        NOT NULL,   -- Document (FTS_vw_ObjType.Code); added to existing databases by 010
    Query           NVARCHAR(MAX)       NOT NULL,
    Active          BIT                 NOT NULL    CONSTRAINT DF_FTS11OWTM_Active DEFAULT 1,   -- 1 = active
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11OWTM          PRIMARY KEY (DocEntry),
    CONSTRAINT UQ_FTS11OWTM_WtmCode  UNIQUE (WtmCode)
);
GO
