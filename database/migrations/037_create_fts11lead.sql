-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 037_create_fts11lead
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- FTS11LEAD - Leads (first version: a few fields; more to come).
--   LeadCode     the lead's code in the portal (unique), like SAP's CardCode for a lead
--   LeadName     the lead's name
--   CardCode     its Business Partner code in SAP B1 once posted (empty until then)
--   PostStatus   posting to SAP B1 (FTS_vw_PostStatus); ErrorDesc = SAP's error when posting failed
-- Attachments are kept in FTS11ATC1 (ObjType FTS11LEAD + DocEntry), like other documents — no column needed here.
-- ============================================
IF OBJECT_ID('FTS11LEAD') IS NULL
BEGIN
    CREATE TABLE FTS11LEAD (
        DocEntry     INT            IDENTITY(1,1) NOT NULL,
        LeadCode     NVARCHAR(15)   NOT NULL,
        LeadName     NVARCHAR(100)  NOT NULL,
        CardCode     NVARCHAR(15)   NULL,
        PostStatus   NVARCHAR(20)   NOT NULL CONSTRAINT DF_FTS11LEAD_PostStatus DEFAULT ('NO-POSTING'),
        ErrorDesc    NVARCHAR(MAX)  NULL,
        CONSTRAINT PK_FTS11LEAD PRIMARY KEY (DocEntry),
        CONSTRAINT UQ_FTS11LEAD_LeadCode UNIQUE (LeadCode)
    );
END
GO
