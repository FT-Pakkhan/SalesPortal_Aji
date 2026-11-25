-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 044_create_fts11tmp1
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- FTS11TMP1 - Temporary Receipt lines (like SAP B1 RCT2, the documents an incoming payment pays)
-- One row per open item chosen from FTS_fn_UnreconciledDocs(CardCode) for the receipt's customer.
-- The open item is one SAP journal line: TransId + Line_ID (unique per receipt).
-- DocNum / DocType / dates / BalanceDue are copied when the item is chosen, as it was then.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11TMP1')
CREATE TABLE FTS11TMP1 (
    DocEntry        INT                 NOT NULL,   -- Temporary Receipt (FTS11TMPR.DocEntry)
    LineNum         INT                 NOT NULL,   -- Line number: 0, 1, 2 ... in screen order
    TransType       NVARCHAR(20)        NOT NULL,   -- 13 A/R Invoice, 14 A/R Credit Memo, 30 Journal Entry (payments too)
    OriTransType    NVARCHAR(20)        NOT NULL,   -- Original type: 13, 14, 30, 24 Incoming / 46 Outgoing Payment
    OriDocEntry     INT                 NOT NULL,   -- Original document's key (OINV / ORIN / ORCT / OVPM DocEntry, OJDT TransId)
    DocNum          NVARCHAR(100)       NULL,       -- Document No. as shown (journal No. for a payment)
    TransId         INT                 NOT NULL,   -- SAP journal entry (JDT1.TransId)
    Line_ID         INT                 NOT NULL,   -- SAP journal entry line (JDT1.Line_ID)
    PostingDate     DATETIME            NULL,
    DueDate         DATETIME            NULL,
    BalanceDue      NUMERIC(19,6)       NOT NULL,   -- Open amount when chosen (local currency; < 0 = in the customer's favour)
    SumApplied      NUMERIC(19,6)       NOT NULL,   -- Amount this receipt pays on it (defaults to BalanceDue)
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11TMP1            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT UX_FTS11TMP1_JdtLine    UNIQUE (DocEntry, TransId, Line_ID),
    CONSTRAINT FK_FTS11TMP1_Receipt    FOREIGN KEY (DocEntry) REFERENCES FTS11TMPR(DocEntry)
);
GO

-- ============================================
-- FTS11TMPR.NoDocSum - On Account (SAP ORCT.NoDocSum): the part of the Amount not applied to any document,
-- = DocTotal - SUM(FTS11TMP1.SumApplied); kept up to date on every Save.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11TMPR') AND name = 'NoDocSum')
    ALTER TABLE FTS11TMPR ADD
        NoDocSum        NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11TMPR_NoDocSum DEFAULT (0);
GO

-- Existing receipts have no lines yet: all of their Amount is on account
UPDATE FTS11TMPR SET NoDocSum = DocTotal WHERE NoDocSum = 0 AND DocTotal <> 0;
GO
