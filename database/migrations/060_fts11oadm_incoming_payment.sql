-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 060_fts11oadm_incoming_payment
-- Date: 2026-10-09
-- ============================================

-- ============================================
-- FTS11OADM - Incoming Payment (General Settings): what a Temporary Receipt posted to SAP as an Incoming Payment uses
--   PayCashAcct    G/L account for the cash part (SAP OACT.AcctCode, e.g. 160000)
--   PayCheckAcct   G/L account for the cheques (e.g. 161016)
--   PayCreditCard  SAP credit card for the credit card part (OCRC.CreditCard, e.g. 2 Visa)
--   A bank transfer uses the chosen bank's G/L account (DSC1.GLAccount); the bank charge SAP's own Bank Charges
--   account (G/L Account Determination).
-- ============================================
IF COL_LENGTH('FTS11OADM', 'PayCashAcct') IS NULL
ALTER TABLE FTS11OADM ADD
    PayCashAcct         NVARCHAR(15)        NULL,
    PayCheckAcct        NVARCHAR(15)        NULL,
    PayCreditCard       INT                 NULL;
GO
