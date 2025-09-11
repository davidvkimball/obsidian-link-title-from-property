import { PluginSettings } from './types';

export const DEFAULT_SETTINGS: PluginSettings = {
  propertyKey: 'title',
  enableForLinking: true,
  enableForQuickSwitcher: true,
  includeFilenameInSearch: true,
  includeAliasesInSearch: true,
};

export function validateSettings(settings: PluginSettings): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!settings.propertyKey || settings.propertyKey.trim() === '') {
    errors.push('Property key cannot be empty');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
