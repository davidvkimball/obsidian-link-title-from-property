import { TFile, App } from 'obsidian';

export interface PluginSettings {
  propertyKey: string;
  enableForLinking: boolean;
  enableForQuickSwitcher: boolean;
  includeFilenameInSearch: boolean;
  includeAliasesInSearch: boolean;
  enableForDragDrop: boolean;
}

export interface CachedFileData {
  file: TFile;
  displayName: string;
  aliases: string[];
  lastModified: number;
  isCustomDisplay: boolean;
}

export interface SearchMatchReason {
  matchedInTitle: boolean;
  matchedInFilename: boolean;
  matchedInAlias: boolean;
}

export interface SuggestionItem {
  file?: TFile;
  display: string;
  isCustomDisplay: boolean;
  isNoMatch?: boolean;
}

export interface QuickSwitchItem {
  item: TFile | { isNewNote: boolean; newName: string };
  match: { score: number; matches: number[][] };
}

// Internal API interfaces for better type safety
export interface EditorSuggestInternal {
  suggestEl?: HTMLElement;
}

export interface VaultInternal {
  getConfig(key: string): boolean;
}

export interface WorkspaceInternal {
  editorSuggest?: {
    suggests: EditorSuggest[];
  };
}

export interface AppInternal {
  commands: {
    commands: Record<string, {
      id?: string;
      name?: string;
      icon?: string;
      hotkeys?: Array<{ modifiers: string[]; key: string }>;
      callback: () => void;
    }>;
  };
}

// Forward declarations to avoid circular imports
export type PropertyOverFileNamePlugin = any; // Will be the actual plugin class

export interface EditorSuggest {
  updateFileCache(file: TFile): void;
  buildFileCache(): void;
}
