-- ============================================
-- Portal_Sales_AJI Database Schema
-- Migration: 055_fts11lead_application_form
-- Date: 2026-10-08
-- ============================================

-- ============================================
-- FTS11LEAD - the fields of the New Account Application Form (F/SM/012 Rev 03).
--   Form field                     -> column
--   Date                           -> DocDate
--   Account No                     -> CardCode (exists: the SAP customer code, given by Post to SAP)
--   Agent Code / Sales Personal    -> SlpCode (exists)
--   1  Company Name *              -> LeadName (exists)
--   2  Company Register No *       -> RegNo
--   3  Year in Business            -> YearsInBiz
--   4  Business Address *          -> BillStreet, BillBlock, BillCity, BillZipCode, BillState, BillCountry
--   5  Delivery Address            -> ShipSameAsBill, ShipStreet ... ShipCountry
--   6  In-Charge Persons           -> FTS11LED1 (Purchasing / Receiving / Account * / Others), see below
--   7  E-mail                      -> Email
--   8  E-mail (E-invoice) *        -> EInvEmail
--   9  Director / Boss (a - d)     -> FTS11LED1 (Role DIRECTOR)
--   10 Nature of Business *        -> NatureOfBiz
--   11 Main Products               -> MainProducts
--   12 Major Suppliers (a, b)      -> Supplier1, Supplier2
--   13 Recommended Credit Limit    -> RecCreditLine
--   14 Credit Term                 -> GroupNum (SAP payment terms, OCTG)
--   15 Approved Credit Limit       -> CreditLine
--   16 MSIC Code *                 -> MsicCode
--   17 Tax Identification No. *    -> TIN
--   18 SST No                      -> SstNo
--   (The form's signature part - Company Chop & Sign, Sales Personal, Approved By, Key in by, Checked by - isn't kept.)
--   Addresses use SAP's country / state codes (OCRY / OCST), as e-invoicing needs codes.
--   * fields are required when the lead is confirmed (a draft may be saved incomplete).
-- ============================================
IF COL_LENGTH('FTS11LEAD', 'DocDate') IS NULL
ALTER TABLE FTS11LEAD ADD
    DocDate             DATETIME            NULL,       -- Date of the application
    RegNo               NVARCHAR(50)        NULL,       -- Company Register No (SSM / BRN) *
    YearsInBiz          INT                 NULL,       -- Year in Business
    BillStreet          NVARCHAR(254)       NULL,       -- Business Address line 1 *
    BillBlock           NVARCHAR(100)       NULL,       -- Business Address line 2
    BillCity            NVARCHAR(100)       NULL,       -- *
    BillZipCode         NVARCHAR(20)        NULL,       -- Postcode *
    BillState           NVARCHAR(3)         NULL,       -- SAP OCST.Code *
    BillCountry         NVARCHAR(3)         NULL,       -- SAP OCRY.Code, e.g. MY *
    ShipSameAsBill      BIT                 NOT NULL CONSTRAINT DF_FTS11LEAD_ShipSameAsBill DEFAULT (1),
    ShipStreet          NVARCHAR(254)       NULL,       -- Delivery Address (when not the same as the business address)
    ShipBlock           NVARCHAR(100)       NULL,
    ShipCity            NVARCHAR(100)       NULL,
    ShipZipCode         NVARCHAR(20)        NULL,
    ShipState           NVARCHAR(3)         NULL,
    ShipCountry         NVARCHAR(3)         NULL,
    Email               NVARCHAR(100)       NULL,
    EInvEmail           NVARCHAR(100)       NULL,       -- E-mail for e-invoices *
    NatureOfBiz         NVARCHAR(254)       NULL,       -- *
    MainProducts        NVARCHAR(254)       NULL,
    Supplier1           NVARCHAR(100)       NULL,       -- Major Suppliers a.
    Supplier2           NVARCHAR(100)       NULL,       -- Major Suppliers b.
    RecCreditLine       NUMERIC(19,6)       NULL,       -- Recommended Credit Limit (sales)
    CreditLine          NUMERIC(19,6)       NULL,       -- Approved Credit Limit
    GroupNum            INT                 NULL,       -- Credit Term: SAP payment terms (OCTG.GroupNum)
    MsicCode            NVARCHAR(10)        NULL,       -- MSIC Code (5 digits) *
    TIN                 NVARCHAR(20)        NULL,       -- Tax Identification No. *
    SstNo               NVARCHAR(30)        NULL;       -- SST registration No
GO

-- ============================================
-- FTS11LED1 - Contact persons of a lead (the lead's "Contacts" tab): the form's In-Charge Persons and Directors.
--   Role: PURCHASING, RECEIVING, ACCOUNT (Account Dept: contact no. required on Confirm), DIRECTOR, OTHERS
--   RoleDesc: for OTHERS, which department / role (the form's "Pls mention")
--   Posted to SAP as the business partner's contact persons.
-- ============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FTS11LED1')
CREATE TABLE FTS11LED1 (
    DocEntry            INT                 NOT NULL,   -- Lead (FTS11LEAD.DocEntry)
    LineNum             INT                 NOT NULL,   -- 0, 1, 2 ... in screen order
    Role                NVARCHAR(20)        NOT NULL,
    RoleDesc            NVARCHAR(100)       NULL,
    Name                NVARCHAR(100)       NOT NULL,
    Tel                 NVARCHAR(30)        NULL,       -- Contact No.
    Email               NVARCHAR(100)       NULL,
    CONSTRAINT PK_FTS11LED1            PRIMARY KEY (DocEntry, LineNum),
    CONSTRAINT FK_FTS11LED1_Lead       FOREIGN KEY (DocEntry) REFERENCES FTS11LEAD(DocEntry),
    CONSTRAINT CK_FTS11LED1_Role       CHECK (Role IN ('PURCHASING', 'RECEIVING', 'ACCOUNT', 'DIRECTOR', 'OTHERS'))
);
GO
