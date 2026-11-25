-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 057_fts11tmpr_payment_means
-- Date: 2026-10-09
-- ============================================

-- ============================================
-- FTS11TMPR - Payment Means (as in SAP B1's Incoming Payment): how the customer paid, keyed in the Payment Means
--   popup (tabs Cheque / Bank Transfer / Credit Card / Cash) instead of choosing the Payment Type.
--   CheckNum / CheckSum   Cheque No. and its amount
--   TrsfrSum / TrsfrBank  Bank Transfer amount and the company bank account it went to (SAP house bank account,
--                         DSC1.AbsEntry, e.g. CIMB 3434)
--   CreditSum             Credit Card amount
--   CashSum               Cash amount
--   BcgSum                Bank Charge: one for the whole receipt, as in SAP B1 (ORCT.BcgSum)
--   DocTotal (Amount) = CheckSum + TrsfrSum + CreditSum + CashSum + BcgSum, worked out by the portal.
--   PayTyp (Payment Type) is set by the portal: the one payment mean used, or MP (Multiple Type) when more than one.
-- ============================================
IF COL_LENGTH('FTS11TMPR', 'CashSum') IS NULL
ALTER TABLE FTS11TMPR ADD
    CheckNum            NVARCHAR(20)        NULL,
    CheckSum            NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11TMPR_CheckSum DEFAULT (0),
    TrsfrSum            NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11TMPR_TrsfrSum DEFAULT (0),
    TrsfrBank           INT                 NULL,       -- SAP house bank account (DSC1.AbsEntry)
    CreditSum           NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11TMPR_CreditSum DEFAULT (0),
    CashSum             NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11TMPR_CashSum DEFAULT (0),
    BcgSum              NUMERIC(19,6)       NOT NULL CONSTRAINT DF_FTS11TMPR_BcgSum DEFAULT (0);
GO
