-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 047_systemusers_chgpwdonlogon
-- Date: 2026-10-06
-- ============================================

-- ============================================
-- SystemUsers.ChgPwdOnLogon - the user must choose a new password after signing in (set by Reset Password, or
-- ticked in Users); cleared once they change it.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SystemUsers') AND name = 'ChgPwdOnLogon')
    ALTER TABLE SystemUsers ADD
        ChgPwdOnLogon       BIT                 NOT NULL CONSTRAINT DF_SystemUsers_ChgPwdOnLogon DEFAULT (0);
GO
