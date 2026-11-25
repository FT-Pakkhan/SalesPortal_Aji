// Upload rules for attachments, shared by the screen (checked when a file is chosen)
// and the server (checked again before the file is saved).

/** Max. Attachment Size used until General Settings is saved */
export const DEFAULT_ATTACH_MAX_MB = 20;

/** Shown when files are attached before the Attachment Folder is set in General Settings */
export const ATTACH_FOLDER_NOT_SET =
  'No attachment folder has been defined, so files can\'t be saved. Please ask your administrator to set the Attachment Folder in General Settings.';

/** Program / script files are never accepted */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'scr', 'pif', 'cpl', 'hta', 'jar', 'reg', 'lnk',
]);

/** "Customer PO.pdf" -> { name: 'Customer PO', ext: 'pdf' } */
export function splitFileName(fileName: string): { name: string; ext: string | null } {
  const base = (fileName || '').split(/[\\/]/).pop()?.trim() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? { name: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() } : { name: base, ext: null };
}

/** Why a file can't be attached, or null when it can. `maxMB` is Max. Attachment Size from General Settings. */
export function uploadProblem(fileName: string, size: number, maxMB: number): string | null {
  const { name, ext } = splitFileName(fileName);
  if (!name) return 'File name is missing';
  if (size <= 0) return `${fileName} is empty`;
  if (size > maxMB * 1024 * 1024) return `${fileName} is larger than ${maxMB} MB`;
  if (ext && BLOCKED_EXTENSIONS.has(ext)) return `.${ext} files can't be attached`;
  if (name.length > 254) return 'File name is too long';
  if (ext && (ext.length > 20 || !/^[a-z0-9]+$/.test(ext))) return 'File extension is not valid';
  return null;
}
