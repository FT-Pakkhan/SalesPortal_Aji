-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 028_line_appr_post_status
-- Date: 2026-10-03
-- ============================================
-- Status columns linked to their views, like DocStatus -> FTS_vw_DocStatus. A view can't carry a foreign key,
-- so the portal checks the codes; the columns follow DocStatus: NVARCHAR(20) NOT NULL with a default.
--   LineStatus -> FTS_vw_LineStatus (OPEN, CLOSED, CANCELED)                    lines:   FTS11QUT1, FTS11RDR1
--   ApprStatus -> FTS_vw_ApprStatus (NO-APPROVAL, PENDING, APPROVED, REJECTED)  headers: FTS11OQUT, FTS11ORDR
--   PostStatus -> FTS_vw_PostStatus (NO-POSTING, PENDING, FAILED, SUCCESS)      headers: FTS11OQUT, FTS11ORDR
--   ErrorDesc  -> the posting error from SAP B1                                 headers: FTS11OQUT, FTS11ORDR
-- ============================================

-- ============================================
-- LineStatus (from 027): NVARCHAR(10) NULL -> NVARCHAR(20) NOT NULL, default OPEN
-- ============================================
UPDATE FTS11QUT1 SET LineStatus = CASE WHEN OpenQty > 0 THEN 'OPEN' ELSE 'CLOSED' END WHERE LineStatus IS NULL;
UPDATE FTS11RDR1 SET LineStatus = CASE WHEN OpenQty > 0 THEN 'OPEN' ELSE 'CLOSED' END WHERE LineStatus IS NULL;
GO

ALTER TABLE FTS11QUT1 ALTER COLUMN LineStatus NVARCHAR(20) NOT NULL;
ALTER TABLE FTS11RDR1 ALTER COLUMN LineStatus NVARCHAR(20) NOT NULL;
GO

IF OBJECT_ID('DF_FTS11QUT1_LineStatus') IS NULL
    ALTER TABLE FTS11QUT1 ADD CONSTRAINT DF_FTS11QUT1_LineStatus DEFAULT ('OPEN') FOR LineStatus;
IF OBJECT_ID('DF_FTS11RDR1_LineStatus') IS NULL
    ALTER TABLE FTS11RDR1 ADD CONSTRAINT DF_FTS11RDR1_LineStatus DEFAULT ('OPEN') FOR LineStatus;
GO

-- ============================================
-- ApprStatus - approval of the document; NO-APPROVAL until an approval template applies
-- (existing documents get NO-APPROVAL through the default)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'ApprStatus')
    ALTER TABLE FTS11OQUT ADD ApprStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_FTS11OQUT_ApprStatus DEFAULT ('NO-APPROVAL');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11ORDR') AND name = 'ApprStatus')
    ALTER TABLE FTS11ORDR ADD ApprStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_FTS11ORDR_ApprStatus DEFAULT ('NO-APPROVAL');
GO

-- ============================================
-- PostStatus - posting of the document to SAP B1 (DI API); NO-POSTING until it is sent
-- (existing documents get NO-POSTING through the default)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'PostStatus')
    ALTER TABLE FTS11OQUT ADD PostStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_FTS11OQUT_PostStatus DEFAULT ('NO-POSTING');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11ORDR') AND name = 'PostStatus')
    ALTER TABLE FTS11ORDR ADD PostStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_FTS11ORDR_PostStatus DEFAULT ('NO-POSTING');
GO

-- ============================================
-- ErrorDesc - the error SAP B1 returned when posting FAILED (empty otherwise)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OQUT') AND name = 'ErrorDesc')
    ALTER TABLE FTS11OQUT ADD ErrorDesc NVARCHAR(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11ORDR') AND name = 'ErrorDesc')
    ALTER TABLE FTS11ORDR ADD ErrorDesc NVARCHAR(MAX) NULL;
GO
