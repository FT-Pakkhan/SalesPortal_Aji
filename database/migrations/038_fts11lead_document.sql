-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 038_fts11lead_document
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- Leads become documents (like the Sales Quotation):
--   Save = DRAFT, no Lead Code yet; Confirm = Lead Code from Document Numbering (a series of type Lead), OPEN.
--   Series       the numbering series chosen (FTS11NNM1.DocEntry); the default Lead series on a new lead
--   DocStatus    FTS_vw_DocStatus: DRAFT -> OPEN (CLOSED / CANCELED later)
--   ApprStatus   FTS_vw_ApprStatus: NO-APPROVAL until confirmed
--   LeadCode     now empty until confirmed, and unique once given
-- ============================================

-- LeadCode: unique only once given (drafts have none)
IF OBJECT_ID('UQ_FTS11LEAD_LeadCode') IS NOT NULL
    ALTER TABLE FTS11LEAD DROP CONSTRAINT UQ_FTS11LEAD_LeadCode;
GO

ALTER TABLE FTS11LEAD ALTER COLUMN LeadCode NVARCHAR(15) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11LEAD_LeadCode')
    CREATE UNIQUE INDEX UX_FTS11LEAD_LeadCode ON FTS11LEAD (LeadCode) WHERE LeadCode IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11LEAD') AND name = 'Series')
    ALTER TABLE FTS11LEAD ADD Series     INT          NULL,
                              DocStatus  NVARCHAR(20) NOT NULL CONSTRAINT DF_FTS11LEAD_DocStatus  DEFAULT ('DRAFT'),
                              ApprStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_FTS11LEAD_ApprStatus DEFAULT ('NO-APPROVAL');
GO
