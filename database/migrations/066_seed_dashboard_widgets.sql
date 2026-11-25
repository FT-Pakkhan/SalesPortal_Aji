-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 066_seed_dashboard_widgets
-- Date: 2026-10-10
-- ============================================

-- ============================================
-- Starter Dashboard widgets (Dashboard Settings). Added only if their Widget Code isn't there yet, so the script can
-- be run again safely and widgets changed in the portal are left alone.
--   Row 1 (4 KPIs): Sales This Month, Open Sales Orders, Overdue Receivables, Quotations Converted This Month
--   Row 2: Sales by Month (bar), Top 10 Customers (table); Row 3: Largest Overdue Invoices (table), Visits (bar)
--   Roles: every non-administrator role sees the first seven; Customer Visits is for administrators (managers) only.
--   SAP figures follow the user's Sales Employee (@SlpCode); users without one see the whole company.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'SALES-MTD')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'SALES-MTD', N'Sales This Month', 'KPI', N'SELECT
    ISNULL(SUM(CASE WHEN T0.DocDate >= @MonthStart THEN T0.DocTotal - T0.VatSum END), 0) AS [This Month],
    ISNULL(SUM(CASE WHEN T0.DocDate < @MonthStart THEN T0.DocTotal - T0.VatSum END), 0) AS [Last Month]
    FROM OINV T0
    WHERE T0.CANCELED = ''N''
    AND T0.DocDate >= DATEADD(MONTH, -1, CAST(@MonthStart AS DATE))
    AND T0.DocDate <= @Today
    AND (@SlpCode IS NULL OR T0.SlpCode = @SlpCode)', 1, 1, 10, 'AMOUNT', NULL, N'Invoiced this month before tax, compared with last month (your own customers if you have a Sales Employee).', 1, N'System', GETDATE(), N'System', GETDATE());
    INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) SELECT SCOPE_IDENTITY(), T0.DocEntry FROM FTS11OROL T0 WHERE T0.IsAdmin = 0;
END;
GO

IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'OPEN-ORDERS')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'OPEN-ORDERS', N'Open Sales Orders', 'KPI', N'SELECT
    ISNULL(SUM(T0.DocTotal - T0.VatSum), 0) AS [Open Orders]
    FROM ORDR T0
    WHERE T0.DocStatus = ''O''
    AND T0.CANCELED = ''N''
    AND (@SlpCode IS NULL OR T0.SlpCode = @SlpCode)', 1, 1, 20, 'AMOUNT', N'/sales-orders', N'Value of sales orders still open in SAP, before tax.', 1, N'System', GETDATE(), N'System', GETDATE());
    INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) SELECT SCOPE_IDENTITY(), T0.DocEntry FROM FTS11OROL T0 WHERE T0.IsAdmin = 0;
END;
GO

IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'OVERDUE')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'OVERDUE', N'Overdue Receivables', 'KPI', N'SELECT
    ISNULL(SUM(T0.DocTotal - T0.PaidToDate), 0) AS [Overdue]
    FROM OINV T0
    WHERE T0.DocStatus = ''O''
    AND T0.DocDueDate < @Today
    AND (@SlpCode IS NULL OR T0.SlpCode = @SlpCode)', 1, 1, 30, 'AMOUNT', NULL, N'Open A/R invoice balances past their due date.', 1, N'System', GETDATE(), N'System', GETDATE());
    INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) SELECT SCOPE_IDENTITY(), T0.DocEntry FROM FTS11OROL T0 WHERE T0.IsAdmin = 0;
END;
GO

IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'SQ-CONVERSION')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'SQ-CONVERSION', N'Quotations Converted This Month', 'KPI', N'SELECT
    CAST(CASE WHEN COUNT(*) = 0 THEN 0 ELSE 100.0 * SUM(X.Copied) / COUNT(*) END AS DECIMAL(9, 1)) AS [Converted]
    FROM (SELECT T0.DocEntry, CASE WHEN EXISTS (SELECT 1 FROM FTS11RDR1 T1 JOIN FTS11ORDR T2 ON T2.DocEntry = T1.DocEntry WHERE T1.BaseType = ''FTS11OQUT'' AND T1.BaseEntry = T0.DocEntry AND T2.DocStatus <> ''CANCELED'') THEN 1 ELSE 0 END AS Copied
        FROM FTS11OQUT T0
        WHERE T0.DocStatus IN (''OPEN'', ''CLOSED'')
        AND T0.DocDate >= @MonthStart
        AND (@SlpCode IS NULL OR T0.SlpCode = @SlpCode)) X', 0, 1, 40, 'PERCENT', N'/sales-quotations', N'Share of this month''s confirmed portal quotations copied to a sales order.', 1, N'System', GETDATE(), N'System', GETDATE());
    INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) SELECT SCOPE_IDENTITY(), T0.DocEntry FROM FTS11OROL T0 WHERE T0.IsAdmin = 0;
END;
GO

IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'SALES-12M')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'SALES-12M', N'Sales by Month - Last 12 Months', 'BAR', N'SELECT
    FORMAT(MIN(T0.DocDate), ''MMM yy'') AS [Month],
    SUM(T0.DocTotal - T0.VatSum) AS [Sales]
    FROM OINV T0
    WHERE T0.CANCELED = ''N''
    AND T0.DocDate >= DATEADD(MONTH, -11, CAST(@MonthStart AS DATE))
    AND (@SlpCode IS NULL OR T0.SlpCode = @SlpCode)
    GROUP BY YEAR(T0.DocDate), MONTH(T0.DocDate)
    ORDER BY YEAR(T0.DocDate), MONTH(T0.DocDate)', 1, 2, 50, 'AMOUNT', NULL, N'Invoiced per month before tax.', 1, N'System', GETDATE(), N'System', GETDATE());
    INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) SELECT SCOPE_IDENTITY(), T0.DocEntry FROM FTS11OROL T0 WHERE T0.IsAdmin = 0;
END;
GO

IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'TOP-CUSTOMERS')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'TOP-CUSTOMERS', N'Top 10 Customers This Year', 'TABLE', N'SELECT TOP 10
    T0.CardCode AS [Customer],
    T0.CardName AS [Name],
    COUNT(*) AS [Invoices],
    SUM(T0.DocTotal - T0.VatSum) AS [Sales]
    FROM OINV T0
    WHERE T0.CANCELED = ''N''
    AND T0.DocDate >= @YearStart
    AND (@SlpCode IS NULL OR T0.SlpCode = @SlpCode)
    GROUP BY T0.CardCode, T0.CardName
    ORDER BY [Sales] DESC', 1, 2, 60, 'AMOUNT', NULL, N'Invoiced this year before tax.', 1, N'System', GETDATE(), N'System', GETDATE());
    INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) SELECT SCOPE_IDENTITY(), T0.DocEntry FROM FTS11OROL T0 WHERE T0.IsAdmin = 0;
END;
GO

IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'OVERDUE-LIST')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'OVERDUE-LIST', N'Largest Overdue Invoices', 'TABLE', N'SELECT TOP 20
    T0.DocNum AS [Invoice],
    T0.CardName AS [Customer],
    T0.DocDueDate AS [Due Date],
    DATEDIFF(DAY, T0.DocDueDate, CAST(@Today AS DATE)) AS [Days Overdue],
    T0.DocTotal - T0.PaidToDate AS [Balance]
    FROM OINV T0
    WHERE T0.DocStatus = ''O''
    AND T0.DocDueDate < @Today
    AND (@SlpCode IS NULL OR T0.SlpCode = @SlpCode)
    ORDER BY T0.DocTotal - T0.PaidToDate DESC', 1, 2, 70, 'AMOUNT', NULL, N'The 20 largest open balances past their due date.', 1, N'System', GETDATE(), N'System', GETDATE());
    INSERT INTO FTS11DSH1 (DocEntry, RoleEntry) SELECT SCOPE_IDENTITY(), T0.DocEntry FROM FTS11OROL T0 WHERE T0.IsAdmin = 0;
END;
GO

IF NOT EXISTS (SELECT 1 FROM FTS11ODSH WHERE WidgetCode = N'VISITS-7D')
BEGIN
    INSERT INTO FTS11ODSH (WidgetCode, Title, WidgetType, Query, UseSapConn, Width, Sequence, ValueFormat, LinkPath, Remarks, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES (N'VISITS-7D', N'Customer Visits - Last 7 Days', 'BAR', N'SELECT
    ISNULL(T1.SlpName, ''No Sales Employee'') AS [Sales Employee],
    COUNT(*) AS [Visits]
    FROM FTS11SCIN T0
    LEFT JOIN SBODemoGB..OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.CheckInTime >= DATEADD(DAY, -6, CAST(@Today AS DATE))
    GROUP BY T1.SlpName
    ORDER BY [Visits] DESC', 0, 2, 80, 'NUMBER', N'/sales-check-ins', N'Sales Check In visits per Sales Employee (for managers).', 1, N'System', GETDATE(), N'System', GETDATE());
END;
GO

