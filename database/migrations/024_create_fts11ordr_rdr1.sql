-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 024_create_fts11ordr_rdr1
-- Date: 2026-10-03
-- ============================================
-- Sales Order: exactly the same fields as Sales Quotation (FTS11OQUT / FTS11QUT1, including
-- migrations 012-018, 023 and 025); only the table names and the ObjType default differ.

-- ============================================
-- FTS11ORDR - Sales Order header (mirrors SAP B1 ORDR)
-- Saved first as DRAFT (no No.); Confirm assigns the No. from the series and makes it OPEN
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ORDR')
CREATE TABLE FTS11ORDR (
    DocEntry        INT IDENTITY(1,1)   NOT NULL,
    DocNum          NVARCHAR(100)       NULL,       -- No. (empty until confirmed)
    ObjType         NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11ORDR_ObjType   DEFAULT 'FTS11ORDR',   -- Document type (FTS_vw_ObjType.Code)
    DocStatus       NVARCHAR(20)        NOT NULL    CONSTRAINT DF_FTS11ORDR_DocStatus DEFAULT 'DRAFT',       -- FTS_vw_DocStatus.Code: DRAFT, OPEN, CLOSED, CANCELED
    Series          INT                 NULL,       -- Numbering series (FTS11NNM1.DocEntry)
    CardCode        NVARCHAR(100)       NOT NULL,   -- Customer (SAP OCRD.CardCode)
    CardName        NVARCHAR(200)       NULL,       -- Name
    CntctCode       INT                 NULL,       -- Contact Person (SAP OCPR.CntctCode)
    NumAtCard       NVARCHAR(200)       NULL,       -- Customer Ref. No.
    Comments        NVARCHAR(254)       NULL,       -- Remarks
    DocDate         DATETIME            NOT NULL,   -- Posting Date (locked once confirmed)
    DocDueDate      DATETIME            NOT NULL,   -- Delivery Date
    TaxDate         DATETIME            NULL,       -- Document Date
    SlpCode         INT                 NULL,       -- Sales Employee (SAP OSLP.SlpCode)
    DiscPrcnt       NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORDR_DiscPrcnt DEFAULT 0,   -- Document discount %
    DiscSum         NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORDR_DiscSum   DEFAULT 0,   -- Document discount amount
    VatSum          NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORDR_VatSum    DEFAULT 0,   -- Total tax
    DocTotal        NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11ORDR_DocTotal  DEFAULT 0,   -- Total
    ConfirmedBy     NVARCHAR(50)        NULL,
    ConfirmedDate   DATETIME            NULL,
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11ORDR         PRIMARY KEY (DocEntry),
    CONSTRAINT FK_FTS11ORDR_Series  FOREIGN KEY (Series) REFERENCES FTS11NNM1(DocEntry)
);
GO

-- No. is unique once assigned; drafts (no No. yet) are skipped
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11ORDR_DocNum')
CREATE UNIQUE INDEX UX_FTS11ORDR_DocNum ON FTS11ORDR (DocNum) WHERE DocNum IS NOT NULL;
GO

-- ============================================
-- FTS11RDR1 - Sales Order lines (mirrors SAP B1 RDR1)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11RDR1')
CREATE TABLE FTS11RDR1 (
    DocEntry        INT                 NOT NULL,   -- Sales Order (FTS11ORDR.DocEntry)
    LineNum         INT                 NOT NULL,   -- Line number: 0, 1, 2 ... in screen order
    ItemCode        NVARCHAR(50)        NOT NULL,   -- Item (SAP OITM.ItemCode)
    Dscription      NVARCHAR(200)       NULL,       -- Item description (SAP's spelling)
    Quantity        NUMERIC(19,6)       NOT NULL,
    OpenQty         NUMERIC(19,6)       NOT NULL    CONSTRAINT DF_FTS11RDR1_OpenQty DEFAULT 0,   -- Quantity not yet copied to a later document (starts = Quantity)
    UomCode         NVARCHAR(20)        NULL,       -- Unit of measure (SAP OUOM.UomCode)
    PriceBefDi      NUMERIC(19,6)       NULL,       -- Unit price before discount
    DiscPrcnt       NUMERIC(19,6)       NULL,       -- Discount %
    Price           NUMERIC(19,6)       NULL,       -- Unit price after discount
    VatGroup        NVARCHAR(8)         NULL,       -- Tax code (SAP OVTG.Code)
    VatPrcnt        NUMERIC(19,6)       NULL,       -- Tax %
    LineTotal       NUMERIC(19,6)       NULL,       -- Quantity x Price, before tax
    WhsCode         NVARCHAR(8)         NULL,       -- Warehouse (SAP OWHS.WhsCode)
    Text            NVARCHAR(MAX)       NULL,       -- Item details: long line text
    BaseType        NVARCHAR(20)        NULL,       -- Base document type (FTS_vw_ObjType.Code), e.g. FTS11OQUT when copied from a quotation
    BaseEntry       INT                 NULL,       -- Base document (its DocEntry)
    BaseLine        INT                 NULL,       -- Base document's line (its LineNum)
    BaseRef         NVARCHAR(20)        NULL,       -- Base document's No. (DocNum)
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11RDR1         PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11RDR1_Order   FOREIGN KEY (DocEntry) REFERENCES FTS11ORDR(DocEntry)
);
GO
