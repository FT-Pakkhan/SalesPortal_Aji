-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 001_create_system_users
-- Date: 2026-09-30
-- ============================================

-- ============================================
-- SystemUsers - Sales portal users
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SystemUsers')
CREATE TABLE SystemUsers (
    DocEntry        INT IDENTITY(1,1)   NOT NULL,
    UserName        NVARCHAR(50)        NULL,
    DisplayName     NVARCHAR(100)       NULL,
    PasswordHash    NVARCHAR(255)       NULL,
    Email           NVARCHAR(200)       NULL,
    IsActive        BIT                 NULL        CONSTRAINT DF_SystemUsers_IsActive DEFAULT 1,  -- ticked for a new user
    CreatedBy       NVARCHAR(50)        NULL,
    CreatedDate     DATETIME            NULL,
    UpdatedBy       NVARCHAR(50)        NULL,
    UpdatedDate     DATETIME            NULL,
    LastLoginDate   DATETIME            NULL,
    CONSTRAINT PK_SystemUsers  PRIMARY KEY (DocEntry)
);
GO
