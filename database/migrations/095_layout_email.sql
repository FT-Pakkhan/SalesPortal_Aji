-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 095_layout_email
-- Date: 2026-11-19
-- ============================================

-- ============================================
-- FTS11SLYT - EmailAllowed: the printed layout's window shows an E-mail button (System Initialization > Layouts,
--   "Allow E-mail"). The e-mail form is filled in with the customer's e-mail (SAP OCRD.E_Mail; Lead / Convert to
--   Customer: their own E-mail), subject and attachment "<Document> <No.>", and sent through General Settings > SMTP.
-- ============================================
IF COL_LENGTH('FTS11SLYT', 'EmailAllowed') IS NULL
    ALTER TABLE FTS11SLYT ADD EmailAllowed BIT NOT NULL CONSTRAINT DF_FTS11SLYT_EmailAllowed DEFAULT (0);
GO

-- ============================================
-- FTS11OEML - the E-mail Log also keeps layouts e-mailed from a document:
--   ReportEntry  - now empty for a layout
--   LayoutEntry  - Layout (FTS11SLYT.DocEntry), empty for a report
--   ObjType      - Document type of the layout's document (FTS_vw_ObjType.Code)
--   DocEntry     - Document's DocEntry
--   DocRef       - Document as shown, e.g. Sales Order 1238
-- ============================================
IF COL_LENGTH('FTS11OEML', 'LayoutEntry') IS NULL
BEGIN
    ALTER TABLE FTS11OEML DROP CONSTRAINT FK_FTS11OEML_Report;
    ALTER TABLE FTS11OEML ALTER COLUMN ReportEntry INT NULL;
    ALTER TABLE FTS11OEML ADD CONSTRAINT FK_FTS11OEML_Report FOREIGN KEY (ReportEntry) REFERENCES FTS11SRPT(DocEntry);
    ALTER TABLE FTS11OEML ADD LayoutEntry INT NULL, ObjType NVARCHAR(20) NULL, DocEntry INT NULL, DocRef NVARCHAR(100) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FTS11OEML_Layout')
    ALTER TABLE FTS11OEML ADD CONSTRAINT FK_FTS11OEML_Layout FOREIGN KEY (LayoutEntry) REFERENCES FTS11SLYT(DocEntry);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FTS11OEML_Source')
    ALTER TABLE FTS11OEML ADD CONSTRAINT CK_FTS11OEML_Source CHECK (ReportEntry IS NOT NULL OR LayoutEntry IS NOT NULL);
GO
