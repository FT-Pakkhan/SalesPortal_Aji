-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 041_fn_unreconciled_docs
-- Date: 2026-10-05
-- ============================================

-- ============================================
-- FTS_fn_UnreconciledDocs(@CardCode)
--
-- A customer's unreconciled (open) items in SAP B1: the lines on the customer's account (JDT1.ShortName = CardCode)
-- that still have a balance due (BalDueDeb / BalDueCred <> 0).
--
-- Only the documents that may be reconciled are listed:
--   A/R Invoice      (13)  not fully paid
--   A/R Credit Memo  (14)  not fully used
--   Journal Entry    (30)  posted to the customer
--   Payment       (24/46)  not fully used; shown as a Journal Entry (TransType 30, DocNum = journal No.)
-- Down payments and SAP's own entries (e.g. -5 upgrade balancing) are left out.
--
-- OriTransType / OriDocEntry = the original document:
--   13 = OINV.DocEntry, 14 = ORIN.DocEntry, 24 = ORCT.DocEntry, 46 = OVPM.DocEntry, 30 = OJDT.TransId
--
-- BalanceDue > 0  the customer owes it (invoice, debit JE)
-- BalanceDue < 0  in the customer's favour (credit memo, credit JE, payment on account)
-- @CardCode NULL  every customer's unreconciled items
--
-- Created in the portal database, reading the SAP company database by name (SBODemoGB).
-- On another company database, change SBODemoGB below.
-- ============================================
CREATE OR ALTER FUNCTION [dbo].[FTS_fn_UnreconciledDocs] (@CardCode NVARCHAR(50))
RETURNS TABLE
AS
RETURN
(
    SELECT
        T0.ShortName AS [CardCode],
        T1.CardName AS [CardName],
        CASE WHEN T0.TransType IN ('24', '46') THEN '30' ELSE T0.TransType END AS [TransType],
        T0.TransType AS [OriTransType],
        CASE T0.TransType WHEN '13' THEN 'A/R Invoice' WHEN '14' THEN 'A/R Credit Memo' ELSE 'Journal Entry' END AS [DocType],
        CASE WHEN T0.TransType IN ('24', '46') THEN CAST(T0.TransId AS NVARCHAR(20)) ELSE T0.BaseRef END AS [DocNum],
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
        FROM SBODemoGB.dbo.JDT1 T0
        JOIN SBODemoGB.dbo.OCRD T1 ON T1.CardCode = T0.ShortName
        WHERE T1.CardType = 'C'
        AND T0.TransType IN ('13', '14', '30', '24', '46')
        AND (T0.BalDueDeb <> 0 OR T0.BalDueCred <> 0)
        AND (@CardCode IS NULL OR T0.ShortName = @CardCode)
);
GO

-- ============================================
-- Examples
-- ============================================
-- One customer's items:
--   SELECT * FROM FTS_fn_UnreconciledDocs('C20000') ORDER BY PostingDate, TransId, Line_ID;
--
-- Total open to reconcile per customer:
--   SELECT CardCode, CardName, SUM(BalanceDue) AS OpenToReconcile
--   FROM FTS_fn_UnreconciledDocs(NULL)
--   GROUP BY CardCode, CardName
--   ORDER BY CardCode;
