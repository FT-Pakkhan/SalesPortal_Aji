-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 035_create_fts11slyt
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- FTS11SLYT - Print layouts (Crystal Reports .rpt) per document type.
--   LayoutName   name shown when choosing a layout to print, e.g. "Sales Quotation - Standard"
--   LayoutPath   full path of the .rpt file on the server, e.g. D:\SalesPortal_Layouts\SalesQuotation.rpt
--   ObjDoc       document type it prints (FTS_vw_ObjType.Code, e.g. FTS11OQUT) — a view, so checked by the portal
--   IsActive     only active layouts are offered for printing
-- No default layout: the document's Print button lets the user choose from the active layouts of its type.
-- ============================================
IF OBJECT_ID('FTS11SLYT') IS NULL
BEGIN
    CREATE TABLE FTS11SLYT (
        DocEntry     INT           IDENTITY(1,1) NOT NULL,
        LayoutName   NVARCHAR(100) NOT NULL,
        LayoutPath   NVARCHAR(254) NOT NULL,
        ObjDoc       NVARCHAR(20)  NOT NULL,
        IsActive     BIT           NOT NULL CONSTRAINT DF_FTS11SLYT_IsActive DEFAULT (1),
        CreatedBy    NVARCHAR(50)  NULL,
        CreatedDate  DATETIME      NULL,
        UpdatedBy    NVARCHAR(50)  NULL,
        UpdatedDate  DATETIME      NULL,
        CONSTRAINT PK_FTS11SLYT PRIMARY KEY (DocEntry),
        -- The same name can't be used twice for one document type
        CONSTRAINT UQ_FTS11SLYT_Name UNIQUE (ObjDoc, LayoutName)
    );
END
GO
