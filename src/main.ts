import { App, Notice, Platform, Plugin, TFile } from 'obsidian';
import { PluginSettings, WorkspaceInternal, AppInternal } from './types';
import { DEFAULT_SETTINGS, validateSettings } from './settings';
import { LinkTitleSuggest } from './ui/LinkTitleSuggest';
import { QuickSwitchModal } from './ui/QuickSwitchModal';
import { SettingTab } from './ui/SettingTab';

export default class PropertyOverFilenamePlugin extends Plugin {
  settings: PluginSettings;
  suggest?: LinkTitleSuggest;
  originalSwitcherCallback?: () => void;

  async onload() {
    await this.loadSettings();
    this.updateLinkSuggester();
    this.updateQuickSwitcher();

    // Register file change events to invalidate cache
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.invalidateCache(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.invalidateCache(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.invalidateCache(file);
        }
      })
    );

    // Mobile Quick Switcher override
    if (Platform.isMobile) {
      this.registerEvent(
        this.app.workspace.on('quick-preview', (file: TFile, content: string) => {
          if (this.settings.enableForQuickSwitcher) {
            // Prevent default Quick Switcher and open custom modal
            new QuickSwitchModal(this.app, this).open();
            return false; // Cancel default behavior
          }
        })
      );
    }

    // Add commands for better discoverability
    this.addCommand({
      id: 'open-quick-switcher',
      name: 'Open Quick Switcher (Property-based)',
      callback: () => {
        new QuickSwitchModal(this.app, this).open();
      }
    });

    this.addCommand({
      id: 'toggle-linking',
      name: 'Toggle property-based linking',
      callback: async () => {
        this.settings.enableForLinking = !this.settings.enableForLinking;
        await this.saveSettings();
        new Notice(`Property-based linking ${this.settings.enableForLinking ? 'enabled' : 'disabled'}`);
      }
    });

    this.addCommand({
      id: 'toggle-quick-switcher',
      name: 'Toggle property-based Quick Switcher',
      callback: async () => {
        this.settings.enableForQuickSwitcher = !this.settings.enableForQuickSwitcher;
        await this.saveSettings();
        new Notice(`Property-based Quick Switcher ${this.settings.enableForQuickSwitcher ? 'enabled' : 'disabled'}`);
      }
    });

    this.addSettingTab(new SettingTab(this.app, this));
  }

  private invalidateCache(file: TFile): void {
    if (this.suggest) {
      (this.suggest as any).updateFileCache(file);
    }
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
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => !s.constructor.name.includes('LinkSuggest'));
      editorSuggest.suggests.unshift(this.suggest);
    }
  }

  updateQuickSwitcher() {
    const command = (this.app as unknown as AppInternal).commands.commands['switcher:open'];
    if (!command) {
      console.error('Failed to find switcher:open command');
      new Notice('Failed to override Quick Switcher. Please ensure the core Quick Switcher is enabled.');
      return;
    }

    if (this.originalSwitcherCallback) {
      command.callback = this.originalSwitcherCallback;
      this.originalSwitcherCallback = undefined;
    }

    if (this.settings.enableForQuickSwitcher) {
      this.originalSwitcherCallback = command.callback;
      command.callback = () => {
        new QuickSwitchModal(this.app, this).open();
      };
    }
  }

  onunload() {
    const editorSuggest = (this.app.workspace as WorkspaceInternal).editorSuggest;
    if (editorSuggest && this.suggest) {
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => s !== this.suggest);
    }

    const command = (this.app as unknown as AppInternal).commands.commands['switcher:open'];
    if (command && this.originalSwitcherCallback) {
      command.callback = this.originalSwitcherCallback;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(prevQuickSwitcherState?: boolean) {
    await this.saveData(this.settings);
    this.updateLinkSuggester();
    this.updateQuickSwitcher();
  }
}
