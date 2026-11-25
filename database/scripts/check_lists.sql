-- ============================================
-- Why a list screen shows "No Rows To Show" although its table has rows. Read-only.
-- Run it in the company's portal database (e.g. Portal_Sales_AJIMLS). It runs the same queries as the
-- Dashboard Settings and Temporary Receipt lists and shows OK or the SQL Server error for each.
-- ============================================
SET NOCOUNT ON;

DECLARE @SapDb NVARCHAR(128) = (SELECT TOP 1 T0.SapCompanyDB FROM FTS11OADM T0 WHERE T0.DocEntry = 1);
DECLARE @Result TABLE ([Check] NVARCHAR(100), [Result] NVARCHAR(MAX));
DECLARE @Sql NVARCHAR(MAX);
DECLARE @Rows INT;

-- 1. The server, and the SAP database in General Settings
INSERT INTO @Result VALUES ('SQL Server version', CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) + ' (' + CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100)) + '); 14.x or higher = 2017 or later');
INSERT INTO @Result VALUES ('Portal database', DB_NAME() + ', compatibility level ' + CAST((SELECT T0.compatibility_level FROM sys.databases T0 WHERE T0.name = DB_NAME()) AS NVARCHAR(10)));
INSERT INTO @Result VALUES ('SAP Database (General Settings)', ISNULL(@SapDb, '(empty)') + CASE WHEN @SapDb IS NULL THEN '' WHEN DB_ID(@SapDb) IS NULL THEN ' - NOT FOUND on this server' ELSE ' - found' END);
INSERT INTO @Result VALUES ('Table rows', 'FTS11ODSH ' + CAST((SELECT COUNT(*) FROM FTS11ODSH) AS NVARCHAR(10)) + ', FTS11TMPR ' + CAST((SELECT COUNT(*) FROM FTS11TMPR) AS NVARCHAR(10)));

-- 2. STRING_AGG (Dashboard Settings: the Roles column)
BEGIN TRY
    EXEC sp_executesql N'DECLARE @Names NVARCHAR(MAX) = (SELECT STRING_AGG(T0.name, '', '') FROM (SELECT TOP 2 name FROM sys.objects) T0)';
    INSERT INTO @Result VALUES ('STRING_AGG', 'OK');
END TRY
BEGIN CATCH
    INSERT INTO @Result VALUES ('STRING_AGG', 'ERROR: ' + ERROR_MESSAGE());
END CATCH;

-- 3. The Dashboard Settings list
BEGIN TRY
    SET @Sql = N'SELECT @Rows = COUNT(*) FROM (
        SELECT T0.DocEntry, T0.WidgetCode, T0.Title, T0.WidgetType, T0.Query, T0.UseSapConn, T0.Width, T0.Sequence, T0.ValueFormat,
               T0.LinkPath, T0.Remarks, T0.IsActive, T0.CreatedBy, T0.CreatedDate, T0.UpdatedBy, T0.UpdatedDate,
               (SELECT STRING_AGG(T2.RoleName, '', '') FROM FTS11DSH1 T1 JOIN FTS11OROL T2 ON T2.DocEntry = T1.RoleEntry WHERE T1.DocEntry = T0.DocEntry) AS [RoleNames]
        FROM FTS11ODSH T0) X';
    EXEC sp_executesql @Sql, N'@Rows INT OUTPUT', @Rows OUTPUT;
    INSERT INTO @Result VALUES ('Dashboard Settings list', 'OK - ' + CAST(@Rows AS NVARCHAR(10)) + ' row(s)');
END TRY
BEGIN CATCH
    INSERT INTO @Result VALUES ('Dashboard Settings list', 'ERROR: ' + ERROR_MESSAGE());
END CATCH;

-- 4. The Temporary Receipt list (reads the bank account from the SAP database)
BEGIN TRY
    IF @SapDb IS NULL OR DB_ID(@SapDb) IS NULL
        THROW 50000, 'The SAP Database in General Settings is empty or does not exist on this server.', 1;
    SET @Sql = N'SELECT @Rows = COUNT(*) FROM (
        SELECT T0.DocEntry, T0.DocNum, T0.Series, T1.Series AS [SeriesCode], T1.SeriesName,
               T0.CardCode, T0.CardName, T0.PayTyp, T2.Name AS [PayTypName], T0.DocTotal,
               T0.DocStatus, T3.Name AS [DocStatusName], T0.ApprStatus, T4.Name AS [ApprStatusName],
               T0.PostStatus, T5.Name AS [PostStatusName], T0.ErrorDesc, T0.SAPDocNum, T0.SAPDocEntry, T0.Comments, T0.ConfirmedBy, T0.ConfirmedDate, T0.NoDocSum,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM FTS11WDD1 T6 WHERE T6.ObjType = ''FTS11TMPR'' AND T6.DocEntry = T0.DocEntry) THEN 1 ELSE 0 END AS BIT) AS [ApprLocked],
               T0.CheckSum, T0.TrsfrSum, T0.TrsfrBank, T0.CreditSum, T0.CashSum, T0.BcgSum,
               (SELECT CONCAT(T7.BankCode, '' - '', T7.Account) FROM ' + QUOTENAME(@SapDb) + N'.dbo.DSC1 T7 WHERE T7.AbsEntry = T0.TrsfrBank) AS [TrsfrBankName],
               T0.BaseType, T0.BaseEntry, (SELECT T8.DocNum FROM FTS11OTRQ T8 WHERE T8.DocEntry = T0.BaseEntry) AS [BaseDocNum]
        FROM FTS11TMPR T0
        LEFT JOIN FTS11NNM1 T1 ON T1.DocEntry = T0.Series
        LEFT JOIN FTS_vw_PayTyp T2 ON T2.Code = T0.PayTyp
        LEFT JOIN FTS_vw_DocStatus T3 ON T3.Code = T0.DocStatus
        LEFT JOIN FTS_vw_ApprStatus T4 ON T4.Code = T0.ApprStatus
        LEFT JOIN FTS_vw_PostStatus T5 ON T5.Code = T0.PostStatus) X';
    EXEC sp_executesql @Sql, N'@Rows INT OUTPUT', @Rows OUTPUT;
    INSERT INTO @Result VALUES ('Temporary Receipt list', 'OK - ' + CAST(@Rows AS NVARCHAR(10)) + ' row(s)');
END TRY
BEGIN CATCH
    INSERT INTO @Result VALUES ('Temporary Receipt list', 'ERROR: ' + ERROR_MESSAGE());
END CATCH;

SELECT
    T0.[Check] AS [Check],
    T0.[Result] AS [Result]
FROM @Result T0;
