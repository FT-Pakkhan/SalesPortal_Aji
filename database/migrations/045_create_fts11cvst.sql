-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 045_create_fts11cvst
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- FTS11CVST - Customer Visits (A/R Sales)
--   New: choose the series and customer, key in the purpose, then Check In -> saved with its No. (DocNum from
--   Document Numbering, a series of type Customer Visit), the time and the user's GPS location.
--   Check Out -> the time and GPS location again; Duration is worked out from the two times.
--   DocStatus: OPEN while checked in, CLOSED once checked out (FTS_vw_DocStatus). One OPEN visit per user at a time.
--   SlpCode: the user's Sales Employee (SystemUsers.SlpCode), set by the portal; a user sees only the visits of
--   their own Sales Employee. A user without a Sales Employee can't check in.
--   Times are the server's (can't be changed on the phone); the location comes from the user's browser / phone GPS.
--   Lat / Lng: decimal degrees (6 decimals = about 0.1 m); Accuracy: GPS accuracy in metres as the device reports it.
--   Address: looked up from Lat / Lng when checking in / out (empty if the lookup service doesn't answer).
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11CVST')
CREATE TABLE FTS11CVST (
    DocEntry            INT                 IDENTITY(1,1) NOT NULL,
    DocNum              NVARCHAR(100)       NOT NULL,   -- Visit No., from the series on Check In
    Series              INT                 NOT NULL,   -- Numbering series (FTS11NNM1.DocEntry)
    CardCode            NVARCHAR(100)       NOT NULL,   -- SAP B1 customer (OCRD.CardCode)
    CardName            NVARCHAR(200)       NULL,
    SlpCode             INT                 NOT NULL,   -- Sales Employee (OSLP.SlpCode): the user's
    UserID              INT                 NOT NULL,   -- Who made the visit (SystemUsers.DocEntry)
    Purpose             NVARCHAR(254)       NOT NULL,   -- Purpose of visit
    DocStatus           NVARCHAR(20)        NOT NULL CONSTRAINT DF_FTS11CVST_DocStatus DEFAULT ('OPEN'),
    CheckInTime         DATETIME            NOT NULL,
    CheckInLat          DECIMAL(9,6)        NULL,
    CheckInLng          DECIMAL(9,6)        NULL,
    CheckInAccuracy     NUMERIC(10,2)       NULL,
    CheckInAddress      NVARCHAR(500)       NULL,       -- Address of the check-in point (looked up from Lat / Lng)
    CheckOutTime        DATETIME            NULL,
    CheckOutLat         DECIMAL(9,6)        NULL,
    CheckOutLng         DECIMAL(9,6)        NULL,
    CheckOutAccuracy    NUMERIC(10,2)       NULL,
    CheckOutAddress     NVARCHAR(500)       NULL,       -- Address of the check-out point
    Duration            AS DATEDIFF(MINUTE, CheckInTime, CheckOutTime),     -- Minutes; empty until checked out
    Comments            NVARCHAR(254)       NULL,       -- Remarks / outcome of the visit
    CreatedBy           NVARCHAR(50)        NULL,
    CreatedDate         DATETIME            NULL,
    UpdatedBy           NVARCHAR(50)        NULL,
    UpdatedDate         DATETIME            NULL,
    CONSTRAINT PK_FTS11CVST            PRIMARY KEY (DocEntry),
    CONSTRAINT UX_FTS11CVST_DocNum     UNIQUE (DocNum)
);
GO

-- A Sales Employee's visits, newest first (the list view)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FTS11CVST_SlpCode')
    CREATE INDEX IX_FTS11CVST_SlpCode ON FTS11CVST (SlpCode, CheckInTime DESC);
GO
