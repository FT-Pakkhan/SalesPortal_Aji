-- ============================================
-- AJI Sales Portal - point the portal database at the live SAP company database
-- ============================================
-- The portal was built against the SAP demo company SBODemoGB. A few things in the PORTAL database name that
-- company: database functions / views / procedures, Dashboard widget queries, report list queries, report e-mail
-- queries and approval template queries. This script replaces @OldDb with @NewDb in all of them.
--
-- 1. Set @NewDb below to the live SAP company database (also SAP_DB_NAME in portal.env).
-- 2. Run it in the PORTAL database (e.g. Portal_Sales_AJI) in SSMS. It can be run again safely.
-- ============================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;

DECLARE @OldDb SYSNAME = N'SBODemoGB';
DECLARE @NewDb SYSNAME = N'CHANGE_ME';     -- <== the live SAP company database

IF @NewDb = N'CHANGE_ME' OR DB_ID(@NewDb) IS NULL
BEGIN
    RAISERROR('Set @NewDb to the live SAP company database first (it must exist on this SQL Server).', 16, 1);
    RETURN;
END;

BEGIN TRANSACTION;

-- Functions / views / procedures: dropped and created again from their own text with the new name (inside this
-- transaction, so a failure leaves them as they were)
DECLARE @Name NVARCHAR(300), @Kind NVARCHAR(20), @Def NVARCHAR(MAX), @Drop NVARCHAR(400);
DECLARE Modules CURSOR LOCAL FAST_FORWARD FOR
    SELECT
        QUOTENAME(OBJECT_SCHEMA_NAME(T0.object_id)) + '.' + QUOTENAME(OBJECT_NAME(T0.object_id)) AS [Name],
        CASE WHEN T1.type IN ('FN', 'IF', 'TF') THEN 'FUNCTION' WHEN T1.type = 'V' THEN 'VIEW' WHEN T1.type = 'P' THEN 'PROCEDURE' END AS [Kind],
        T0.definition AS [Def]
        FROM sys.sql_modules T0
        JOIN sys.objects T1 ON T1.object_id = T0.object_id
        WHERE T0.definition LIKE '%' + @OldDb + '%'
        AND T1.type IN ('FN', 'IF', 'TF', 'V', 'P');
OPEN Modules;
FETCH NEXT FROM Modules INTO @Name, @Kind, @Def;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @Drop = N'DROP ' + @Kind + N' ' + @Name;
    EXEC sp_executesql @Drop;
    SET @Def = REPLACE(@Def, @OldDb, @NewDb);
    EXEC sp_executesql @Def;
    PRINT 'Updated ' + @Name;
    FETCH NEXT FROM Modules INTO @Name, @Kind, @Def;
END;
CLOSE Modules;
DEALLOCATE Modules;

-- Queries saved in the portal's settings
UPDATE FTS11ODSH SET Query = REPLACE(Query, @OldDb, @NewDb) WHERE Query LIKE '%' + @OldDb + '%';
PRINT CONCAT('Dashboard widgets: ', @@ROWCOUNT);
UPDATE FTS11RPT1 SET Query = REPLACE(Query, @OldDb, @NewDb) WHERE Query LIKE '%' + @OldDb + '%';
PRINT CONCAT('Report parameter lists: ', @@ROWCOUNT);
UPDATE FTS11SRPT SET EmailToQuery = REPLACE(EmailToQuery, @OldDb, @NewDb) WHERE EmailToQuery LIKE '%' + @OldDb + '%';
PRINT CONCAT('Report e-mail queries: ', @@ROWCOUNT);
UPDATE FTS11OWTM SET Query = REPLACE(Query, @OldDb, @NewDb) WHERE Query LIKE '%' + @OldDb + '%';
PRINT CONCAT('Approval template queries: ', @@ROWCOUNT);

COMMIT TRANSACTION;
PRINT 'Done: ' + @OldDb + ' -> ' + @NewDb;
GO
