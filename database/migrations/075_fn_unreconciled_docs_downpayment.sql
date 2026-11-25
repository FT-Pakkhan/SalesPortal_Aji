-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 075_fn_unreconciled_docs_downpayment
-- Date: 2026-11-11
-- ============================================

-- ============================================
-- FTS_fn_UnreconciledDocs(@CardCode) - now also lists A/R Down Payment Invoices (203) not fully paid, so a
-- Temporary Receipt can pay them (posted to SAP as InvoiceType 203 with the ODPI DocEntry).
--
--   A/R Invoice               (13)  not fully paid
--   A/R Credit Memo           (14)  not fully used
--   A/R Down Payment Invoice (203)  not fully paid
--   Journal Entry             (30)  posted to the customer
--   Payment                (24/46)  not fully used; shown as a Journal Entry (TransType 30, DocNum = journal No.)
-- A/R Down Payment Requests post no journal entry, so they are not on the customer's account and are not listed.
--
-- OriTransType / OriDocEntry = the original document:
--   13 = OINV.DocEntry, 14 = ORIN.DocEntry, 203 = ODPI.DocEntry, 24 = ORCT.DocEntry, 46 = OVPM.DocEntry, 30 = OJDT.TransId
--
-- The SAP company database it reads: the SAP Database in General Settings (FTS11OADM.SapCompanyDB); if that is
-- empty, the one the function reads now (e.g. set by set-sap-database.sql); else SBODemoGB.
-- ============================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @SapDb SYSNAME = (SELECT TOP 1 NULLIF(LTRIM(RTRIM(T0.SapCompanyDB)), '') FROM FTS11OADM T0 WHERE T0.DocEntry = 1);
DECLARE @Def NVARCHAR(MAX) = OBJECT_DEFINITION(OBJECT_ID('dbo.FTS_fn_UnreconciledDocs'));
DECLARE @At INT = CHARINDEX('.dbo.JDT1', ISNULL(@Def, ''));
IF @SapDb IS NULL AND @At > 0
    SET @SapDb = REPLACE(REPLACE(LTRIM(RIGHT(LEFT(@Def, @At - 1), CHARINDEX(' ', REVERSE(LEFT(@Def, @At - 1))) - 1)), '[', ''), ']', '');
IF @SapDb IS NULL SET @SapDb = N'SBODemoGB';
IF DB_ID(@SapDb) IS NULL
BEGIN
    RAISERROR('SAP database %s does not exist on this server: check the SAP Database in General Settings.', 16, 1, @SapDb);
    RETURN;
END;

DECLARE @Sql NVARCHAR(MAX) = N'
CREATE OR ALTER FUNCTION [dbo].[FTS_fn_UnreconciledDocs] (@CardCode NVARCHAR(50))
RETURNS TABLE
AS
RETURN
(
    SELECT
        T0.ShortName AS [CardCode],
        T1.CardName AS [CardName],
        CASE WHEN T0.TransType IN (''24'', ''46'') THEN ''30'' ELSE T0.TransType END AS [TransType],
        T0.TransType AS [OriTransType],
        CASE T0.TransType WHEN ''13'' THEN ''A/R Invoice'' WHEN ''14'' THEN ''A/R Credit Memo'' WHEN ''203'' THEN ''A/R Down Payment Invoice'' ELSE ''Journal Entry'' END AS [DocType],
        CASE WHEN T0.TransType IN (''24'', ''46'') THEN CAST(T0.TransId AS NVARCHAR(20)) ELSE T0.BaseRef END AS [DocNum],
        T0.CreatedBy AS [OriDocEntry],
        T0.TransId AS [TransId],
        T0.Line_ID AS [Line_ID],
        T0.RefDate AS [PostingDate],
        T0.DueDate AS [DueDate],
        CASE WHEN T0.DueDate < CAST(GETDATE() AS DATE) THEN DATEDIFF(DAY, T0.DueDate, CAST(GETDATE() AS DATE)) ELSE 0 END AS [DaysOverdue],
        T0.Debit - T0.Credit AS [OriginalAmount],
        T0.BalDueDeb - T0.BalDueCred AS [BalanceDue],
        T0.FCCurrency AS [FCCurrency],
        T0.BalFcDeb - T0.BalFcCred AS [BalanceDueFC],
        T0.LineMemo AS [Remarks]
        FROM ' + QUOTENAME(@SapDb) + N'.dbo.JDT1 T0
        JOIN ' + QUOTENAME(@SapDb) + N'.dbo.OCRD T1 ON T1.CardCode = T0.ShortName
        WHERE T1.CardType = ''C''
        AND T0.TransType IN (''13'', ''14'', ''203'', ''30'', ''24'', ''46'')
        AND (T0.BalDueDeb <> 0 OR T0.BalDueCred <> 0)
        AND (@CardCode IS NULL OR T0.ShortName = @CardCode)
);';
EXEC sp_executesql @Sql;
PRINT 'FTS_fn_UnreconciledDocs reads ' + @SapDb;
GO
