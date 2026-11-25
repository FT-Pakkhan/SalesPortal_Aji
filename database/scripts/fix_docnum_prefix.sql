-- ============================================
-- Portal database: put the series prefix in front of document numbers made while the series had no prefix
-- Date: 2026-10-23
-- ============================================

-- ============================================
-- Run in the portal database (Portal_Sales_AJI).
--
-- A document's No. is the series' Prefix + its running number (Document Numbering), e.g. Prefix SO -> SO00001.
--   A series saved with an empty Prefix gives 00001, 00002 ...
--
-- Step 1: every series with an empty Prefix gets its Series code as the Prefix (SO -> SO00001). To use another
--   prefix, set it in Document Numbering BEFORE running this script; series that already have a prefix are kept.
-- Step 2: every numbered document whose No. does not start with its series' prefix gets the prefix in front:
--   Sales Quotation, Sales Order, Credit Memo, Temporary Receipt, Temporary Receipt Request, Inventory Transfer,
--   Sales Check In, Convert to Customer, Lead (Lead Code). Drafts have no No. yet and are not touched.
-- Step 3: what refers to those numbers: Copy From references on lines (BaseRef) and quotations / orders made for a
--   lead (their Customer is the Lead Code).
--
-- Skipped and listed: series whose prefix uses [YYYY] / [YY] / [MM] (the prefix would depend on each document's
--   date), and lead codes that would be longer than 15 characters.
--
-- @Preview = 1 (default): only lists what would change, nothing is changed. Set @Preview = 0 to update; it runs in
--   one transaction. Running it again changes nothing (the numbers already start with the prefix).
--
-- Afterwards: documents already posted to SAP keep the old number in SAP's own Remarks / Reference. Run
--   sap_portal_udf_backfill.sql (in the SAP company database) again to put the new numbers in U_PDocNum.
-- ============================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Preview BIT = 1;

IF OBJECT_ID('tempdb..#Ser') IS NOT NULL DROP TABLE #Ser;
IF OBJECT_ID('tempdb..#Map') IS NOT NULL DROP TABLE #Map;

-- The prefix each series will have
SELECT
    T0.DocEntry AS [Series],
    T0.ObjType AS [ObjType],
    T0.Series AS [SeriesCode],
    T0.Prefix AS [OldPrefix],
    CASE WHEN ISNULL(T0.Prefix, '') = '' THEN T0.Series ELSE T0.Prefix END AS [NewPrefix]
    INTO #Ser
    FROM FTS11NNM1 T0;

-- The documents to renumber: old No. -> prefix + old No.
SELECT
    T0.Tbl AS [Tbl],
    T0.DocEntry AS [DocEntry],
    T0.OldNum AS [OldNum],
    S.NewPrefix + T0.OldNum AS [NewNum]
    INTO #Map
    FROM (
        SELECT 'FTS11OQUT' AS [Tbl], DocEntry, Series, DocNum AS [OldNum] FROM FTS11OQUT
        UNION ALL SELECT 'FTS11ORDR', DocEntry, Series, DocNum FROM FTS11ORDR
        UNION ALL SELECT 'FTS11ORIN', DocEntry, Series, DocNum FROM FTS11ORIN
        UNION ALL SELECT 'FTS11TMPR', DocEntry, Series, DocNum FROM FTS11TMPR
        UNION ALL SELECT 'FTS11OTRQ', DocEntry, Series, DocNum FROM FTS11OTRQ
        UNION ALL SELECT 'FTS11OWTR', DocEntry, Series, DocNum FROM FTS11OWTR
        UNION ALL SELECT 'FTS11SCIN', DocEntry, Series, DocNum FROM FTS11SCIN
        UNION ALL SELECT 'FTS11OCRD', DocEntry, Series, DocNum FROM FTS11OCRD
        UNION ALL SELECT 'FTS11LEAD', DocEntry, Series, LeadCode FROM FTS11LEAD
    ) T0
    JOIN #Ser S ON S.Series = T0.Series
    WHERE ISNULL(T0.OldNum, '') <> ''
    AND S.NewPrefix <> ''
    AND S.NewPrefix NOT LIKE '%[[]%'
    AND T0.OldNum NOT LIKE REPLACE(REPLACE(S.NewPrefix, '[', '[[]'), '_', '[_]') + '%'
    AND NOT (T0.Tbl = 'FTS11LEAD' AND LEN(S.NewPrefix + T0.OldNum) > 15);

IF @Preview = 1
BEGIN
    SELECT
        T0.ObjType AS [Document Type],
        T0.SeriesCode AS [Series],
        T0.OldPrefix AS [Prefix Now],
        T0.NewPrefix AS [Prefix After],
        CASE WHEN T0.NewPrefix LIKE '%[[]%' THEN 'Skipped: prefix uses a date' WHEN ISNULL(T0.OldPrefix, '') = '' THEN 'Prefix set' ELSE 'Kept' END AS [Action]
        FROM #Ser T0
        ORDER BY T0.ObjType, T0.SeriesCode;
    SELECT
        T0.Tbl AS [Table],
        T0.DocEntry AS [DocEntry],
        T0.OldNum AS [No. Now],
        T0.NewNum AS [No. After]
        FROM #Map T0
        ORDER BY T0.Tbl, T0.DocEntry;
    SELECT
        T0.LeadCode AS [Lead Code Not Changed (longer than 15 with the prefix)]
        FROM FTS11LEAD T0
        JOIN #Ser S ON S.Series = T0.Series
        WHERE ISNULL(T0.LeadCode, '') <> ''
        AND S.NewPrefix NOT LIKE '%[[]%'
        AND T0.LeadCode NOT LIKE REPLACE(REPLACE(S.NewPrefix, '[', '[[]'), '_', '[_]') + '%'
        AND LEN(S.NewPrefix + T0.LeadCode) > 15;
    PRINT 'Preview only: nothing was changed. Set @Preview = 0 to update.';
END
ELSE
BEGIN
    BEGIN TRANSACTION;

    -- Step 1: series prefixes
    UPDATE T0 SET T0.Prefix = S.NewPrefix FROM FTS11NNM1 T0 JOIN #Ser S ON S.Series = T0.DocEntry WHERE ISNULL(T0.Prefix, '') = '' AND S.NewPrefix <> '';

    -- Step 3 first for leads: quotations / orders for a lead carry the Lead Code as their Customer
    UPDATE T0 SET T0.CardCode = M.NewNum FROM FTS11OQUT T0 JOIN #Map M ON M.Tbl = 'FTS11LEAD' AND M.OldNum = T0.CardCode;
    UPDATE T0 SET T0.CardCode = M.NewNum FROM FTS11ORDR T0 JOIN #Map M ON M.Tbl = 'FTS11LEAD' AND M.OldNum = T0.CardCode;

    -- Step 2: the numbers
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11OQUT T0 JOIN #Map M ON M.Tbl = 'FTS11OQUT' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11ORDR T0 JOIN #Map M ON M.Tbl = 'FTS11ORDR' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11ORIN T0 JOIN #Map M ON M.Tbl = 'FTS11ORIN' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11TMPR T0 JOIN #Map M ON M.Tbl = 'FTS11TMPR' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11OTRQ T0 JOIN #Map M ON M.Tbl = 'FTS11OTRQ' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11OWTR T0 JOIN #Map M ON M.Tbl = 'FTS11OWTR' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11SCIN T0 JOIN #Map M ON M.Tbl = 'FTS11SCIN' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.DocNum = M.NewNum FROM FTS11OCRD T0 JOIN #Map M ON M.Tbl = 'FTS11OCRD' AND M.DocEntry = T0.DocEntry;
    UPDATE T0 SET T0.LeadCode = M.NewNum FROM FTS11LEAD T0 JOIN #Map M ON M.Tbl = 'FTS11LEAD' AND M.DocEntry = T0.DocEntry;

    -- Step 3: Copy From references on lines (the base document's No.)
    UPDATE T0 SET T0.BaseRef = M.NewNum FROM FTS11QUT1 T0 JOIN #Map M ON M.Tbl = T0.BaseType AND M.DocEntry = T0.BaseEntry;
    UPDATE T0 SET T0.BaseRef = M.NewNum FROM FTS11RDR1 T0 JOIN #Map M ON M.Tbl = T0.BaseType AND M.DocEntry = T0.BaseEntry;
    UPDATE T0 SET T0.BaseRef = M.NewNum FROM FTS11RIN1 T0 JOIN #Map M ON M.Tbl = T0.BaseType AND M.DocEntry = T0.BaseEntry;

    COMMIT TRANSACTION;
    DECLARE @Msg NVARCHAR(100) = CONCAT('Renumbered: ', (SELECT COUNT(*) FROM #Map), ' documents.');
    PRINT @Msg;
END

DROP TABLE #Ser;
DROP TABLE #Map;
