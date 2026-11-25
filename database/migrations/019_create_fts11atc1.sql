-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 019_create_fts11atc1
-- Date: 2026-10-02
-- ============================================

-- ============================================
-- FTS11ATC1 - Attachments of any portal document (like SAP B1 ATC1)
-- One row per attached file. The file itself is saved in the attachment folder
-- (ATTACHMENT_PATH in .env.local) as <ObjType>\<DocEntry>\<StoredName>; only its details are kept here.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11ATC1')
CREATE TABLE FTS11ATC1 (
    AbsEntry        INT IDENTITY(1,1)   NOT NULL,
    ObjType         NVARCHAR(20)        NOT NULL,   -- Document type (FTS_vw_ObjType.Code), e.g. FTS11OQUT
    DocEntry        INT                 NOT NULL,   -- Document (e.g. FTS11OQUT.DocEntry)
    FileName        NVARCHAR(254)       NOT NULL,   -- Original file name without extension, e.g. Customer PO
    FileExt         NVARCHAR(20)        NULL,       -- Extension without the dot, e.g. pdf
    FileSize        BIGINT              NOT NULL,   -- Bytes
    StoredName      NVARCHAR(100)       NOT NULL,   -- Unique name on disk (GUID + extension), so files never overwrite each other
    [FreeText]      NVARCHAR(254)       NULL,       -- Note typed by the user ([ ] because FREETEXT is a SQL keyword)
    CreatedBy       NVARCHAR(50)        NULL,       -- Attached by
    CreatedDate     DATETIME            NULL,       -- Attachment date
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11ATC1             PRIMARY KEY (AbsEntry)
);
GO

-- Attachments are always looked up by their document
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11ATC1_Document')
CREATE INDEX IX_FTS11ATC1_Document ON FTS11ATC1 (ObjType, DocEntry);
GO
