import { db } from './db';
import { sapDatabase, sapTable } from './sapDb';
import { ValidationError } from './errors';
import { buildAddressText } from './addressText';

// Bill To / Ship To of a sales document (the Delivery tab): the customer's addresses in SAP (CRD1), each with its text
// laid out as SAP puts it on a document (lines joined by line breaks), and the customer's default ones
// (OCRD.BillToDef / ShipToDef). The document keeps the chosen address names (PayToCode / ShipToCode) and the text,
// which can be edited (Address / Address2).

export interface CustomerAddress {
  /** Address name (CRD1.Address) */
  Address: string;
  /** 'B' Bill To, 'S' Ship To */
  AdresType: 'B' | 'S';
  /** The address laid out as text: Address Line 1 .. 4, then TextTail */
  Text: string;
  /** Address Line 1 .. 4 (SAP Street / StreetNo / Block / City, as on Convert to Customer) */
  Street: string | null;
  StreetNo: string | null;
  Block: string | null;
  City: string | null;
  /** The rest of the text, kept when the lines are edited: county / state / zip code, then the country */
  TextTail: string;
  /** Delivery Zone (CRD1.U_DeliveryZone, a Code of UDT @DELIVERYZONE) and its name; null when none or no such field */
  DeliveryZone: string | null;
  DeliveryZoneName: string | null;
}

export interface CustomerAddresses {
  addresses: CustomerAddress[];
  /** The customer's default Bill To / Ship To address names; null when none */
  billToDef: string | null;
  shipToDef: string | null;
}

const join = (...parts: (string | null)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean).join(' ');

/** The address after its Address Lines: county / state / zip code, then the country (empty lines left out) */
function addressTail(a: Record<string, string | null>): string {
  return [join(a.County, a.StateName, a.ZipCode), join(a.CountryName ? a.CountryName.toUpperCase() : null)].filter(Boolean).join('\n');
}

/** The address as text, as the Delivery tab builds it (buildAddressText): Address Line 1 .. 4, then the tail */
function addressText(a: Record<string, string | null>): string {
  return buildAddressText([a.Street, a.StreetNo, a.Block, a.City], addressTail(a));
}

/** A SAP customer's Bill To and Ship To addresses (none for a code SAP doesn't have, e.g. a lead) */
export async function getCustomerAddresses(cardCode: string): Promise<CustomerAddresses> {
  // The Delivery Zone field and table are a company's own (none in a database without them)
  const zoneTable = `[${sapDatabase()}].dbo.[@DELIVERYZONE]`;
  const [check] = await db.query<{ HasField: number | null; HasTable: number | null }>(
    `SELECT COL_LENGTH(@crd1, 'U_DeliveryZone') AS HasField, OBJECT_ID(@zoneTable, 'U') AS HasTable`,
    [
      { name: 'crd1', value: `[${sapDatabase()}].dbo.CRD1` },
      { name: 'zoneTable', value: zoneTable },
    ]
  );
  const zone = check?.HasField != null ? 'a.U_DeliveryZone' : 'CAST(NULL AS NVARCHAR(50))';
  const zoneName =
    check?.HasField != null && check?.HasTable != null
      ? `(SELECT TOP 1 z.Name FROM ${zoneTable} z WHERE z.Code = a.U_DeliveryZone)`
      : 'CAST(NULL AS NVARCHAR(100))';

  const rows = await db.query<Record<string, string | null>>(
    `SELECT a.Address, a.AdresType, a.Street, a.StreetNo, a.Block, a.Building, a.City, a.ZipCode, a.County,
            (SELECT TOP 1 s.Name FROM ${sapTable('OCST')} s WHERE s.Country = a.Country AND s.Code = a.State) AS StateName,
            (SELECT TOP 1 r.Name FROM ${sapTable('OCRY')} r WHERE r.Code = a.Country) AS CountryName,
            ${zone} AS DeliveryZone, ${zoneName} AS DeliveryZoneName
     FROM ${sapTable('CRD1')} a
     WHERE a.CardCode = @cardCode AND a.AdresType IN ('B', 'S')
     ORDER BY a.AdresType, a.LineNum`,
    [{ name: 'cardCode', value: cardCode }]
  );
  const [card] = await db.query<{ BillToDef: string | null; ShipToDef: string | null }>(
    `SELECT BillToDef, ShipToDef FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`,
    [{ name: 'cardCode', value: cardCode }]
  );
  return {
    addresses: rows.map((a) => ({
      Address: a.Address as string,
      AdresType: a.AdresType as 'B' | 'S',
      Text: addressText(a),
      Street: a.Street,
      StreetNo: a.StreetNo,
      Block: a.Block,
      City: a.City,
      TextTail: addressTail(a),
      DeliveryZone: a.DeliveryZone,
      DeliveryZoneName: a.DeliveryZoneName,
    })),
    billToDef: card?.BillToDef ?? null,
    shipToDef: card?.ShipToDef ?? null,
  };
}

/**
 * A sales document's Delivery Zone (optional) must be a Code of SAP's UDT @DELIVERYZONE; not checked in a company
 * without that table (or with it empty), where the drop-down has nothing to choose
 */
export async function assertDeliveryZone(code: string | null, side: string): Promise<void> {
  if (!code) return;
  const zoneTable = `[${sapDatabase()}].dbo.[@DELIVERYZONE]`;
  const zones = await db.query<{ Code: string }>(
    `IF OBJECT_ID(@zoneTable, 'U') IS NOT NULL
       EXEC('SELECT Code FROM ${zoneTable}')
     ELSE
       SELECT CAST(NULL AS NVARCHAR(50)) AS Code WHERE 1 = 0`,
    [{ name: 'zoneTable', value: zoneTable }]
  );
  if (zones.length === 0) return;
  if (!zones.some((z) => z.Code.toLowerCase() === code.toLowerCase())) {
    throw new ValidationError(`${side} Delivery Zone ${code} is not in SAP`);
  }
}

/** An address's parts (CRD1) as SAP keeps them on a document's address tab (RDR12 etc.) */
export interface AddressParts {
  street: string | null;
  streetNo: string | null;
  block: string | null;
  building: string | null;
  city: string | null;
  zipCode: string | null;
  county: string | null;
  state: string | null;
  country: string | null;
  addrType: string | null;
  address2: string | null;
  address3: string | null;
  glblLocNum: string | null;
  /** CRD1.U_DeliveryZone; null when none or the company has no such field */
  deliveryZone: string | null;
}

/**
 * The parts of a customer's Bill To ('B') or Ship To ('S') address in SAP: the one named, or the customer's default
 * one when none is named; null when SAP has no such address (e.g. a lead's code)
 */
export async function getAddressParts(cardCode: string, type: 'B' | 'S', name: string | null): Promise<AddressParts | null> {
  const [check] = await db.query<{ HasZone: number | null }>(`SELECT COL_LENGTH(@crd1, 'U_DeliveryZone') AS HasZone`, [
    { name: 'crd1', value: `[${sapDatabase()}].dbo.CRD1` },
  ]);
  const zone = check?.HasZone != null ? 'a.U_DeliveryZone' : 'CAST(NULL AS NVARCHAR(50))';
  const rows = await db.query<AddressParts>(
    `SELECT TOP 1 a.Street AS street, a.StreetNo AS streetNo, a.Block AS block, a.Building AS building, a.City AS city,
            a.ZipCode AS zipCode, a.County AS county, a.State AS state, a.Country AS country, a.AddrType AS addrType,
            a.Address2 AS address2, a.Address3 AS address3, a.GlblLocNum AS glblLocNum, ${zone} AS deliveryZone
     FROM ${sapTable('CRD1')} a
     JOIN ${sapTable('OCRD')} c ON c.CardCode = a.CardCode
     WHERE a.CardCode = @cardCode AND a.AdresType = @type
       AND a.Address = COALESCE(@name, CASE @type WHEN 'B' THEN c.BillToDef ELSE c.ShipToDef END)`,
    [
      { name: 'cardCode', value: cardCode },
      { name: 'type', value: type },
      { name: 'name', value: name },
    ]
  );
  return rows[0] ?? null;
}

/**
 * The chosen Bill To / Ship To must be addresses of that type of the customer in SAP. A lead has none in SAP (its
 * quotation takes free-text addresses only), so any chosen one is refused.
 */
export async function assertDocumentAddresses(cardCode: string, payToCode: string | null, shipToCode: string | null): Promise<void> {
  if (payToCode === null && shipToCode === null) return;
  const { addresses } = await getCustomerAddresses(cardCode);
  const has = (type: 'B' | 'S', name: string) => addresses.some((a) => a.AdresType === type && a.Address === name);
  if (payToCode !== null && !has('B', payToCode)) throw new ValidationError(`"${payToCode}" is not a Bill To address of customer ${cardCode} in SAP`);
  if (shipToCode !== null && !has('S', shipToCode)) throw new ValidationError(`"${shipToCode}" is not a Ship To address of customer ${cardCode} in SAP`);
}
