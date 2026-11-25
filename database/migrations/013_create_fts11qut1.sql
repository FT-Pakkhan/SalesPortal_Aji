-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 013_create_fts11qut1
-- Date: 2026-10-02
-- ============================================

-- ============================================
-- FTS11QUT1 - Sales Quotation lines (mirrors SAP B1 QUT1)
-- One row per item on a quotation
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11QUT1')
CREATE TABLE FTS11QUT1 (
    DocEntry        INT                 NOT NULL,   -- Quotation (FTS11OQUT.DocEntry)
    LineNum         INT                 NOT NULL,   -- Line number: 0, 1, 2 ... in screen order
    ItemCode        NVARCHAR(50)        NOT NULL,   -- Item (SAP OITM.ItemCode)
    Dscription      NVARCHAR(200)       NULL,       -- Item description (SAP's spelling)
    Quantity        NUMERIC(19,6)       NOT NULL,
    UomCode         NVARCHAR(20)        NULL,       -- Unit of measure (SAP OUOM.UomCode)
    PriceBefDi      NUMERIC(19,6)       NULL,       -- Unit price before discount
    DiscPrcnt       NUMERIC(19,6)       NULL,       -- Discount %
    Price           NUMERIC(19,6)       NULL,       -- Unit price after discount
    VatGroup        NVARCHAR(8)         NULL,       -- Tax code (SAP OVTG.Code)
    VatPrcnt        NUMERIC(19,6)       NULL,       -- Tax %
    LineTotal       NUMERIC(19,6)       NULL,       -- Quantity x Price, before tax
    WhsCode         NVARCHAR(8)         NULL,       -- Warehouse (SAP OWHS.WhsCode)
    Text            NVARCHAR(MAX)       NULL,       -- Item details: long line text (SAP QUT1.Text)
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11QUT1            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11QUT1_Quotation  FOREIGN KEY (DocEntry) REFERENCES FTS11OQUT(DocEntry)
);
GO
