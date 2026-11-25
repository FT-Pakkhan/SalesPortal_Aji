-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 004_rename_systemusers_id_to_docentry
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- SystemUsers: rename Id to DocEntry, keeping all existing users.
-- Only needed for databases created before 001 was changed to use DocEntry.
-- ============================================
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SystemUsers') AND name = 'Id')
    EXEC sp_rename 'SystemUsers.Id', 'DocEntry', 'COLUMN';
GO
