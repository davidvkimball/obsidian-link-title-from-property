import { App, Notice, Platform, Plugin, TFile, MarkdownView } from 'obsidian';
import { PluginSettings, WorkspaceInternal, AppInternal } from './types';
import { DEFAULT_SETTINGS, validateSettings } from './settings';
import { LinkTitleSuggest } from './ui/LinkTitleSuggest';
import { QuickSwitchModal } from './ui/QuickSwitchModal';
import { SettingTab } from './ui/SettingTab';

export default class PropertyOverFilenamePlugin extends Plugin {
  settings: PluginSettings;
  suggest?: LinkTitleSuggest;
  private originalSwitcherCommand?: any;
  private isCommandOverridden: boolean = false;
  private lastDropTarget?: HTMLElement;

  async onload() {
    await this.loadSettings();
    
    
    // Wait a bit for metadata cache to be fully populated
    setTimeout(() => {
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

    // Don't override the Quick Switcher command here - let updateQuickSwitcher handle it

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

    // Add setting tab immediately
    this.addSettingTab(new SettingTab(this.app, this));
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
    // Always override the command - our callback will handle the setting
    if (!this.isCommandOverridden) {
      this.overrideQuickSwitcherCommand();
    }
  }


  private overrideQuickSwitcherCommand() {
    // Get the command registry
    const commands = (this.app as unknown as AppInternal).commands.commands;

    // Store the original command BEFORE we delete it
    if (commands['switcher:open'] && !this.originalSwitcherCommand) {
      const originalCmd = commands['switcher:open'] as any;
      this.originalSwitcherCommand = {
        id: originalCmd.id,
        name: originalCmd.name,
        icon: originalCmd.icon,
        hotkeys: originalCmd.hotkeys ? [...originalCmd.hotkeys] : [],
        callback: originalCmd.callback
      };
    }

    // Remove the original command completely to avoid conflicts
    if (commands['switcher:open']) {
      delete commands['switcher:open'];
    }

    // Add our own command with the same ID
    this.addCommand({
      id: 'switcher:open',
      name: 'Quick Switcher',
      hotkeys: [{ modifiers: ["Mod"], key: "o" }],
      callback: () => {
        if (this.settings.enableForQuickSwitcher) {
          // Use our custom modal when enabled
          // Close any existing modals first
          const existingModals = document.querySelectorAll('.modal');
          existingModals.forEach(modal => {
            if (modal instanceof HTMLElement && modal.style.display !== 'none') {
              modal.style.display = 'none';
            }
          });
          new QuickSwitchModal(this.app, this).open();
        } else {
          // Use the original Obsidian Quick Switcher when disabled
          if (this.originalSwitcherCommand && this.originalSwitcherCommand.callback) {
            this.originalSwitcherCommand.callback();
          } else {
            // Fallback: try to open the default switcher
            (this.app as any).commands.executeCommandById('switcher:open');
          }
        }
      }
    });

    this.isCommandOverridden = true;
  }

  private restoreOriginalCommand() {
    if (!this.originalSwitcherCommand) {
      return;
    }

    // Remove our command
    const commands = (this.app as unknown as AppInternal).commands.commands;
    if (commands['switcher:open']) {
      delete commands['switcher:open'];
    }

    // Restore the original command
    (commands as any)['switcher:open'] = {
      id: this.originalSwitcherCommand.id,
      name: this.originalSwitcherCommand.name,
      icon: this.originalSwitcherCommand.icon,
      hotkeys: this.originalSwitcherCommand.hotkeys,
      callback: this.originalSwitcherCommand.callback
    };

    this.isCommandOverridden = false;
  }

  private openDefaultQuickSwitcher() {
    console.log('=== OPENING DEFAULT QUICK SWITCHER ===');
    
    try {
      // Method 1: Try to access the internal Quick Switcher plugin directly
      const internalPlugins = (this.app as any).internalPlugins;
      const quickSwitcherPlugin = internalPlugins?.plugins?.['switcher'];
      
      if (quickSwitcherPlugin?.instance) {
        console.log('Found quick-switcher plugin instance');
        const instance = quickSwitcherPlugin.instance;
        
        // Try to find and use the QuickSwitcherModal class
        if (instance.QuickSwitcherModal) {
          console.log('Creating QuickSwitcherModal instance');
          const QuickSwitcherModal = instance.QuickSwitcherModal;
          
          // Try different constructor signatures
          const signatures = [
            () => new QuickSwitcherModal(this.app, false),
            () => new QuickSwitcherModal(this.app, true),
            () => new QuickSwitcherModal(this.app, false, false),
            () => new QuickSwitcherModal(this.app, true, false),
            () => new QuickSwitcherModal(this.app),
          ];
          
          for (let i = 0; i < signatures.length; i++) {
            try {
              console.log(`Trying constructor signature ${i + 1}`);
              const modal = signatures[i]();
              modal.open();
              console.log(`QuickSwitcherModal opened successfully with signature ${i + 1}`);
              return;
            } catch (error) {
              console.log(`Constructor signature ${i + 1} failed:`, error.message);
            }
          }
        }
        
        // Try other methods on the instance
        if (typeof instance.openQuickSwitcher === 'function') {
          console.log('Trying instance.openQuickSwitcher');
          instance.openQuickSwitcher();
          return;
        }
        
        if (typeof instance.open === 'function') {
          console.log('Trying instance.open');
          instance.open();
          return;
        }
      }

      // Method 2: Use workspace method if available
      const workspace = this.app.workspace as any;
      if (typeof workspace.openQuickSwitcher === 'function') {
        console.log('Using workspace.openQuickSwitcher');
        workspace.openQuickSwitcher();
        return;
      }

      // Method 3: Try to find the QuickSwitcherModal class in the global scope
      console.log('Trying to find QuickSwitcherModal in global scope');
      const globalScope = (window as any);
      if (globalScope.QuickSwitcherModal) {
        try {
          const modal = new globalScope.QuickSwitcherModal(this.app, false);
          modal.open();
          console.log('Global QuickSwitcherModal opened successfully');
          return;
        } catch (error) {
          console.log('Global QuickSwitcherModal failed:', error.message);
        }
      }

      // Method 4: Fallback to command palette
      console.log('Falling back to command palette');
      (this.app as any).commands.executeCommandById('app:open-quick-switcher');
      
    } catch (error) {
      console.error('Error opening default Quick Switcher:', error);
      new Notice('Error opening Quick Switcher. Please check console for details.');
    }
  }

  onunload() {
    // Clean up editor suggester
    const editorSuggest = (this.app.workspace as WorkspaceInternal).editorSuggest;
    if (editorSuggest && this.suggest) {
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => s !== this.suggest);
    }

    // Restore the original Quick Switcher command
    if (this.isCommandOverridden) {
      this.restoreOriginalCommand();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(prevQuickSwitcherState?: boolean) {
    await this.saveData(this.settings);
    // Only update components when relevant settings change
    if (prevQuickSwitcherState !== undefined && prevQuickSwitcherState !== this.settings.enableForQuickSwitcher) {
      console.log('Quick Switcher setting changed, updating command');
      this.updateQuickSwitcher();
    }
  }
}
