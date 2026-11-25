import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  getGeneralSettings,
  parseSettingsFields,
  assertServerTypeExists,
  assertFolderUsable,
  assertIncomingPaymentSettings,
  assertPriceListExists,
  saveGeneralSettings,
} from '@/lib/generalSettings';

// GET /api/general-settings - The settings (null if never saved). Passwords are never returned.
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    return successResponse(await getGeneralSettings());
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/general-settings - Save the settings (created the first time). Empty passwords keep the saved ones.
export async function PUT(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseSettingsFields(await request.json());
    await assertServerTypeExists(fields.sapDbServerType);
    await assertFolderUsable(fields.attachPath);
    await assertIncomingPaymentSettings(fields);
    await assertPriceListExists(fields.defaultPriceList);
    await saveGeneralSettings(fields, user.userName);
    return successResponse(await getGeneralSettings(), 'General settings saved');
  } catch (error) {
    return errorResponse(error);
  }
}
