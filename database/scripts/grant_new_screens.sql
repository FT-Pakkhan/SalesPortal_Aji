-- ============================================
-- Portal database: give roles access to the new screens Convert to Customer (CNVC) and Credit Memo (ORIN)
-- Date: 2026-10-24
-- ============================================

-- ============================================
-- Run in the portal database (Portal_Sales_AJI), after migrations 070 and 071.
--
-- A role sees a screen only when it has access to it (FTS11ROL2); a new screen starts with No Access, so its menu
--   item is hidden. Administrator roles (IsAdmin = 1) see every screen and are skipped.
--
-- Each role gets the same access it already has on a related screen:
--   Convert to Customer (CNVC) = the role's Lead (LEAD) access
--   Credit Memo (ORIN)         = the role's Sales Order (ORDR) access
-- Only roles with no access yet (no row, or NONE) are changed; a role whose related screen is NONE is left alone.
--
-- @Preview = 1 (default): only lists what would change, nothing is changed. Set @Preview = 0 to update.
--   Running it again changes nothing. Users see the change after they log out and in again (or refresh).
-- ============================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Preview BIT = 1;

IF OBJECT_ID('tempdb..#Grant') IS NOT NULL DROP TABLE #Grant;

SELECT
    T0.DocEntry AS [RoleEntry],
    T0.RoleName AS [Role],
    M.NewScreen AS [Screen],
    M.ScreenName AS [Screen Name],
    ISNULL(T2.Access, 'NONE') AS [Current Access],
    T1.Access AS [New Access],
    CASE WHEN T2.ScreenCode IS NULL THEN 'INSERT' ELSE 'UPDATE' END AS [Action]
INTO #Grant
FROM FTS11OROL T0
CROSS JOIN (
    SELECT 'CNVC' AS [NewScreen], 'Convert to Customer' AS [ScreenName], 'LEAD' AS [FromScreen]
    UNION ALL SELECT 'ORIN', 'Credit Memo', 'ORDR'
) M
JOIN FTS11ROL2 T1 ON T1.DocEntry = T0.DocEntry AND T1.ScreenCode = M.FromScreen AND T1.Access <> 'NONE'
LEFT JOIN FTS11ROL2 T2 ON T2.DocEntry = T0.DocEntry AND T2.ScreenCode = M.NewScreen
WHERE T0.IsAdmin = 0
AND ISNULL(T2.Access, 'NONE') = 'NONE';

SELECT
    T0.[Role] AS [Role],
    T0.[Screen Name] AS [Screen],
    T0.[Current Access] AS [Current Access],
    T0.[New Access] AS [New Access],
    T0.[Action] AS [Action]
FROM #Grant T0
ORDER BY T0.[Role], T0.[Screen];

SELECT
    T0.RoleName AS [Administrator Role (sees every screen already)]
FROM FTS11OROL T0
WHERE T0.IsAdmin = 1;

IF @Preview = 1
BEGIN
    PRINT 'Preview only - nothing changed. Set @Preview = 0 to update.';
    RETURN;
END

BEGIN TRANSACTION;

UPDATE T1 SET T1.Access = G.[New Access]
FROM FTS11ROL2 T1
JOIN #Grant G ON G.RoleEntry = T1.DocEntry AND G.[Screen] = T1.ScreenCode AND G.[Action] = 'UPDATE';

INSERT INTO FTS11ROL2 (DocEntry, ScreenCode, Access)
SELECT
    G.RoleEntry AS [DocEntry],
    G.[Screen] AS [ScreenCode],
    G.[New Access] AS [Access]
FROM #Grant G
WHERE G.[Action] = 'INSERT';

COMMIT TRANSACTION;

DECLARE @Msg NVARCHAR(200) = CONCAT('Done - ', (SELECT COUNT(*) FROM #Grant), ' role screen(s) given access.');
PRINT @Msg;
