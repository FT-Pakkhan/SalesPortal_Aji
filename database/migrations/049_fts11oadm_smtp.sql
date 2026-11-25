-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 049_fts11oadm_smtp
-- Date: 2026-10-06
-- ============================================

-- ============================================
-- FTS11OADM - General Settings: SMTP section (the mail server the portal sends e-mail through)
--   SmtpSecurity: NONE (plain), SSL (SSL/TLS from the start, usually port 465), STARTTLS (usually port 587)
--   SmtpPassword is stored encrypted, like SapPassword (key SETTINGS_SECRET_KEY in .env.local)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11OADM') AND name = 'SmtpHost')
    ALTER TABLE FTS11OADM ADD
        SmtpHost            NVARCHAR(200)       NULL,       -- e.g. smtp.office365.com, smtp.gmail.com
        SmtpPort            INT                 NULL,       -- e.g. 587, 465, 25
        SmtpSecurity        NVARCHAR(20)        NULL,       -- NONE / SSL / STARTTLS
        SmtpUserName        NVARCHAR(200)       NULL,       -- Login of the mail account (often the e-mail address)
        SmtpPassword        NVARCHAR(1000)      NULL,       -- Encrypted
        SmtpFromEmail       NVARCHAR(200)       NULL,       -- Sender address shown on the e-mails
        SmtpFromName        NVARCHAR(200)       NULL;       -- Sender name shown on the e-mails, e.g. AJI Sales Portal
GO
