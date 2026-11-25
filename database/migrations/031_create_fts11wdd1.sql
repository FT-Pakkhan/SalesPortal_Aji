-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 031_create_fts11wdd1
-- Date: 2026-10-04
-- ============================================

-- ============================================
-- FTS11WDD1 - Approval requests and decisions (like SAP B1 OWDD / WDD1 in one table).
-- When a document is confirmed and an approval template's query returns a row, one row is written here for every
-- approver of every stage of that template. Each approver's decision (APPROVED / REJECTED) and its date/time are
-- kept on their own row, so the full history of who approved what, and when, stays here.
--
--   ObjType + DocEntry   the document (FTS_vw_ObjType.Code, e.g. FTS11OQUT, and its DocEntry)
--   WtmDocEntry          the approval template that triggered it (FTS11OWTM.DocEntry)
--   WstDocEntry          the stage (FTS11OWST.DocEntry); StageNo = its order in the template (1, 2, ...)
--   MaxReqr              approvals required at that stage, as it was when requested
--   UserID               the approver (SystemUsers.DocEntry)
--   ApprStatus           this approver's decision: PENDING -> APPROVED / REJECTED (FTS_vw_ApprStatus.Code)
--   Remarks              the approver's comment
--   ActionDate           when the approver approved / rejected
-- ============================================
IF OBJECT_ID('FTS11WDD1') IS NULL
BEGIN
    CREATE TABLE FTS11WDD1 (
        AbsEntry     INT           IDENTITY(1,1) NOT NULL,
        ObjType      NVARCHAR(20)  NOT NULL,
        DocEntry     INT           NOT NULL,
        WtmDocEntry  INT           NOT NULL,
        WstDocEntry  INT           NOT NULL,
        StageNo      INT           NOT NULL,
        MaxReqr      INT           NOT NULL,
        UserID       INT           NOT NULL,
        ApprStatus   NVARCHAR(20)  NOT NULL CONSTRAINT DF_FTS11WDD1_ApprStatus DEFAULT ('PENDING'),
        Remarks      NVARCHAR(254) NULL,
        ActionDate   DATETIME      NULL,
        CONSTRAINT PK_FTS11WDD1 PRIMARY KEY (AbsEntry),
        CONSTRAINT FK_FTS11WDD1_Template FOREIGN KEY (WtmDocEntry) REFERENCES FTS11OWTM (DocEntry),
        CONSTRAINT FK_FTS11WDD1_Stage    FOREIGN KEY (WstDocEntry) REFERENCES FTS11OWST (DocEntry),
        CONSTRAINT FK_FTS11WDD1_User     FOREIGN KEY (UserID)      REFERENCES SystemUsers (DocEntry)
    );
END
GO

-- A document's approval rows (the approval tab / history of one document)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11WDD1_Document')
    CREATE INDEX IX_FTS11WDD1_Document ON FTS11WDD1 (ObjType, DocEntry);
GO

-- An approver's waiting requests ("documents for me to approve")
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11WDD1_Approver')
    CREATE INDEX IX_FTS11WDD1_Approver ON FTS11WDD1 (UserID, ApprStatus);
GO
