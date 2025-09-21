import { App, Notice, Platform, Plugin, TFile, MarkdownView } from 'obsidian';
import { PluginSettings, WorkspaceInternal, AppInternal } from './types';
import { DEFAULT_SETTINGS, validateSettings } from './settings';
import { LinkTitleSuggest } from './ui/LinkTitleSuggest';
import { QuickSwitchModal } from './ui/QuickSwitchModal';
import { SettingTab } from './ui/SettingTab';

export default class PropertyOverFilenamePlugin extends Plugin {
  settings: PluginSettings;
  suggest?: LinkTitleSuggest;
  originalSwitcherCallback?: () => void;
  private originalQuickSwitcher?: () => void;
  private lastDropTarget?: HTMLElement;

  async onload() {
    await this.loadSettings();
    
    // Wait a bit for metadata cache to be fully populated
    setTimeout(() => {
      console.log('Property Over Filename: setTimeout callback called');
      this.updateLinkSuggester();
      this.updateQuickSwitcher();
    }, 1000);

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

    // Register metadata cache change events to rebuild cache
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.rebuildCache();
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on('resolved', () => {
        // Rebuild cache when metadata cache is fully resolved
        this.rebuildCache();
      })
    );

    // Register drag and drop event handling
    this.registerEvent(
      this.app.workspace.on('editor-drop', (event, editor) => {
        if (this.settings.enableForDragDrop) {
          this.handleDragDrop(event, editor);
        }
      })
    );

    // Also try DOM events as backup
    this.registerDomEvent(document, 'drop', (event) => {
      if (this.settings.enableForDragDrop) {
        this.handleDOMDrop(event);
      }
    });

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

    // Simply override the original Quick Switcher command
    const command = (this.app as unknown as AppInternal).commands.commands['switcher:open'];
    if (command) {
      this.originalSwitcherCallback = command.callback;
      command.callback = () => {
        if (this.settings.enableForQuickSwitcher) {
          console.log('Property Over Filename: Opening custom Quick Switch modal');
          // Close any existing modals first
          const existingModals = document.querySelectorAll('.modal');
          existingModals.forEach(modal => {
            if (modal instanceof HTMLElement && modal.style.display !== 'none') {
              modal.style.display = 'none';
            }
          });
          new QuickSwitchModal(this.app, this).open();
        } else {
          console.log('Property Over Filename: Using original Quick Switcher');
          this.originalSwitcherCallback?.();
        }
      };
    }

    this.addCommand({
      id: 'toggle-linking',
      name: 'Toggle property-based linking',
      callback: async () => {
        this.settings.enableForLinking = !this.settings.enableForLinking;
        await this.saveData(this.settings);
        this.updateLinkSuggester();
        new Notice(`Property-based linking ${this.settings.enableForLinking ? 'enabled' : 'disabled'}`);
      }
    });

    this.addCommand({
      id: 'toggle-quick-switcher',
      name: 'Toggle property-based Quick Switcher',
      callback: async () => {
        const prevState = this.settings.enableForQuickSwitcher;
        this.settings.enableForQuickSwitcher = !this.settings.enableForQuickSwitcher;
        await this.saveSettings(prevState);
        new Notice(`Property-based Quick Switcher ${this.settings.enableForQuickSwitcher ? 'enabled' : 'disabled'}`);
      }
    });

    this.addCommand({
      id: 'rebuild-cache',
      name: 'Rebuild file cache',
      callback: () => {
        this.rebuildCache();
        new Notice('File cache rebuilt');
      }
    });

    this.addCommand({
      id: 'toggle-drag-drop',
      name: 'Toggle property-based drag and drop',
      callback: async () => {
        this.settings.enableForDragDrop = !this.settings.enableForDragDrop;
        await this.saveData(this.settings);
        new Notice(`Property-based drag and drop ${this.settings.enableForDragDrop ? 'enabled' : 'disabled'}`);
      }
    });

    // Add setting tab after setTimeout to avoid triggering onChange during startup
    setTimeout(() => {
      this.addSettingTab(new SettingTab(this.app, this));
    }, 1500);
  }

  private invalidateCache(file: TFile): void {
    if (this.suggest) {
      (this.suggest as any).updateFileCache(file);
    }
  }

  private rebuildCache(): void {
    if (this.suggest) {
      (this.suggest as any).buildFileCache();
    }
  }

  private handleDragDrop(event: DragEvent, editor: any): void {
    // Check if the drag event contains file data
    if (!event.dataTransfer || !event.dataTransfer.files.length) {
      return;
    }

    // Get the file path from the drag event
    const filePath = event.dataTransfer.getData('text/plain');
    
    if (!filePath || !filePath.endsWith('.md')) {
      return;
    }

    // Find the file in the vault
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      return;
    }

    // Get the display name from frontmatter
    const fileCache = this.app.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter;
    let displayName = file.basename; // Default to filename
    
    if (frontmatter && frontmatter[this.settings.propertyKey] !== undefined && frontmatter[this.settings.propertyKey] !== null) {
      const propertyValue = String(frontmatter[this.settings.propertyKey]).trim();
      if (propertyValue !== '') {
        displayName = propertyValue; // Use frontmatter title
      }
    }

    // Don't prevent default - let Obsidian insert the default link first
    // Then we'll replace it with our custom display text
    setTimeout(() => {
      this.replaceLastInsertedLink(file, displayName, editor);
    }, 50);
  }

  private handleDOMDrop(event: DragEvent): void {
    // Check if we're dropping on an editor
    const target = event.target as HTMLElement;
    
    if (!target || !target.closest('.cm-editor')) {
      return;
    }

    // Get the file path from the drag event
    const filePath = event.dataTransfer?.getData('text/plain');
    
    if (!filePath) {
      return;
    }

    // Parse Obsidian URL format: obsidian://open?vault=...&file=...
    let actualFilePath = filePath;
    if (filePath.startsWith('obsidian://open?')) {
      const url = new URL(filePath);
      const fileParam = url.searchParams.get('file');
      if (fileParam) {
        actualFilePath = decodeURIComponent(fileParam) + '.md';
      } else {
        return;
      }
    } else if (!filePath.endsWith('.md')) {
      return;
    }

    // Find the file in the vault
    const file = this.app.vault.getAbstractFileByPath(actualFilePath);
    
    if (!file || !(file instanceof TFile)) {
      return;
    }

    // Get the display name from frontmatter
    const fileCache = this.app.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter;
    let displayName = file.basename; // Default to filename
    
    if (frontmatter && frontmatter[this.settings.propertyKey] !== undefined && frontmatter[this.settings.propertyKey] !== null) {
      const propertyValue = String(frontmatter[this.settings.propertyKey]).trim();
      if (propertyValue !== '') {
        displayName = propertyValue; // Use frontmatter title
      }
    }

    // Don't prevent default - let Obsidian insert the default link first
    // Then we'll replace it with our custom display text
    setTimeout(() => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView && activeView.editor) {
        this.replaceLastInsertedLink(file, displayName, activeView.editor);
      }
    }, 50);
  }

  private replaceLastInsertedLink(file: TFile, displayName: string, editor: any): void {
    const content = editor.getValue();
    const cursor = editor.getCursor();
    
    // Look for the most recently inserted link near the cursor
    const lines = content.split('\n');
    const currentLine = lines[cursor.line];
    
    // Find wiki links or markdown links on the current line
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    
    let match;
    let lastMatch = null;
    
    // Find the last wiki link on the current line
    while ((match = wikiLinkRegex.exec(currentLine)) !== null) {
      lastMatch = match;
    }
    
    if (lastMatch) {
      const linkPath = lastMatch[1];
      const newLinkText = `[[${linkPath}|${displayName}]]`;
      const startPos = { line: cursor.line, ch: lastMatch.index };
      const endPos = { line: cursor.line, ch: lastMatch.index + lastMatch[0].length };
      editor.replaceRange(newLinkText, startPos, endPos);
      return;
    }
    
    // Reset regex for markdown links
    markdownLinkRegex.lastIndex = 0;
    
    // Find the last markdown link on the current line
    while ((match = markdownLinkRegex.exec(currentLine)) !== null) {
      lastMatch = match;
    }
    
    if (lastMatch) {
      const linkText = lastMatch[1];
      const linkUrl = lastMatch[2];
      const newLinkText = `[${displayName}](${linkUrl})`;
      const startPos = { line: cursor.line, ch: lastMatch.index };
      const endPos = { line: cursor.line, ch: lastMatch.index + lastMatch[0].length };
      editor.replaceRange(newLinkText, startPos, endPos);
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
    // This method is called but we handle the override in onload
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

    // Restore original quick switcher method
    if (this.originalQuickSwitcher) {
      const workspace = this.app.workspace as any;
      workspace.openQuickSwitcher = this.originalQuickSwitcher;
    }
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
