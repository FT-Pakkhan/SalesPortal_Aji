-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 073_docnum_unique_after_draft
-- Date: 2026-10-23
-- ============================================

-- ============================================
-- Manual series (072): the No. is typed in the document's No. field and saved with the draft; it is checked only
--   on Confirm. So two drafts may hold the same typed No. until one is confirmed: the No. is unique only once the
--   document is no longer a DRAFT. A draft waiting for approval keeps (reserves) its No.: the portal checks that on
--   Confirm, as the index can't see the approval status.
-- FTS11OQUT / FTS11ORDR / FTS11ORIN / FTS11TMPR / FTS11OTRQ / FTS11OWTR / FTS11OCRD (DocNum), FTS11LEAD (LeadCode)
-- ============================================
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OQUT_DocNum') DROP INDEX UX_FTS11OQUT_DocNum ON FTS11OQUT;
CREATE UNIQUE INDEX UX_FTS11OQUT_DocNum ON FTS11OQUT (DocNum) WHERE DocNum IS NOT NULL AND DocStatus <> 'DRAFT';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11ORDR_DocNum') DROP INDEX UX_FTS11ORDR_DocNum ON FTS11ORDR;
CREATE UNIQUE INDEX UX_FTS11ORDR_DocNum ON FTS11ORDR (DocNum) WHERE DocNum IS NOT NULL AND DocStatus <> 'DRAFT';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11ORIN_DocNum') DROP INDEX UX_FTS11ORIN_DocNum ON FTS11ORIN;
CREATE UNIQUE INDEX UX_FTS11ORIN_DocNum ON FTS11ORIN (DocNum) WHERE DocNum IS NOT NULL AND DocStatus <> 'DRAFT';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11TMPR_DocNum') DROP INDEX UX_FTS11TMPR_DocNum ON FTS11TMPR;
CREATE UNIQUE INDEX UX_FTS11TMPR_DocNum ON FTS11TMPR (DocNum) WHERE DocNum IS NOT NULL AND DocStatus <> 'DRAFT';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OTRQ_DocNum') DROP INDEX UX_FTS11OTRQ_DocNum ON FTS11OTRQ;
CREATE UNIQUE INDEX UX_FTS11OTRQ_DocNum ON FTS11OTRQ (DocNum) WHERE DocNum IS NOT NULL AND DocStatus <> 'DRAFT';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OWTR_DocNum') DROP INDEX UX_FTS11OWTR_DocNum ON FTS11OWTR;
CREATE UNIQUE INDEX UX_FTS11OWTR_DocNum ON FTS11OWTR (DocNum) WHERE DocNum IS NOT NULL AND DocStatus <> 'DRAFT';
GO

-- Convert to Customer: its No. is the SAP BP Code (not a series), and a cancelled one leaves the code free for a new
--   conversion of the lead, so cancelled ones are skipped too
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11OCRD_DocNum') DROP INDEX UX_FTS11OCRD_DocNum ON FTS11OCRD;
CREATE UNIQUE INDEX UX_FTS11OCRD_DocNum ON FTS11OCRD (DocNum) WHERE DocNum IS NOT NULL AND DocStatus <> 'DRAFT' AND DocStatus <> 'CANCELED';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11LEAD_LeadCode') DROP INDEX UX_FTS11LEAD_LeadCode ON FTS11LEAD;
CREATE UNIQUE INDEX UX_FTS11LEAD_LeadCode ON FTS11LEAD (LeadCode) WHERE LeadCode IS NOT NULL AND DocStatus <> 'DRAFT';
GO
