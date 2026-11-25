// Excel export for list views: bold header row on a gold background, a thin border around every cell.
// .xlsx is written with xlsx-js-style. That library cannot style .xls files, so .xls is
// written here as a small BIFF8 (Excel 97-2003) workbook with the same look.

export type ExcelFormat = 'xlsx' | 'xls';
export type ExcelCell = string | number | boolean | null | undefined;

export interface ExcelExportOptions {
  /** File name without extension */
  fileName: string;
  sheetName: string;
  header: string[];
  rows: ExcelCell[][];
  /** Column widths in pixels, one per header */
  colWidthsPx: number[];
  format: ExcelFormat;
}

/** Background colour of the header row (Excel's standard gold) */
const HEADER_FILL_RGB = 'FFC000';

/** .xls cannot hold more than 65,536 rows or 256 columns */
export const XLS_MAX_ROWS = 65536;
export const XLS_MAX_COLS = 256;

export async function exportToExcel(options: ExcelExportOptions): Promise<void> {
  const { fileName, sheetName, header, rows, colWidthsPx, format } = options;
  const XLSX = await import('xlsx-js-style');
  const name = sheetName.slice(0, 31);

  if (format === 'xls') {
    const cfb = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(cfb, '/Workbook', buildXlsWorkbookStream(name, header, rows, colWidthsPx));
    const content = XLSX.CFB.write(cfb, { type: 'array' }) as unknown as ArrayLike<number>;
    downloadFile(new Uint8Array(content), `${fileName}.xls`, 'application/vnd.ms-excel');
    return;
  }

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows.map((row) => row.map((value) => value ?? ''))]);
  const edge = { style: 'thin', color: { rgb: '000000' } };
  const border = { top: edge, bottom: edge, left: edge, right: edge };
  for (let r = 0; r <= rows.length; r++) {
    for (let c = 0; c < header.length; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      // Empty cells are skipped by aoa_to_sheet — create them so they are boxed too
      if (!sheet[address]) sheet[address] = { t: 's', v: '' };
      sheet[address].s = r === 0
        ? { border, font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: HEADER_FILL_RGB } } }
        : { border };
    }
  }
  sheet['!cols'] = colWidthsPx.map((wpx) => ({ wpx }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, name);
  XLSX.writeFile(book, `${fileName}.xlsx`, { bookType: 'xlsx' });
}

function downloadFile(content: Uint8Array, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================
// BIFF8 (.xls) writer
// ============================================

// Cell format indexes (XF records) written by buildXlsWorkbookStream
const XF_BOXED = 16;
const XF_HEADER = 17;

// .xls cells can only use colours from the workbook palette (indexes 8-63). This is Excel's
// default palette; PALETTE_HEADER_FILL is replaced with the header colour.
const PALETTE_HEADER_FILL = 51;
const DEFAULT_PALETTE = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

/** PALETTE — the workbook's 56 colours, with the header colour in its slot */
function palette(): Uint8Array {
  const colours = [...DEFAULT_PALETTE];
  colours[PALETTE_HEADER_FILL - 8] = HEADER_FILL_RGB;
  return record(0x0092, bytes(2 + colours.length * 4, (v) => {
    v.setUint16(0, colours.length, true);
    colours.forEach((rgb, i) => {
      v.setUint8(2 + i * 4, parseInt(rgb.slice(0, 2), 16));
      v.setUint8(3 + i * 4, parseInt(rgb.slice(2, 4), 16));
      v.setUint8(4 + i * 4, parseInt(rgb.slice(4, 6), 16));
    });
  }));
}

function record(id: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, id, true);
  view.setUint16(2, data.length, true);
  out.set(data, 4);
  return out;
}

function bytes(size: number, fill: (view: DataView, data: Uint8Array) => void): Uint8Array {
  const data = new Uint8Array(size);
  fill(new DataView(data.buffer), data);
  return data;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/** BOF — type 0x0005 = workbook globals, 0x0010 = worksheet */
function bof(type: number): Uint8Array {
  return record(0x0809, bytes(16, (v) => {
    v.setUint16(0, 0x0600, true);
    v.setUint16(2, type, true);
    v.setUint16(4, 0x0DBB, true);
    v.setUint16(6, 0x07CC, true);
    v.setUint32(12, 6, true);
  }));
}

function eof(): Uint8Array {
  return record(0x000A, new Uint8Array(0));
}

/** FONT — Calibri 11pt */
function font(bold: boolean): Uint8Array {
  const name = 'Calibri';
  return record(0x0031, bytes(16 + name.length, (v, d) => {
    v.setUint16(0, 220, true);
    v.setUint16(4, 0x7FFF, true); // automatic colour
    v.setUint16(6, bold ? 700 : 400, true);
    v.setUint8(14, name.length);
    for (let i = 0; i < name.length; i++) d[16 + i] = name.charCodeAt(i);
  }));
}

/**
 * XF — a cell format: which font, whether the cell has a thin black border on all sides,
 * and an optional solid background colour (a palette index)
 */
function xf(options: { fontIndex: number; style: boolean; used: number; boxed?: boolean; fill?: number }): Uint8Array {
  return record(0x00E0, bytes(20, (v) => {
    v.setUint16(0, options.fontIndex, true);
    v.setUint16(4, options.style ? 0xFFF5 : 0x0001, true); // style format / cell format
    v.setUint8(6, 0x20); // bottom-aligned
    v.setUint8(9, options.used);
    let bordersAndFill = 0;
    if (options.boxed) {
      v.setUint16(10, 0x1111, true); // thin left, right, top, bottom
      v.setUint16(12, 8 | (8 << 7), true); // black left / right
      bordersAndFill = 8 | (8 << 7); // black top / bottom
    }
    if (options.fill !== undefined) bordersAndFill |= 1 << 26; // solid fill pattern
    v.setUint32(14, bordersAndFill, true);
    v.setUint16(18, (options.fill ?? 0x40) | (0x41 << 7), true); // fill colour / pattern background
  }));
}

function buildXlsWorkbookStream(
  sheetName: string,
  header: string[],
  rows: ExcelCell[][],
  colWidthsPx: number[]
): Uint8Array {
  const globals = concat([
    bof(0x0005),
    record(0x0042, bytes(2, (v) => v.setUint16(0, 1200, true))), // CODEPAGE: UTF-16
    record(0x003D, bytes(18, (v) => { // WINDOW1
      v.setUint16(4, 0x4000, true);
      v.setUint16(6, 0x2000, true);
      v.setUint16(8, 0x0038, true);
      v.setUint16(14, 1, true);
      v.setUint16(16, 600, true);
    })),
    font(false), font(false), font(false), font(false), // font indexes 0-3
    font(true), // font index 5 (index 4 is never used in this format)
    ...Array.from({ length: 15 }, (_, i) => xf({ fontIndex: 0, style: true, used: i === 0 ? 0 : 0xF4 })),
    xf({ fontIndex: 0, style: false, used: 0 }), // 15: default cell format
    xf({ fontIndex: 0, style: false, used: 0x28, boxed: true }), // 16: XF_BOXED
    xf({ fontIndex: 5, style: false, used: 0x68, boxed: true, fill: PALETTE_HEADER_FILL }), // 17: XF_HEADER
    record(0x0293, bytes(4, (v) => { // STYLE: Normal
      v.setUint16(0, 0x8000, true);
      v.setUint8(3, 0xFF);
    })),
    palette(),
  ]);

  // BOUNDSHEET holds the position of the worksheet, which starts after it and the globals' EOF
  const boundsheetSize = 4 + 8 + sheetName.length * 2;
  const sheetOffset = globals.length + boundsheetSize + 4;
  const boundsheet = record(0x0085, bytes(8 + sheetName.length * 2, (v) => {
    v.setUint32(0, sheetOffset, true);
    v.setUint8(6, sheetName.length);
    v.setUint8(7, 1); // UTF-16 name
    for (let i = 0; i < sheetName.length; i++) v.setUint16(8 + i * 2, sheetName.charCodeAt(i), true);
  }));

  const allRows: ExcelCell[][] = [header, ...rows];
  const cells: Uint8Array[] = [];
  allRows.forEach((row, r) => {
    const format = r === 0 ? XF_HEADER : XF_BOXED;
    for (let c = 0; c < header.length; c++) {
      const value = row[c];
      if (typeof value === 'number' && Number.isFinite(value)) {
        cells.push(record(0x0203, bytes(14, (v) => { // NUMBER
          v.setUint16(0, r, true);
          v.setUint16(2, c, true);
          v.setUint16(4, format, true);
          v.setFloat64(6, value, true);
        })));
      } else {
        // A record holds at most 8,224 bytes, so very long text is cut
        const text = String(value ?? '').slice(0, 4000);
        cells.push(record(0x0204, bytes(9 + text.length * 2, (v) => { // LABEL
          v.setUint16(0, r, true);
          v.setUint16(2, c, true);
          v.setUint16(4, format, true);
          v.setUint16(6, text.length, true);
          v.setUint8(8, 1); // UTF-16 text
          for (let i = 0; i < text.length; i++) v.setUint16(9 + i * 2, text.charCodeAt(i), true);
        })));
      }
    }
  });

  const sheet = concat([
    bof(0x0010),
    ...colWidthsPx.map((px, c) => record(0x007D, bytes(12, (v) => { // COLINFO: column width
      v.setUint16(0, c, true);
      v.setUint16(2, c, true);
      v.setUint16(4, Math.round((px / 7) * 256), true);
      v.setUint16(6, 15, true);
    }))),
    record(0x0200, bytes(14, (v) => { // DIMENSIONS
      v.setUint32(4, allRows.length, true);
      v.setUint16(10, header.length, true);
    })),
    ...cells,
    record(0x023E, bytes(18, (v) => { // WINDOW2
      v.setUint16(0, 0x06B6, true);
      v.setUint32(6, 0x40, true);
    })),
    eof(),
  ]);

  return concat([globals, boundsheet, eof(), sheet]);
}
