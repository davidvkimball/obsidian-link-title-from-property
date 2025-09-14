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

    // Register DOM event listeners for drag and drop
    this.registerDomEvent(document, 'drop', (event) => {
      if (this.settings.enableForDragDrop) {
        this.handleDOMDragDrop(event);
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

    // Get the display name from our cache or build it
    let displayName = file.basename;
    
    if (this.suggest) {
      const cachedData = (this.suggest as any).fileCache.get(file.path);
      if (cachedData) {
        displayName = cachedData.displayName;
      } else {
        // Fallback: get display name directly from metadata
        const fileCache = this.app.metadataCache.getFileCache(file);
        const frontmatter = fileCache?.frontmatter;
        if (frontmatter && frontmatter[this.settings.propertyKey] !== undefined && frontmatter[this.settings.propertyKey] !== null) {
          const propertyValue = String(frontmatter[this.settings.propertyKey]).trim();
          if (propertyValue !== '') {
            displayName = propertyValue;
          }
        }
      }
    }

    // Prevent default behavior
    event.preventDefault();
    event.stopPropagation();

    // Get cursor position
    const cursor = editor.getCursor();
    
    // Create the link text
    const useMarkdownLinks = (this.app.vault as any).getConfig('useMarkdownLinks') ?? false;
    let linkText: string;
    
    if (useMarkdownLinks) {
      linkText = `[${displayName}](${encodeURI(file.path)})`;
    } else {
      linkText = `[[${file.basename}|${displayName}]]`;
    }

    // Insert the link at cursor position
    editor.replaceRange(linkText, cursor, cursor);
    
    // Move cursor to end of inserted text
    const newCursorPos = { line: cursor.line, ch: cursor.ch + linkText.length };
    editor.setCursor(newCursorPos);
  }

  private handleDOMDragDrop(event: DragEvent): void {
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

    // Only handle if we can process this file
    if (!filePath.startsWith('obsidian://open?') && !filePath.endsWith('.md')) {
      return;
    }

    // Don't prevent default - let Obsidian insert the link first, then we'll replace it

    // Parse Obsidian URI format: obsidian://open?vault=VAULT_NAME&file=FILE_PATH
    let actualFilePath: string;
    if (filePath.startsWith('obsidian://open?')) {
      const url = new URL(filePath);
      const fileParam = url.searchParams.get('file');
      if (fileParam) {
        actualFilePath = decodeURIComponent(fileParam) + '.md';
      } else {
        return;
      }
    } else if (filePath.endsWith('.md')) {
      actualFilePath = filePath;
    } else {
      return;
    }

    // Find the file in the vault
    const file = this.app.vault.getAbstractFileByPath(actualFilePath);
    if (!file || !(file instanceof TFile)) {
      return;
    }

    // Get the display name from our cache or build it
    let displayName = file.basename;
    
    if (this.suggest) {
      const cachedData = (this.suggest as any).fileCache.get(file.path);
      if (cachedData) {
        displayName = cachedData.displayName;
      } else {
        // Fallback: get display name directly from metadata
        const fileCache = this.app.metadataCache.getFileCache(file);
        const frontmatter = fileCache?.frontmatter;
        if (frontmatter && frontmatter[this.settings.propertyKey] !== undefined && frontmatter[this.settings.propertyKey] !== null) {
          const propertyValue = String(frontmatter[this.settings.propertyKey]).trim();
          if (propertyValue !== '') {
            displayName = propertyValue;
          }
        }
      }
    }

    // Use setTimeout to allow Obsidian to insert the default link first, then replace it
    setTimeout(() => {
      this.replaceLastInsertedLink(file, displayName);
    }, 100);
  }

  private replaceLastInsertedLink(file: TFile, displayName: string): void {
    // Try to find the active editor
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.editor) {
      return;
    }

    const editor = activeView.editor;
    const content = editor.getValue();
    
    // Create the new link text
    const useMarkdownLinks = (this.app.vault as any).getConfig('useMarkdownLinks') ?? false;
    let newLinkText: string;
    
    if (useMarkdownLinks) {
      newLinkText = `[${displayName}](${encodeURI(file.path)})`;
    } else {
      newLinkText = `[[${file.basename}|${displayName}]]`;
    }
    
    // Look for the default link that was just inserted
    // Obsidian inserts links with just the filename, not the full path
    const defaultLinkPattern = useMarkdownLinks 
      ? new RegExp(`\\[${file.basename}\\]\\(${file.basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md\\)`)
      : new RegExp(`\\[\\[${file.basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`);
    
    const match = content.match(defaultLinkPattern);
    if (match) {
      // Find the position of the default link
      const linkIndex = content.indexOf(match[0]);
      if (linkIndex !== -1) {
        // Convert character index to line/column position more accurately
        const beforeLink = content.substring(0, linkIndex);
        const lines = beforeLink.split('\n');
        const startPos = { line: lines.length - 1, ch: lines[lines.length - 1].length };
        const endPos = { line: lines.length - 1, ch: lines[lines.length - 1].length + match[0].length };
        
        // Replace the default link with our custom link
        editor.replaceRange(newLinkText, startPos, endPos);
        
        // Move cursor to end of new link (but don't set cursor if it would be invalid)
        const newCursorPos = { line: startPos.line, ch: startPos.ch + newLinkText.length };
        try {
          editor.setCursor(newCursorPos);
        } catch (error) {
          // Cursor position invalid, but link was replaced successfully
        }
      }
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
