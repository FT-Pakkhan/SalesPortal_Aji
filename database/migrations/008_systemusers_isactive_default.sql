-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 008_systemusers_isactive_default
-- Date: 2026-10-01
-- ============================================

-- ============================================
-- SystemUsers: a new user is active unless stated otherwise.
-- Only needed for databases created before 001 had the default.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_SystemUsers_IsActive')
    ALTER TABLE SystemUsers ADD CONSTRAINT DF_SystemUsers_IsActive DEFAULT 1 FOR IsActive;
GO
