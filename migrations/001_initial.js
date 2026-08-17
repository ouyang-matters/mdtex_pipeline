/**
 * Migration 001: Initial schema setup.
 * This is a no-op migration that establishes the baseline.
 */
export const version = 1;
export const description = 'Initial schema setup';

export function up(config) {
  // Ensure all required keys exist
  if (!('config_version' in config)) config.config_version = 1;
  if (!('default_theme' in config)) config.default_theme = 'default';
  if (!('default_platform' in config)) config.default_platform = 'wechat';
  if (!('output_dir' in config)) config.output_dir = './dist';
  return config;
}

export function down(config) {
  return config;
}
