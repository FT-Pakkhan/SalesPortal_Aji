-- ============================================
-- AJI Sales Portal - first administrator for a NEW portal database
-- ============================================
-- After running the migrations on an empty database there is no user to log in with. This creates the user Admin
-- (no password; the portal asks for a new password at the first log in) in the Administrator role.
-- Run it once in the PORTAL database. Not needed when the portal database was copied from another server.
-- ============================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;

BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM SystemUsers WHERE UserName = 'Admin')
    INSERT INTO SystemUsers (UserName, DisplayName, IsActive, ChgPwdOnLogon, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES ('Admin', 'Administrator', 1, 1, 'System', GETDATE(), 'System', GETDATE());

IF NOT EXISTS (SELECT 1 FROM FTS11OROL WHERE IsAdmin = 1)
    INSERT INTO FTS11OROL (RoleName, IsAdmin, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
    VALUES ('Administrator', 1, 'System', GETDATE(), 'System', GETDATE());

INSERT INTO FTS11ROL1 (DocEntry, UserID)
    SELECT
        (SELECT MIN(T1.DocEntry) FROM FTS11OROL T1 WHERE T1.IsAdmin = 1) AS [DocEntry],
        T0.DocEntry AS [UserID]
        FROM SystemUsers T0
        WHERE T0.UserName = 'Admin'
        AND NOT EXISTS (SELECT 1 FROM FTS11ROL1 T2 JOIN FTS11OROL T3 ON T3.DocEntry = T2.DocEntry WHERE T2.UserID = T0.DocEntry AND T3.IsAdmin = 1);

COMMIT TRANSACTION;
PRINT 'User Admin is ready: log in with user name Admin and an empty password, then choose a password.';
GO
