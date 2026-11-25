-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 020_create_fts11oadm
-- Date: 2026-10-02
-- ============================================

-- ============================================
-- FTS11OADM - General Settings (like SAP B1 OADM: one row for the whole portal)
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11OADM')
CREATE TABLE FTS11OADM (
    DocEntry            INT                 NOT NULL    CONSTRAINT DF_FTS11OADM_DocEntry      DEFAULT 1,   -- Always 1: there is only one settings row

    -- Company
    CompnyName          NVARCHAR(100)       NULL,                                                           -- Shown on the portal / printouts (optional since 022)

    -- Attachments
    AttachPath          NVARCHAR(254)       NULL,                                                           -- Folder on the server, e.g. D:\SalesPortal_Attachments
    AttachMaxSizeMB     INT                 NOT NULL    CONSTRAINT DF_FTS11OADM_AttachMaxSize DEFAULT 20,  -- Largest file that can be attached (MB)

    -- SAP B1 DI API connection
    SapServer           NVARCHAR(100)       NULL,                                                           -- Database server, e.g. FT-PC
    SapDbServerType     NVARCHAR(30)        NULL,                                                           -- Server type (FTS_vw_SvrTyp.Code), e.g. MSSQL2019
    SapCompanyDB        NVARCHAR(100)       NULL,                                                           -- Company database, e.g. SBODemoGB
    SapUseTrusted       BIT                 NOT NULL    CONSTRAINT DF_FTS11OADM_SapUseTrusted DEFAULT 0,   -- 1 = Windows login to the database
    SapDbUserName       NVARCHAR(100)       NULL,                                                           -- Database user, e.g. sa
    SapDbPassword       NVARCHAR(500)       NULL,                                                           -- Stored encrypted, never shown again
    SapUserName         NVARCHAR(100)       NULL,                                                           -- SAP B1 user, e.g. manager
    SapPassword         NVARCHAR(500)       NULL,                                                           -- Stored encrypted, never shown again
    SapLicenseServer    NVARCHAR(100)       NULL,                                                           -- e.g. FT-PC:40000
    SapSLDServer        NVARCHAR(100)       NULL,                                                           -- System Landscape Directory, e.g. https://FT-PC:40000

    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11OADM             PRIMARY KEY (DocEntry),
    CONSTRAINT CK_FTS11OADM_OneRow      CHECK (DocEntry = 1),
    CONSTRAINT CK_FTS11OADM_AttachSize  CHECK (AttachMaxSizeMB BETWEEN 1 AND 100)
);
GO
