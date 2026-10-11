import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const stateDir = process.env.APEX_STATE_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Apex-TV-personal');
