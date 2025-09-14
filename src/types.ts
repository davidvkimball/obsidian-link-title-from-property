import { TFile } from 'obsidian';

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

export interface SuggestionItem {
  file?: TFile;
  display: string;
  isCustomDisplay: boolean;
  isNewNote?: boolean;
}

export interface QuickSwitchItem {
  item: TFile | { isNewNote: boolean; newName: string };
  match: any; // SearchResult from obsidian
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
    suggests: any[];
  };
}

export interface AppInternal {
  commands: {
    commands: Record<string, { callback: () => void }>;
  };
}
