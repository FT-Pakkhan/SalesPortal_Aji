-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 056_report_email
-- Date: 2026-10-08
-- ============================================

-- ============================================
-- FTS11SRPT - e-mailing a report (Report Settings > the report's "E-mail" tab). Single sending only: after Run,
--   the user clicks E-mail, checks the e-mail (filled in from these settings), and sends the PDF through the SMTP
--   settings in General Settings.
--   EmailTo / EmailCc: default recipients, separated by ";" (e.g. finance@aji.com.my; manager@aji.com.my)
--   EmailToQuery:      optional SELECT that finds the To address from the report's parameters, written with
--                      @ParameterName (e.g. SELECT E_Mail FROM SBODemoGB..OCRD WHERE CardCode = @CardCode);
--                      every row's 1st column is added to To. Runs in the portal database, read-only.
--   EmailSubject / EmailBody / EmailFileName: templates with placeholders, filled in when the e-mail form opens:
--                      {ReportName} {Today} {UserName} {DisplayName} and any parameter's value as {ParameterName}
--                      (e.g. "Customer Statement - {CardCode}", file name "Customer Statement {CardCode}")
-- ============================================
IF COL_LENGTH('FTS11SRPT', 'EmailAllowed') IS NULL
ALTER TABLE FTS11SRPT ADD
    EmailAllowed        BIT                 NOT NULL CONSTRAINT DF_FTS11SRPT_EmailAllowed DEFAULT (0),
    EmailTo             NVARCHAR(254)       NULL,
    EmailCc             NVARCHAR(254)       NULL,
    EmailToQuery        NVARCHAR(MAX)       NULL,
    EmailSubject        NVARCHAR(254)       NULL,
    EmailBody           NVARCHAR(MAX)       NULL,
    EmailFileName       NVARCHAR(100)       NULL;       -- Without .pdf; empty = the report name
GO

-- ============================================
-- FTS11OEML - E-mail Log: every report e-mailed from the portal (the PDF itself isn't kept; it can be run again)
--   Status: SENT or FAILED (ErrorDesc = the mail server's answer)
--   ParamValues: the parameter values it was run with, e.g. CardCode=C20000; FromDate=2026-10-01
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OEML')
CREATE TABLE FTS11OEML (
    AbsEntry            INT                 IDENTITY(1,1) NOT NULL,
    ReportEntry         INT                 NOT NULL,   -- Report (FTS11SRPT.DocEntry)
    ParamValues         NVARCHAR(MAX)       NULL,
    MailTo              NVARCHAR(1000)      NOT NULL,
    MailCc              NVARCHAR(1000)      NULL,
    Subject             NVARCHAR(254)       NOT NULL,
    FileName            NVARCHAR(254)       NOT NULL,
    Status              NVARCHAR(10)        NOT NULL,
    ErrorDesc           NVARCHAR(MAX)       NULL,
    SentBy              NVARCHAR(50)        NOT NULL,   -- Portal user who sent it
    SentDate            DATETIME            NOT NULL CONSTRAINT DF_FTS11OEML_SentDate DEFAULT (GETDATE()),
    CONSTRAINT PK_FTS11OEML            PRIMARY KEY (AbsEntry),
    CONSTRAINT FK_FTS11OEML_Report     FOREIGN KEY (ReportEntry) REFERENCES FTS11SRPT(DocEntry),
    CONSTRAINT CK_FTS11OEML_Status     CHECK (Status IN ('SENT', 'FAILED'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11OEML_SentDate')
    CREATE INDEX IX_FTS11OEML_SentDate ON FTS11OEML (SentDate);
GO
