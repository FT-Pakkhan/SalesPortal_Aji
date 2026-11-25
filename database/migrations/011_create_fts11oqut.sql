-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 011_create_fts11oqut
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- FTS11OQUT - Sales Quotation header (mirrors SAP B1 OQUT)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OQUT')
CREATE TABLE FTS11OQUT (
    DocEntry        INT IDENTITY(1,1)   NOT NULL,
    DocNum          NVARCHAR(100)       NOT NULL,   -- No.
    ObjType         NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11OQUT_ObjType DEFAULT 'FTS11OQUT',  -- Document type (FTS_vw_ObjType.Code); added to existing databases by 012
    CardCode        NVARCHAR(100)       NOT NULL,   -- Customer (SAP OCRD.CardCode)
    CardName        NVARCHAR(200)       NULL,       -- Name
    CntctCode       INT                 NULL,       -- Contact Person (SAP OCPR.CntctCode)
    NumAtCard       NVARCHAR(200)       NULL,       -- Customer Ref. No.
    Comments        NVARCHAR(254)       NULL,       -- Remarks
    DocDate         DATETIME            NOT NULL,   -- Posting Date
    DocDueDate      DATETIME            NOT NULL,   -- Delivery Date
    TaxDate         DATETIME            NULL,       -- Document Date
    SlpCode         INT                 NULL,       -- Sales Employee (SAP OSLP.SlpCode)
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11OQUT         PRIMARY KEY (DocEntry),
    CONSTRAINT UQ_FTS11OQUT_DocNum  UNIQUE (DocNum)
);
GO
