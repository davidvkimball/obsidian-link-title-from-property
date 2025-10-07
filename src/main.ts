import { Platform, Plugin, TFile } from 'obsidian';
import { PluginSettings, WorkspaceInternal } from './types';
import { DEFAULT_SETTINGS } from './settings';
import { LinkTitleSuggest } from './ui/LinkTitleSuggest';
import { QuickSwitchModal } from './ui/QuickSwitchModal';
import { SettingTab } from './ui/SettingTab';
import { registerCommands } from './commands';
import { QuickSwitcherService } from './services/QuickSwitcherService';
import { DragDropService } from './services/DragDropService';
import { CacheService } from './services/CacheService';

export default class PropertyOverFileNamePlugin extends Plugin {
  settings!: PluginSettings;
  suggest?: LinkTitleSuggest;
  private quickSwitcherService!: QuickSwitcherService;
  private dragDropService!: DragDropService;
  private cacheService!: CacheService;

  async onload() {
    await this.loadSettings();
    
    // Initialize services
    this.quickSwitcherService = new QuickSwitcherService(this);
    this.dragDropService = new DragDropService(this);
    this.cacheService = new CacheService(this);
    
    // Wait a bit for metadata cache to be fully populated
    setTimeout(() => {
      this.updateLinkSuggester();
      this.updateQuickSwitcher();
    }, 1000);

    // Register file change events to invalidate cache
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.cacheService.invalidateCache(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.cacheService.invalidateCache(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.cacheService.invalidateCache(file);
        }
      })
    );

    // Register metadata cache change events to rebuild cache
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.cacheService.rebuildCache();
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on('resolved', () => {
        // Rebuild cache when metadata cache is fully resolved
        this.cacheService.rebuildCache();
      })
    );

    // Register drag and drop event handling
    this.registerEvent(
      this.app.workspace.on('editor-drop', (event, editor) => {
        if (this.settings.enableForDragDrop) {
          this.dragDropService.handleDragDrop(event, editor);
        }
      })
    );

    // Also try DOM events as backup
    this.registerDomEvent(document, 'drop', (event) => {
      if (this.settings.enableForDragDrop) {
        this.dragDropService.handleDOMDrop(event);
      }
    });

    // Note: Mobile quick switcher is handled by the QuickSwitcherService
    // which overrides the 'switcher:open' command. The quick-preview event
    // was causing conflicts with normal typing, so we removed that approach.

    // Register commands
    registerCommands(this);

    // Add setting tab
    this.addSettingTab(new SettingTab(this.app, this));
  }

  updateLinkSuggester() {
    const editorSuggest = (this.app.workspace as WorkspaceInternal).editorSuggest;
    if (!editorSuggest) return;

    if (this.suggest) {
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => s !== this.suggest);
      this.suggest = undefined;
    }

    if (this.settings.enableForLinking) {
      this.suggest = new LinkTitleSuggest(this);
      this.registerEditorSuggest(this.suggest);
      this.cacheService.setSuggest(this.suggest);
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => !s.constructor.name.includes('LinkSuggest'));
      editorSuggest.suggests.unshift(this.suggest);
    }
  }

  updateQuickSwitcher() {
    this.quickSwitcherService.updateQuickSwitcher();
  }

  rebuildCache() {
    this.cacheService.rebuildCache();
  }

  onunload() {
    // Clean up editor suggester
    const editorSuggest = (this.app.workspace as WorkspaceInternal).editorSuggest;
    if (editorSuggest && this.suggest) {
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => s !== this.suggest);
    }

    // Restore the original Quick Switcher command
    this.quickSwitcherService.restoreOriginalCommand();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(prevQuickSwitcherState?: boolean) {
    await this.saveData(this.settings);
    // Only update components when relevant settings change
    if (prevQuickSwitcherState !== undefined && prevQuickSwitcherState !== this.settings.enableForQuickSwitcher) {
      this.updateQuickSwitcher();
    }
  }
}
