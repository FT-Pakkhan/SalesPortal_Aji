import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { getSmtpConfig } from '@/lib/generalSettings';
import { sendMail } from '@/lib/mail';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/general-settings/test-email - Send a test e-mail with the SMTP settings sent (as typed on the screen,
// not yet saved; an empty password means the saved one) to { to }.
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const body = (await request.json()) as Record<string, unknown>;
    const to = String(body.to ?? '').trim();
    if (!EMAIL_PATTERN.test(to)) throw new ValidationError('Enter a valid e-mail address to send the test to');
    const config = await getSmtpConfig(body);
    const result = await sendMail(config, {
      to,
      subject: 'AJI Sales Portal - test e-mail',
      text:
        `This is a test e-mail from the AJI Sales Portal, sent by ${user.userName} from General Settings.\n\n` +
        `If you can read this, the SMTP settings work:\n` +
        `  Server: ${config.host}:${config.port} (${config.security})\n` +
        `  From: ${config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail}\n`,
    });
    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
