-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 050_create_fts11owtr
-- Date: 2026-10-06
-- ============================================

-- ============================================
-- FTS11OWTR - Inventory Transfer header (mirrors SAP B1 OWTR): stock moved from one warehouse to another.
--   Save = DRAFT without a No.; Confirm = DocNum from Document Numbering (a series of type Inventory Transfer), OPEN,
--   and approval / posting to SAP as on the other documents.
--   Filler / ToWhsCode: the default From / To warehouse; each line can still have its own (as in SAP B1).
--   CardCode: optional business partner (SAP B1 allows one on a transfer, e.g. a customer's consignment stock).
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OWTR')
CREATE TABLE FTS11OWTR (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    DocNum              NVARCHAR(100)       NULL,       -- Given on Confirm
    Series              INT                 NULL,       -- Numbering series (FTS11NNM1.DocEntry)
    ObjType             NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OWTR_ObjType DEFAULT ('FTS11OWTR'),
    CardCode            NVARCHAR(100)       NULL,       -- Business partner (SAP OCRD), optional
    CardName            NVARCHAR(200)       NULL,
    DocDate             DATETIME            NOT NULL,   -- Posting Date
    TaxDate             DATETIME            NULL,       -- Document Date
    Filler              NVARCHAR(8)         NULL,       -- From Warehouse (SAP OWHS.WhsCode), default for the lines
    ToWhsCode           NVARCHAR(8)         NULL,       -- To Warehouse, default for the lines
    SlpCode             INT                 NULL,       -- Sales Employee (OSLP), defaults to the user's
    Comments            NVARCHAR(254)       NULL,       -- Remarks
    DocStatus           NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OWTR_DocStatus DEFAULT ('DRAFT'),
    ApprStatus          NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OWTR_ApprStatus DEFAULT ('NO-APPROVAL'),
    PostStatus          NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11OWTR_PostStatus DEFAULT ('NO-POSTING'),
    ErrorDesc           NVARCHAR(MAX)       NULL,       -- Error SAP B1 returned when posting FAILED
    SAPDocNum           INT                 NULL,       -- SAP B1 Inventory Transfer No. once posted
    SAPDocEntry         INT                 NULL,
    ConfirmedBy         NVARCHAR(50)        NULL,
    ConfirmedDate       DATETIME            NULL,
    CanceledBy          NVARCHAR(50)        NULL,
    CanceledDate        DATETIME            NULL,
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11OWTR            PRIMARY KEY (DocEntry)
);
GO

-- A No. is unique once given (drafts have none)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OWTR_DocNum')
    CREATE UNIQUE INDEX UX_FTS11OWTR_DocNum ON FTS11OWTR (DocNum) WHERE DocNum IS NOT NULL;
GO

-- ============================================
-- FTS11WTR1 - Inventory Transfer lines (mirrors SAP B1 WTR1): one item moved per line
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11WTR1')
CREATE TABLE FTS11WTR1 (
    DocEntry            INT                 NOT NULL,   -- Inventory Transfer (FTS11OWTR.DocEntry)
    LineNum             INT                 NOT NULL,   -- Line number: 0, 1, 2 ... in screen order
    ItemCode            NVARCHAR(50)        NOT NULL,   -- Item (SAP OITM.ItemCode)
    Dscription          NVARCHAR(200)       NULL,       -- Item description (SAP's spelling)
    Quantity            NUMERIC(19,6)       NOT NULL,
    UomCode             NVARCHAR(20)        NULL,       -- Unit of measure (SAP OUOM.UomCode)
    FromWhsCod          NVARCHAR(8)         NOT NULL,   -- From Warehouse (SAP's spelling, WTR1.FromWhsCod)
    WhsCode             NVARCHAR(8)         NOT NULL,   -- To Warehouse
    Text                NVARCHAR(MAX)       NULL,       -- Item details: long line text
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11WTR1            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11WTR1_Transfer   FOREIGN KEY (DocEntry) REFERENCES FTS11OWTR(DocEntry),
    CONSTRAINT CK_FTS11WTR1_Whs        CHECK (FromWhsCod <> WhsCode)
);
GO
