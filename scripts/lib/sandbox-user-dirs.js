import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The browser harnesses run against fresh user directories.
 *
 * Imported for its effect, before the server is loaded. Without it a harness
 * shares config, themes and caches with the person running it: an AI
 * connection they set up changes what the AI panel shows, a warm formula cache
 * changes how many progress stages a compile reports, and the run leaves files
 * behind in their %LOCALAPPDATA%\MDTeX or ~/.local/share. MDTEX_*_HOME win over
 * the platform layout everywhere (src/core/paths.js).
 */
const root = mkdtempSync(join(tmpdir(), 'mdtex-harness-home-'));
process.env.MDTEX_CONFIG_HOME = join(root, 'config');
process.env.MDTEX_DATA_HOME = join(root, 'data');
process.env.MDTEX_CACHE_HOME = join(root, 'cache');

export const sandboxRoot = root;
