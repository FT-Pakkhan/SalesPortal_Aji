import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { getSavedSmtpConfig } from './generalSettings';
import { sendMail } from './mail';
import { renderLayoutPdf } from './crystal';
import { getPrintableLayout, printableDocument } from './printLayouts';
import { parseAddressList } from './reports';
import { safeFileName, userOf } from './reportEmail';
import { sapTable } from './sapDb';

// E-mailing a printed layout (System Initialization > Layouts, "Allow E-mail"): from the printed PDF's window the user
// opens the E-mail form, filled in with the customer's e-mail, subject / attachment "<Document> <No.>" and a short
// message; Send prints the document again with the layout, mails the PDF through General Settings > SMTP and writes
// the E-mail Log (FTS11OEML, with the layout and the document).

/** The layout (it must allow e-mail) and the document: its type name, No. and the e-mail address to offer */
async function prepare(layoutEntry: number, body: Record<string, unknown>) {
  const objType = String(body.objType ?? '');
  const docEntry = Number(body.docEntry);
  const doc = printableDocument(objType);
  if (!Number.isInteger(docEntry) || docEntry <= 0) throw new ValidationError('Document is not valid');

  const layout = await getPrintableLayout(layoutEntry, objType);
  if (!layout.EmailAllowed) throw new ValidationError(`Layout ${layout.LayoutName} is not set to be e-mailed (Layouts > Allow E-mail)`);

  // The names come from the fixed PRINTABLE list, never from the request
  const rows = await db.query<{ DocNo: string | number | null; CardCode: string | null; Email: string | null; TypeName: string | null }>(
    `SELECT h.[${doc.number}] AS DocNo, h.CardCode AS CardCode, ${doc.email ? `h.[${doc.email}]` : 'NULL'} AS Email,
            (SELECT Name FROM FTS_vw_ObjType WHERE Code = @objType) AS TypeName
     FROM ${doc.header} h WHERE h.DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'objType', value: objType },
    ]
  );
  const row = rows[0];
  if (!row) throw new NotFoundError(doc.label);
  const docRef = `${row.TypeName ?? doc.label} ${row.DocNo ?? '(Draft)'}`.slice(0, 100);
  return { objType, docEntry, layout, row, docRef };
}

/** The customer's e-mail address in SAP (OCRD.E_Mail); empty when there is none or SAP can't be read */
async function sapEmailOf(cardCode: string | null): Promise<string> {
  if (!cardCode) return '';
  try {
    const rows = await db.query<{ E_Mail: string | null }>(`SELECT E_Mail FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode`, [
      { name: 'cardCode', value: cardCode },
    ]);
    return rows[0]?.E_Mail?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Only the addresses that are valid, so the form opens even when the stored e-mail has a mistake */
function validAddresses(value: string): string {
  return value
    .split(/[;,]/)
    .map((a) => a.trim())
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))
    .join('; ');
}

/** The E-mail form, filled in; the user can change all of it before sending */
export async function getLayoutEmailDraft(layoutEntry: number, userId: number, body: Record<string, unknown>) {
  const { row, docRef } = await prepare(layoutEntry, body);
  const user = await userOf(userId);
  const to = validAddresses(row.Email?.trim() || (await sapEmailOf(row.CardCode)));
  return {
    To: to,
    Cc: '',
    Subject: docRef,
    Body: `Dear Sir / Madam,\n\nPlease find attached ${docRef}.\n\nRegards,\n${user.DisplayName ?? user.UserName}`,
    FileName: safeFileName(docRef),
    MyEmail: user.Email ?? null,
  };
}

/**
 * Send: print the document with the layout, mail the PDF, and log it (SENT or FAILED with the mail server's error).
 * Returns { sent, message }; a mail server refusal is an answer, not an error (it is in the log too).
 */
export async function sendLayoutEmail(layoutEntry: number, userId: number, body: Record<string, unknown>) {
  const { objType, docEntry, layout, docRef } = await prepare(layoutEntry, body);
  const user = await userOf(userId);

  const to = parseAddressList(body.to, 'To');
  if (!to) throw new ValidationError('Enter at least one e-mail address in To');
  let cc = parseAddressList(body.cc, 'CC');
  if (body.copyMe === true) {
    if (!user.Email) throw new ValidationError('Your user has no e-mail address for a copy (Users > E-mail)');
    cc = parseAddressList([cc, user.Email].filter(Boolean).join(';'), 'CC');
  }
  const subject = String(body.subject ?? '').trim();
  if (!subject) throw new ValidationError('Subject is required');
  if (subject.length > 254) throw new ValidationError('Subject must be 254 characters or fewer');
  const text = String(body.body ?? '');
  const fileName = `${safeFileName(String(body.fileName ?? '') || docRef)}.pdf`;

  // Everything needed to send is checked before the document is printed
  const smtp = await getSavedSmtpConfig();
  const pdf = await renderLayoutPdf(layout.LayoutPath, docEntry);

  const result = await sendMail(smtp, {
    to,
    cc,
    subject,
    text,
    attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
  });

  await db.query(
    `INSERT INTO FTS11OEML (LayoutEntry, ObjType, DocEntry, DocRef, MailTo, MailCc, Subject, FileName, Status, ErrorDesc, SentBy)
     VALUES (@layoutEntry, @objType, @docEntry, @docRef, @mailTo, @mailCc, @subject, @fileName, @status, @errorDesc, @sentBy)`,
    [
      { name: 'layoutEntry', value: layoutEntry },
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
      { name: 'docRef', value: docRef },
      { name: 'mailTo', value: to },
      { name: 'mailCc', value: cc },
      { name: 'subject', value: subject },
      { name: 'fileName', value: fileName },
      { name: 'status', value: result.success ? 'SENT' : 'FAILED' },
      { name: 'errorDesc', value: result.success ? null : result.message },
      { name: 'sentBy', value: user.UserName },
    ]
  );

  return {
    sent: result.success,
    message: result.success ? `E-mailed to ${to}${cc ? ` (CC ${cc})` : ''}` : `The mail server refused it: ${result.message}`,
  };
}
