-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 085_approval_email
-- Date: 2026-11-14
-- ============================================

-- ============================================
-- E-mail approval notifications (General Settings > SMTP):
--   ApprEmail - 1 = e-mail the approvers when a document waits for them, and the sender when it is approved,
--               rejected or changed while approving (the same events as the bell). 0 = bell only.
--   PortalUrl - the portal's address as users open it (e.g. https://portal.company.com), for the e-mail's link.
-- Each user's e-mail address is SystemUsers.Email; a user without one gets the bell only.
-- ============================================
IF COL_LENGTH('FTS11OADM', 'ApprEmail') IS NULL
    ALTER TABLE FTS11OADM ADD ApprEmail BIT NOT NULL CONSTRAINT DF_FTS11OADM_ApprEmail DEFAULT (0);
GO

IF COL_LENGTH('FTS11OADM', 'PortalUrl') IS NULL
    ALTER TABLE FTS11OADM ADD PortalUrl NVARCHAR(200) NULL;
GO
