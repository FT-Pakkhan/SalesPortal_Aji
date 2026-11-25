-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 005_systemusers_primary_key
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- SystemUsers: primary key on DocEntry.
-- Only needed for databases created before 001 had the primary key.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID('SystemUsers') AND type = 'PK')
    ALTER TABLE SystemUsers ADD CONSTRAINT PK_SystemUsers PRIMARY KEY (DocEntry);
GO

-- FTS11WST1.UserID must be an existing user
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FTS11WST1_User')
    ALTER TABLE FTS11WST1 ADD CONSTRAINT FK_FTS11WST1_User FOREIGN KEY (UserID) REFERENCES SystemUsers(DocEntry);
GO
