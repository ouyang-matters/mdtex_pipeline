/**
 * Compatibility surface for the pre-backend AI module.
 *
 * The implementation now lives in ./backends/*, ./registry.js, ./tools.js and
 * ./session.js. This file re-exports the pieces older code and documentation
 * referred to, so nothing breaks on upgrade.
 */

export { AiBackend, AiBackend as AIBackend, BACKEND_TYPES, BACKEND_LABELS } from './backends/base.js';
export { LocalClaudeCodeBackend, findClaudeCli } from './backends/local-claude.js';
export { RemoteClaudeClawBackend } from './backends/remote-claudeclaw.js';
export { AnthropicApiBackend } from './backends/anthropic.js';
export { getActiveBackend, backendFor, listProfiles, saveProfile, deleteProfile, setActiveProfile } from './registry.js';

import { getActiveBackend, backendFor, listProfiles } from './registry.js';

/**
 * Get the configured AI backend.
 * Previously took a config object; now reads the saved profile registry.
 */
export function getAIBackend(config = {}) {
  if (config?.profileId) {
    const profile = listProfiles().find(p => p.id === config.profileId);
    if (profile) return backendFor(profile);
  }
  return getActiveBackend();
}
