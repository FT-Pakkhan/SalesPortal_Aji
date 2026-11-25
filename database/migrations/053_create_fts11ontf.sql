-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 053_create_fts11ontf
-- Date: 2026-10-07
-- ============================================

-- ============================================
-- FTS11ONTF - Portal notifications (the bell). One row per user per event, written in the same step as the event.
--   NtfType:
--     APPR_WAITING   a document is waiting for this user's approval (their stage's turn)  -> the stage's approvers
--     APPR_STAGE     approved at one stage, moving to the next                             -> who sent it for approval
--     APPR_DONE      fully approved (the document got its No.)                             -> who sent it for approval
--     APPR_REJECTED  rejected, with the approver's remarks                                 -> who sent it for approval
--     POST_FAILED    Post to SAP failed, with SAP's error                                  -> who clicked Post to SAP
--   ObjType / DocEntry: the document the notification opens (e.g. FTS11ORDR, 3).
--   The bell checks every 60 seconds (unread count only; the list loads when the bell is opened).
--   Housekeeping by the portal itself, at most once a day: notifications older than 60 days are deleted, except
--   APPR_WAITING ones whose document is still waiting for that user.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ONTF')
CREATE TABLE FTS11ONTF (
    AbsEntry            INT                 IDENTITY(1,1) NOT NULL,
    UserID              INT                 NOT NULL,   -- Who sees it (SystemUsers.DocEntry)
    NtfType             NVARCHAR(30)        NOT NULL,
    Title               NVARCHAR(200)       NOT NULL,   -- e.g. Waiting for your approval
    Message             NVARCHAR(500)       NULL,       -- e.g. Sales Order - C23900 Parameter Technology, 3,663.00
    ObjType             NVARCHAR(20)        NULL,       -- Document it opens (FTS_vw_ObjType.Code)
    DocEntry            INT                 NULL,
    IsRead              BIT                 NOT NULL CONSTRAINT DF_FTS11ONTF_IsRead DEFAULT (0),
    ReadDate            DATETIME            NULL,
    CreatedBy           NVARCHAR(50)        NULL,       -- Who caused it (e.g. the approver who rejected)
    CreatedDate         DATETIME            NOT NULL CONSTRAINT DF_FTS11ONTF_CreatedDate DEFAULT (GETDATE()),
    CONSTRAINT PK_FTS11ONTF            PRIMARY KEY (AbsEntry),
    CONSTRAINT FK_FTS11ONTF_User       FOREIGN KEY (UserID) REFERENCES SystemUsers(DocEntry),
    CONSTRAINT CK_FTS11ONTF_NtfType    CHECK (NtfType IN ('APPR_WAITING', 'APPR_STAGE', 'APPR_DONE', 'APPR_REJECTED', 'POST_FAILED'))
);
GO

-- The bell's 60-second check: a user's unread count and newest date
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11ONTF_User')
    CREATE INDEX IX_FTS11ONTF_User ON FTS11ONTF (UserID, IsRead) INCLUDE (CreatedDate);
GO
