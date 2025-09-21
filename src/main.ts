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
        console.log('Property Over Filename: editor-drop event triggered');
        console.log('enableForDragDrop setting:', this.settings.enableForDragDrop);
        if (this.settings.enableForDragDrop) {
          this.handleDragDrop(event, editor);
        }
      })
    );

    // Also try DOM events as backup
    this.registerDomEvent(document, 'drop', (event) => {
      console.log('Property Over Filename: DOM drop event triggered');
      console.log('enableForDragDrop setting:', this.settings.enableForDragDrop);
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
        await this.saveSettings();
        new Notice(`Property-based drag and drop ${this.settings.enableForDragDrop ? 'enabled' : 'disabled'}`);
      }
    });

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
    console.log('Property Over Filename: handleDragDrop called');
    console.log('Property Over Filename: event.dataTransfer:', event.dataTransfer);
    console.log('Property Over Filename: files.length:', event.dataTransfer?.files.length);
    
    // Check if the drag event contains file data
    if (!event.dataTransfer || !event.dataTransfer.files.length) {
      console.log('Property Over Filename: No dataTransfer or files');
      return;
    }

    // Get the file path from the drag event
    const filePath = event.dataTransfer.getData('text/plain');
    console.log('Property Over Filename: filePath from drag:', filePath);
    
    if (!filePath || !filePath.endsWith('.md')) {
      console.log('Property Over Filename: Invalid file path or not .md file');
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
    console.log('Property Over Filename: handleDOMDrop called');
    
    // Check if we're dropping on an editor
    const target = event.target as HTMLElement;
    console.log('Property Over Filename: target:', target);
    console.log('Property Over Filename: closest .cm-editor:', target?.closest('.cm-editor'));
    
    if (!target || !target.closest('.cm-editor')) {
      console.log('Property Over Filename: Not dropping on editor');
      return;
    }

    // Get the file path from the drag event
    const filePath = event.dataTransfer?.getData('text/plain');
    console.log('Property Over Filename: filePath from DOM drag:', filePath);
    
    if (!filePath) {
      console.log('Property Over Filename: No file path in DOM drop');
      return;
    }

    // Parse Obsidian URL format: obsidian://open?vault=...&file=...
    let actualFilePath = filePath;
    if (filePath.startsWith('obsidian://open?')) {
      const url = new URL(filePath);
      const fileParam = url.searchParams.get('file');
      if (fileParam) {
        actualFilePath = decodeURIComponent(fileParam) + '.md';
        console.log('Property Over Filename: Parsed file path:', actualFilePath);
      } else {
        console.log('Property Over Filename: No file parameter in Obsidian URL');
        return;
      }
    } else if (!filePath.endsWith('.md')) {
      console.log('Property Over Filename: Invalid file path or not .md file in DOM drop');
      return;
    }

    // Find the file in the vault
    const file = this.app.vault.getAbstractFileByPath(actualFilePath);
    console.log('Property Over Filename: found file:', file?.name);
    
    if (!file || !(file instanceof TFile)) {
      console.log('Property Over Filename: File not found or not TFile');
      return;
    }

    // Get the display name from frontmatter
    const fileCache = this.app.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter;
    let displayName = file.basename; // Default to filename
    
    console.log('Property Over Filename: frontmatter:', frontmatter);
    console.log('Property Over Filename: propertyKey:', this.settings.propertyKey);
    
    if (frontmatter && frontmatter[this.settings.propertyKey] !== undefined && frontmatter[this.settings.propertyKey] !== null) {
      const propertyValue = String(frontmatter[this.settings.propertyKey]).trim();
      console.log('Property Over Filename: propertyValue:', propertyValue);
      if (propertyValue !== '') {
        displayName = propertyValue; // Use frontmatter title
      }
    }

    console.log('Property Over Filename: final displayName:', displayName);

    // Don't prevent default - let Obsidian insert the default link first
    // Then we'll replace it with our custom display text
    setTimeout(() => {
      console.log('Property Over Filename: Calling replaceLastInsertedLink from DOM drop');
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView && activeView.editor) {
        this.replaceLastInsertedLink(file, displayName, activeView.editor);
      }
    }, 50);
  }

  private replaceLastInsertedLink(file: TFile, displayName: string, editor: any): void {
    const content = editor.getValue();
    const cursor = editor.getCursor();
    
    console.log('Property Over Filename: Looking for link to replace');
    console.log('Current line:', content.split('\n')[cursor.line]);
    console.log('File path:', file.path);
    console.log('Display name:', displayName);
    
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
      console.log('Found wiki link:', match[0], 'at index:', match.index);
      lastMatch = match;
    }
    
    if (lastMatch) {
      const linkPath = lastMatch[1];
      const newLinkText = `[[${linkPath}|${displayName}]]`;
      console.log('Replacing wiki link with:', newLinkText);
      const startPos = { line: cursor.line, ch: lastMatch.index };
      const endPos = { line: cursor.line, ch: lastMatch.index + lastMatch[0].length };
      editor.replaceRange(newLinkText, startPos, endPos);
      return;
    }
    
    // Reset regex for markdown links
    markdownLinkRegex.lastIndex = 0;
    
    // Find the last markdown link on the current line
    while ((match = markdownLinkRegex.exec(currentLine)) !== null) {
      console.log('Found markdown link:', match[0], 'at index:', match.index);
      lastMatch = match;
    }
    
    if (lastMatch) {
      const linkText = lastMatch[1];
      const linkUrl = lastMatch[2];
      const newLinkText = `[${displayName}](${linkUrl})`;
      console.log('Replacing markdown link with:', newLinkText);
      const startPos = { line: cursor.line, ch: lastMatch.index };
      const endPos = { line: cursor.line, ch: lastMatch.index + lastMatch[0].length };
      editor.replaceRange(newLinkText, startPos, endPos);
    } else {
      console.log('No link found to replace');
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
    this.updateLinkSuggester();
    this.updateQuickSwitcher();
  }
}
