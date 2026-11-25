-- Who confirmed the Lead / Temporary Receipt, and when (as on the Sales Quotation and Order).
-- When approval is needed: who sent it for approval, and when (kept when it is approved later).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11LEAD') AND name = 'ConfirmedBy')
    ALTER TABLE FTS11LEAD ADD
        ConfirmedBy         NVARCHAR(50)        NULL,
        ConfirmedDate       DATETIME            NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FTS11TMPR') AND name = 'ConfirmedBy')
    ALTER TABLE FTS11TMPR ADD
        ConfirmedBy         NVARCHAR(50)        NULL,
        ConfirmedDate       DATETIME            NULL;
GO
