-- ============================================
-- Portal_Sales_COMMON Database Schema
-- Migration: 001_create_odbc
-- Date: 2026-10-29
-- ============================================

-- ============================================
-- Portal_Sales_COMMON - shared by every company: the list of companies shown at the login screen
-- ============================================
IF DB_ID('Portal_Sales_COMMON') IS NULL
    CREATE DATABASE Portal_Sales_COMMON;
GO

USE Portal_Sales_COMMON;
GO

-- ============================================
-- ODBC - one row per company: its portal database and how to connect to it.
--   CompnyName is shown in the login screen's Company drop-down.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ODBC')
CREATE TABLE ODBC (
    [Database]          NVARCHAR(128)       NOT NULL,   -- The company's portal database, e.g. Portal_Sales_AJI
    CompnyName          NVARCHAR(100)       NOT NULL,   -- Company name shown at login
    [Server]            NVARCHAR(128)       NOT NULL,   -- SQL Server name, or name\instance
    DBUserId            NVARCHAR(128)       NULL,       -- SQL login
    DBPassword          NVARCHAR(500)       NULL,       -- SQL login password
    CONSTRAINT PK_ODBC PRIMARY KEY ([Database])
);
GO
