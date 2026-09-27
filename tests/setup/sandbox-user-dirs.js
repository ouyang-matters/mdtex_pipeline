import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * No test touches the real user directories.
 *
 * Runs before every test file. MDTEX_*_HOME win over the platform layout on
 * every platform (src/core/paths.js), so pointing them at a fresh temporary
 * directory sandboxes config, data and cache whether or not a test remembers
 * to — XDG_* alone does nothing on Windows, where it once let the suite write
 * test themes, backups and fake secrets into %LOCALAPPDATA%\MDTeX.
 *
 * A test that needs its own directories sets these variables itself and puts
 * back what it found; deleting them would fall through to the real ones.
 */
const root = mkdtempSync(join(tmpdir(), 'mdtex-test-home-'));
process.env.MDTEX_CONFIG_HOME = join(root, 'config');
process.env.MDTEX_DATA_HOME = join(root, 'data');
process.env.MDTEX_CACHE_HOME = join(root, 'cache');
