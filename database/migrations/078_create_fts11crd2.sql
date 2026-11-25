-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 078_create_fts11crd2
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- FTS11CRD2 - Convert to Customer addresses, as SAP B1's BP addresses (CRD1): any number of Bill To and Ship To
--   addresses, each with its Address ID (unique within its type), one default per type. Posted to SAP as the
--   business partner's addresses; the defaults are its default Bill To / Ship To. The defaults are also kept in
--   FTS11OCRD's Bill* / Ship* columns (copied to the lead when the customer is created in SAP).
-- ============================================
IF OBJECT_ID('FTS11CRD2', 'U') IS NULL
BEGIN
    CREATE TABLE FTS11CRD2 (
        DocEntry            INT                 NOT NULL,   -- FTS11OCRD.DocEntry
        LineNum             INT                 NOT NULL,
        VisOrder            INT                 NOT NULL,
        AdresType           CHAR(1)             NOT NULL,   -- B = Bill To, S = Ship To
        Address             NVARCHAR(50)        NOT NULL,   -- Address ID
        Street              NVARCHAR(254)       NULL,
        Block               NVARCHAR(100)       NULL,
        City                NVARCHAR(100)       NULL,
        ZipCode             NVARCHAR(20)        NULL,
        State               NVARCHAR(3)         NULL,       -- SAP OCST.Code
        Country             NVARCHAR(3)         NULL,       -- SAP OCRY.Code
        IsDefault           BIT                 NOT NULL    CONSTRAINT DF_FTS11CRD2_IsDefault DEFAULT 0,
        CONSTRAINT PK_FTS11CRD2            PRIMARY KEY (DocEntry, LineNum),
        CONSTRAINT FK_FTS11CRD2_Header     FOREIGN KEY (DocEntry) REFERENCES FTS11OCRD(DocEntry),
        CONSTRAINT CK_FTS11CRD2_AdresType  CHECK (AdresType IN ('B', 'S'))
    );
END
GO

-- ============================================
-- Existing conversions: their Business Address becomes Bill To "Bill To" and their Delivery Address (or the business
--   address) Ship To "Ship To", both default - as they were posted to SAP until now
-- ============================================
IF NOT EXISTS (SELECT 1 FROM FTS11CRD2)
BEGIN
    INSERT INTO FTS11CRD2 (DocEntry, LineNum, VisOrder, AdresType, Address, Street, Block, City, ZipCode, State, Country, IsDefault)
    SELECT
        T0.DocEntry AS [DocEntry],
        0 AS [LineNum],
        0 AS [VisOrder],
        'B' AS [AdresType],
        'Bill To' AS [Address],
        T0.BillStreet AS [Street],
        T0.BillBlock AS [Block],
        T0.BillCity AS [City],
        T0.BillZipCode AS [ZipCode],
        T0.BillState AS [State],
        T0.BillCountry AS [Country],
        1 AS [IsDefault]
    FROM FTS11OCRD T0
    WHERE COALESCE(T0.BillStreet, T0.BillBlock, T0.BillCity, T0.BillZipCode, T0.BillState, T0.BillCountry) IS NOT NULL;

    INSERT INTO FTS11CRD2 (DocEntry, LineNum, VisOrder, AdresType, Address, Street, Block, City, ZipCode, State, Country, IsDefault)
    SELECT
        T0.DocEntry AS [DocEntry],
        1 AS [LineNum],
        1 AS [VisOrder],
        'S' AS [AdresType],
        'Ship To' AS [Address],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillStreet ELSE T0.ShipStreet END AS [Street],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillBlock ELSE T0.ShipBlock END AS [Block],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillCity ELSE T0.ShipCity END AS [City],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillZipCode ELSE T0.ShipZipCode END AS [ZipCode],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillState ELSE T0.ShipState END AS [State],
        CASE WHEN T0.ShipSameAsBill = 1 THEN T0.BillCountry ELSE T0.ShipCountry END AS [Country],
        1 AS [IsDefault]
    FROM FTS11OCRD T0
    WHERE T0.ShipSameAsBill = 1 AND COALESCE(T0.BillStreet, T0.BillBlock, T0.BillCity, T0.BillZipCode, T0.BillState, T0.BillCountry) IS NOT NULL
       OR T0.ShipSameAsBill = 0 AND COALESCE(T0.ShipStreet, T0.ShipBlock, T0.ShipCity, T0.ShipZipCode, T0.ShipState, T0.ShipCountry) IS NOT NULL;
END
GO
