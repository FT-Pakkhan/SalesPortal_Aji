-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 014_create_fts11nnm1_nnm2
-- Date: 2026-10-02
-- ============================================

-- ============================================
-- FTS11NNM1 - Document Numbering series (header)
-- One row per numbering series of a document type, e.g. CN[YY][MM]0001
--   Doc No. = Prefix ([YY] / [MM] replaced by the document date) + Seq padded to Length + Suffix
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11NNM1')
CREATE TABLE FTS11NNM1 (
    DocEntry        INT IDENTITY(1,1)   NOT NULL,
    ObjType         NVARCHAR(20)        NOT NULL,   -- Doc. Object Type (FTS_vw_ObjType.Code), e.g. FTS11OQUT
    Series          NVARCHAR(100)       NOT NULL,   -- Series code, e.g. CN
    SeriesName      NVARCHAR(100)       NULL,       -- Series name, e.g. A/R Credit Note
    Prefix          NVARCHAR(50)        NULL,       -- May contain [YY], [YYYY], [MM], e.g. CN[YY][MM]
    Seq             INT                 NOT NULL    CONSTRAINT DF_FTS11NNM1_Seq    DEFAULT 1,   -- Next number, used when not numbered by Month / Year
    Length          INT                 NOT NULL    CONSTRAINT DF_FTS11NNM1_Length DEFAULT 4,   -- Number padded with zeros to this length (4 -> 0001)
    Suffix          NVARCHAR(50)        NULL,
    Month           BIT                 NOT NULL    CONSTRAINT DF_FTS11NNM1_Month  DEFAULT 0,   -- 1 = number restarts every month (FTS11NNM2)
    Year            BIT                 NOT NULL    CONSTRAINT DF_FTS11NNM1_Year   DEFAULT 0,   -- 1 = number restarts every year (FTS11NNM2)
    IsDefault       BIT                 NOT NULL    CONSTRAINT DF_FTS11NNM1_Dflt   DEFAULT 0,   -- 1 = series chosen by default on a new document
    Active          BIT                 NOT NULL    CONSTRAINT DF_FTS11NNM1_Active DEFAULT 1,   -- 1 = active
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    CONSTRAINT PK_FTS11NNM1         PRIMARY KEY (DocEntry),
    CONSTRAINT UQ_FTS11NNM1_Series  UNIQUE (ObjType, Series)
);
GO

-- Only one default series per document type
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FTS11NNM1_Default')
CREATE UNIQUE INDEX UX_FTS11NNM1_Default ON FTS11NNM1 (ObjType) WHERE IsDefault = 1;
GO

-- ============================================
-- FTS11NNM2 - Date Numbering (details)
-- Next number of a series for each year / month, e.g. 2025 / 3 / 22
-- Month = 0 when the series restarts by year only
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11NNM2')
CREATE TABLE FTS11NNM2 (
    DocEntry        INT                 NOT NULL,   -- Series (FTS11NNM1.DocEntry)
    Year            INT                 NOT NULL,   -- e.g. 2025
    Month           INT                 NOT NULL,   -- 1 - 12, or 0 for the whole year
    Seq             INT                 NOT NULL,   -- Next number for this year / month
    CONSTRAINT PK_FTS11NNM2         PRIMARY KEY (DocEntry, Year, Month),
    CONSTRAINT FK_FTS11NNM2_Series  FOREIGN KEY (DocEntry) REFERENCES FTS11NNM1(DocEntry)
);
GO
