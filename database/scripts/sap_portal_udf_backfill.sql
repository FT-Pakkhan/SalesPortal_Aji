-- ============================================
-- SAP company database: fill the portal link fields on documents posted by the portal before it filled them itself
-- Date: 2026-10-23
-- ============================================

-- ============================================
-- Run in the SAP company database (SBODemoGB here; the live company on the server). The portal database is
--   Portal_Sales_AJI: replace that name below if the server's is different. Needs migration 071 (Credit Memo) in
--   the portal database.
--
-- Fills, for every portal document posted to SAP (SAPDocEntry kept in the portal):
--   Header  U_PDocEntry = portal DocEntry, U_PDocNum = portal DocNum
--   Lines   U_PDocEntry = portal DocEntry, U_PLineNum = portal LineNum
--   Sales Order -> ORDR / RDR1, Credit Memo -> ORIN / RIN1, Temporary Receipt -> ORCT / RCT2 (documents paid),
--   Inventory Transfer -> OWTQ / WTQ1 (transfer request).
--
-- Safety: a SAP document is matched only when its DocEntry, DocNum and customer are the ones the portal kept, and a
--   line only when it is in the same position (SAP LineNum / InvoiceId = portal position by VisOrder) with the same
--   item (or the same paid document on a receipt). Anything else is left alone. Transfers posted as Inventory
--   Transfers (OWTR) before 2026-10-09 are not transfer requests and are skipped by these checks.
--
-- @Preview = 1 (default): only lists what would be filled, nothing is changed. Set @Preview = 0 to update; it runs
--   in one transaction. Running it again is harmless (same values). Only the portal's user-defined fields are written.
-- ============================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Preview BIT = 1;

IF OBJECT_ID('tempdb..#Hdr') IS NOT NULL DROP TABLE #Hdr;
IF OBJECT_ID('tempdb..#Lin') IS NOT NULL DROP TABLE #Lin;

-- Header links: portal document -> SAP document
SELECT
    'ORDR' AS [SAPTable],
    T1.DocEntry AS [SAPDocEntry],
    T1.DocNum AS [SAPDocNum],
    T0.DocEntry AS [PDocEntry],
    T0.DocNum AS [PDocNum]
    INTO #Hdr
    FROM Portal_Sales_AJI.dbo.FTS11ORDR T0
    JOIN dbo.ORDR T1 ON T1.DocEntry = T0.SAPDocEntry AND T1.DocNum = T0.SAPDocNum AND T1.CardCode = T0.CardCode COLLATE DATABASE_DEFAULT
UNION ALL
SELECT
    'ORIN' AS [SAPTable],
    T1.DocEntry AS [SAPDocEntry],
    T1.DocNum AS [SAPDocNum],
    T0.DocEntry AS [PDocEntry],
    T0.DocNum AS [PDocNum]
    FROM Portal_Sales_AJI.dbo.FTS11ORIN T0
    JOIN dbo.ORIN T1 ON T1.DocEntry = T0.SAPDocEntry AND T1.DocNum = T0.SAPDocNum AND T1.CardCode = T0.CardCode COLLATE DATABASE_DEFAULT
UNION ALL
SELECT
    'ORCT' AS [SAPTable],
    T1.DocEntry AS [SAPDocEntry],
    T1.DocNum AS [SAPDocNum],
    T0.DocEntry AS [PDocEntry],
    T0.DocNum AS [PDocNum]
    FROM Portal_Sales_AJI.dbo.FTS11TMPR T0
    JOIN dbo.ORCT T1 ON T1.DocEntry = T0.SAPDocEntry AND T1.DocNum = T0.SAPDocNum AND T1.CardCode = T0.CardCode COLLATE DATABASE_DEFAULT
UNION ALL
SELECT
    'OWTQ' AS [SAPTable],
    T1.DocEntry AS [SAPDocEntry],
    T1.DocNum AS [SAPDocNum],
    T0.DocEntry AS [PDocEntry],
    T0.DocNum AS [PDocNum]
    FROM Portal_Sales_AJI.dbo.FTS11OWTR T0
    JOIN dbo.OWTQ T1 ON T1.DocEntry = T0.SAPDocEntry AND T1.DocNum = T0.SAPDocNum AND ISNULL(T1.CardCode, '') = ISNULL(T0.CardCode, '') COLLATE DATABASE_DEFAULT;

-- Line links: portal line -> SAP line in the same position
SELECT
    'RDR1' AS [SAPTable],
    T1.DocEntry AS [SAPDocEntry],
    T1.LineNum AS [SAPLineNum],
    T0.DocEntry AS [PDocEntry],
    T0.LineNum AS [PLineNum]
    INTO #Lin
    FROM (SELECT DocEntry, LineNum, ItemCode, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY VisOrder, LineNum) - 1 AS [Pos] FROM Portal_Sales_AJI.dbo.FTS11RDR1) T0
    JOIN #Hdr H ON H.SAPTable = 'ORDR' AND H.PDocEntry = T0.DocEntry
    JOIN dbo.RDR1 T1 ON T1.DocEntry = H.SAPDocEntry AND T1.LineNum = T0.Pos AND T1.ItemCode = T0.ItemCode COLLATE DATABASE_DEFAULT
UNION ALL
SELECT
    'RIN1' AS [SAPTable],
    T1.DocEntry AS [SAPDocEntry],
    T1.LineNum AS [SAPLineNum],
    T0.DocEntry AS [PDocEntry],
    T0.LineNum AS [PLineNum]
    FROM (SELECT DocEntry, LineNum, ItemCode, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY VisOrder, LineNum) - 1 AS [Pos] FROM Portal_Sales_AJI.dbo.FTS11RIN1) T0
    JOIN #Hdr H ON H.SAPTable = 'ORIN' AND H.PDocEntry = T0.DocEntry
    JOIN dbo.RIN1 T1 ON T1.DocEntry = H.SAPDocEntry AND T1.LineNum = T0.Pos AND T1.ItemCode = T0.ItemCode COLLATE DATABASE_DEFAULT
UNION ALL
SELECT
    'RCT2' AS [SAPTable],
    T1.DocNum AS [SAPDocEntry],
    T1.InvoiceId AS [SAPLineNum],
    T0.DocEntry AS [PDocEntry],
    T0.LineNum AS [PLineNum]
    FROM (SELECT DocEntry, LineNum, TransType, OriDocEntry, TransId, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY VisOrder, LineNum) - 1 AS [Pos] FROM Portal_Sales_AJI.dbo.FTS11TMP1) T0
    JOIN #Hdr H ON H.SAPTable = 'ORCT' AND H.PDocEntry = T0.DocEntry
    JOIN dbo.RCT2 T1 ON T1.DocNum = H.SAPDocEntry AND T1.InvoiceId = T0.Pos AND T1.DocEntry = CASE WHEN T0.TransType IN ('13', '14') THEN T0.OriDocEntry ELSE T0.TransId END
UNION ALL
SELECT
    'WTQ1' AS [SAPTable],
    T1.DocEntry AS [SAPDocEntry],
    T1.LineNum AS [SAPLineNum],
    T0.DocEntry AS [PDocEntry],
    T0.LineNum AS [PLineNum]
    FROM (SELECT DocEntry, LineNum, ItemCode, ROW_NUMBER() OVER (PARTITION BY DocEntry ORDER BY VisOrder, LineNum) - 1 AS [Pos] FROM Portal_Sales_AJI.dbo.FTS11WTR1) T0
    JOIN #Hdr H ON H.SAPTable = 'OWTQ' AND H.PDocEntry = T0.DocEntry
    JOIN dbo.WTQ1 T1 ON T1.DocEntry = H.SAPDocEntry AND T1.LineNum = T0.Pos AND T1.ItemCode = T0.ItemCode COLLATE DATABASE_DEFAULT;

IF @Preview = 1
BEGIN
    SELECT
        T0.SAPTable AS [SAP Table],
        T0.SAPDocNum AS [SAP Doc No.],
        T0.PDocEntry AS [U_PDocEntry],
        T0.PDocNum AS [U_PDocNum],
        (SELECT COUNT(*) FROM #Lin L WHERE L.SAPTable = CASE T0.SAPTable WHEN 'ORDR' THEN 'RDR1' WHEN 'ORIN' THEN 'RIN1' WHEN 'ORCT' THEN 'RCT2' ELSE 'WTQ1' END AND L.SAPDocEntry = T0.SAPDocEntry) AS [Lines Matched]
        FROM #Hdr T0
        ORDER BY T0.SAPTable, T0.SAPDocNum;
    SELECT
        T0.SAPTable AS [SAP Table],
        T0.SAPDocEntry AS [SAP DocEntry],
        T0.SAPLineNum AS [SAP Line],
        T0.PDocEntry AS [U_PDocEntry],
        T0.PLineNum AS [U_PLineNum]
        FROM #Lin T0
        ORDER BY T0.SAPTable, T0.SAPDocEntry, T0.SAPLineNum;
    PRINT 'Preview only: nothing was changed. Set @Preview = 0 to update.';
END
ELSE
BEGIN
    BEGIN TRANSACTION;

    UPDATE T1 SET T1.U_PDocEntry = H.PDocEntry, T1.U_PDocNum = H.PDocNum FROM dbo.ORDR T1 JOIN #Hdr H ON H.SAPTable = 'ORDR' AND H.SAPDocEntry = T1.DocEntry;
    UPDATE T1 SET T1.U_PDocEntry = H.PDocEntry, T1.U_PDocNum = H.PDocNum FROM dbo.ORIN T1 JOIN #Hdr H ON H.SAPTable = 'ORIN' AND H.SAPDocEntry = T1.DocEntry;
    UPDATE T1 SET T1.U_PDocEntry = H.PDocEntry, T1.U_PDocNum = H.PDocNum FROM dbo.ORCT T1 JOIN #Hdr H ON H.SAPTable = 'ORCT' AND H.SAPDocEntry = T1.DocEntry;
    UPDATE T1 SET T1.U_PDocEntry = H.PDocEntry, T1.U_PDocNum = H.PDocNum FROM dbo.OWTQ T1 JOIN #Hdr H ON H.SAPTable = 'OWTQ' AND H.SAPDocEntry = T1.DocEntry;

    UPDATE T1 SET T1.U_PDocEntry = L.PDocEntry, T1.U_PLineNum = L.PLineNum FROM dbo.RDR1 T1 JOIN #Lin L ON L.SAPTable = 'RDR1' AND L.SAPDocEntry = T1.DocEntry AND L.SAPLineNum = T1.LineNum;
    UPDATE T1 SET T1.U_PDocEntry = L.PDocEntry, T1.U_PLineNum = L.PLineNum FROM dbo.RIN1 T1 JOIN #Lin L ON L.SAPTable = 'RIN1' AND L.SAPDocEntry = T1.DocEntry AND L.SAPLineNum = T1.LineNum;
    UPDATE T1 SET T1.U_PDocEntry = L.PDocEntry, T1.U_PLineNum = L.PLineNum FROM dbo.RCT2 T1 JOIN #Lin L ON L.SAPTable = 'RCT2' AND L.SAPDocEntry = T1.DocNum AND L.SAPLineNum = T1.InvoiceId;
    UPDATE T1 SET T1.U_PDocEntry = L.PDocEntry, T1.U_PLineNum = L.PLineNum FROM dbo.WTQ1 T1 JOIN #Lin L ON L.SAPTable = 'WTQ1' AND L.SAPDocEntry = T1.DocEntry AND L.SAPLineNum = T1.LineNum;

    COMMIT TRANSACTION;
    DECLARE @Msg NVARCHAR(100) = CONCAT('Updated: ', (SELECT COUNT(*) FROM #Hdr), ' documents, ', (SELECT COUNT(*) FROM #Lin), ' lines.');
    PRINT @Msg;
END

DROP TABLE #Hdr;
DROP TABLE #Lin;
