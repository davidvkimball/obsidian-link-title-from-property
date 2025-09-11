import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, FuzzySuggestModal, MarkdownView, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, prepareFuzzySearch, SearchResult, FuzzyMatch } from 'obsidian';

// Internal API interfaces for better type safety
interface EditorSuggestInternal extends EditorSuggest<any> {
  suggestEl?: HTMLElement;
}

interface VaultInternal {
  getConfig(key: string): boolean;
}

interface WorkspaceInternal {
  editorSuggest?: {
    suggests: EditorSuggest<any>[];
  };
}

interface AppInternal {
  commands: {
    commands: Record<string, { callback: () => void }>;
  };
}

interface PluginSettings {
  propertyKey: string;
  enableForLinking: boolean;
  enableForQuickSwitcher: boolean;
  includeFilenameInSearch: boolean;
  includeAliasesInSearch: boolean;
}

interface CachedFileData {
  file: TFile;
  displayName: string;
  aliases: string[];
  lastModified: number;
  isCustomDisplay: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  propertyKey: 'title',
  enableForLinking: true,
  enableForQuickSwitcher: true,
  includeFilenameInSearch: true,
  includeAliasesInSearch: true,
};

interface SuggestionItem {
  file?: TFile;
  display: string;
  isCustomDisplay: boolean;
  isNewNote?: boolean;
}

interface QuickSwitchItem {
  item: TFile | { isNewNote: boolean; newName: string };
  match: SearchResult;
}

class LinkTitleSuggest extends EditorSuggest<SuggestionItem> {
  private plugin: PropertyOverFilenamePlugin;
  private fileCache: Map<string, CachedFileData> = new Map();
  private searchTimeout: number | null = null;

  constructor(plugin: PropertyOverFilenamePlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.buildFileCache();
  }

  open(): void {
    super.open();
    const el = (this as EditorSuggestInternal).suggestEl;
    if (el && !el.querySelector('.prompt-instructions')) {
      const instructions = el.createDiv({ cls: 'prompt-instructions' });
      instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type # to link heading');
      instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type ^ to link blocks');
      instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type | to change display text');
    }
    
    // Add keyboard navigation improvements
    this.addKeyboardNavigation();
  }

  private addKeyboardNavigation(): void {
    const el = (this as EditorSuggestInternal).suggestEl;
    if (!el) return;

    // Add escape key handling
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.enableForLinking) return null;
    const line = editor.getLine(cursor.line).substring(0, cursor.ch);
    const match = /\[\[([^#^|\]]*)$/.exec(line);
    if (match) {
      return {
        start: { line: cursor.line, ch: line.lastIndexOf('[[') },
        end: cursor,
        query: match[1],
      };
    }
    return null;
  }

  private buildFileCache(): void {
    this.fileCache.clear();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      this.updateFileCache(file);
    });
  }

  private updateFileCache(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    let displayName = file.basename;
    let isCustomDisplay = false;
    let aliases: string[] = [];

    if (frontmatter && frontmatter[this.plugin.settings.propertyKey] !== undefined && frontmatter[this.plugin.settings.propertyKey] !== null) {
      const propertyValue = String(frontmatter[this.plugin.settings.propertyKey]).trim();
      if (propertyValue !== '') {
        displayName = propertyValue;
        isCustomDisplay = true;
      }
    }

    if (frontmatter?.aliases) {
      aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [frontmatter.aliases];
      aliases = aliases.map(alias => String(alias).trim()).filter(alias => alias !== '');
    }

    this.fileCache.set(file.path, {
      file,
      displayName,
      aliases,
      lastModified: file.stat.mtime,
      isCustomDisplay
    });
  }

  getSuggestions(context: EditorSuggestContext): SuggestionItem[] {
    const query = context.query.trim();
    return this.performSearch(query);
  }

  private performSearch(query: string): SuggestionItem[] {
    const suggestions: SuggestionItem[] = [];
    const existingFiles = new Set<string>();

    // Use cached data for much faster search
    for (const cachedData of this.fileCache.values()) {
      const { file, displayName, aliases, isCustomDisplay } = cachedData;
      
      let matches = !query || this.fuzzyMatch(displayName, query);
      
      if (this.plugin.settings.includeFilenameInSearch) {
        matches = matches || this.fuzzyMatch(file.basename, query);
      }
      
      if (this.plugin.settings.includeAliasesInSearch && aliases.length > 0) {
        matches = matches || aliases.some(alias => this.fuzzyMatch(alias, query));
      }
      
      if (matches) {
        suggestions.push({ file, display: displayName, isCustomDisplay });
        existingFiles.add(file.basename.toLowerCase());
      }
    }

    if (query && !existingFiles.has(query.toLowerCase())) {
      suggestions.unshift({
        display: query,
        isCustomDisplay: false,
        isNewNote: true,
      });
    }

    return this.sortSuggestions(suggestions, query);
  }

  fuzzyMatch(str: string, query: string): boolean {
    let i = 0;
    const lowerStr = str.toLowerCase();
    const lowerQuery = query.toLowerCase();
    for (const char of lowerQuery) {
      i = lowerStr.indexOf(char, i) + 1;
      if (i === 0) return false;
    }
    return true;
  }

  sortSuggestions(suggestions: SuggestionItem[], query: string): SuggestionItem[] {
    return suggestions.sort((a, b) => {
      const aScore = this.getMatchScore(a.display, query, a.file?.basename ?? '');
      const bScore = this.getMatchScore(b.display, query, b.file?.basename ?? '');
      if (a.isNewNote) return -1;
      if (b.isNewNote) return 1;
      return bScore - aScore || a.display.localeCompare(b.display);
    });
  }

  getMatchScore(display: string, query: string, basename: string): number {
    let score = 0;
    const lowerDisplay = display.toLowerCase();
    const lowerBasename = basename.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    // Exact matches get highest score
    if (lowerDisplay === lowerQuery) score += 1000;
    else if (lowerBasename === lowerQuery) score += 900;
    
    // Starts with query gets high score
    else if (lowerDisplay.startsWith(lowerQuery)) score += 100;
    else if (this.plugin.settings.includeFilenameInSearch && lowerBasename.startsWith(lowerQuery)) score += 80;
    
    // Contains query gets medium score
    else if (lowerDisplay.includes(lowerQuery)) score += 50;
    else if (this.plugin.settings.includeFilenameInSearch && lowerBasename.includes(lowerQuery)) score += 30;
    
    // Word boundary matches get bonus
    const wordBoundaryRegex = new RegExp(`\\b${lowerQuery}`, 'i');
    if (wordBoundaryRegex.test(lowerDisplay)) score += 20;
    if (this.plugin.settings.includeFilenameInSearch && wordBoundaryRegex.test(lowerBasename)) score += 15;
    
    // Penalty for very long names
    const lengthPenalty = Math.max(0, (display.length - query.length) * 0.1);
    score -= lengthPenalty;
    
    return Math.max(0, score);
  }

  renderSuggestion(suggestion: SuggestionItem, el: HTMLElement): void {
    el.empty();
    const content = el.createDiv({ cls: 'suggestion-content' });
    content.createDiv({ cls: 'suggestion-title', text: suggestion.display });
    if (suggestion.file) {
      content.createDiv({ cls: 'suggestion-note', text: suggestion.file.path.replace('.md', '') });
    }
  }

  async selectSuggestion(suggestion: SuggestionItem, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !this.context) return;
    const editor = activeView.editor;
    const { start, end } = this.context;
    const line = editor.getLine(start.line);
    let endPos = end;
    if (line.slice(end.ch, end.ch + 2) === ']]') {
      endPos = { line: end.line, ch: end.ch + 2 };
    }
    const useMarkdownLinks = (this.app.vault as unknown as VaultInternal).getConfig('useMarkdownLinks') ?? false;
    let linkText: string;

    if (suggestion.isNewNote) {
      const newFile = await this.app.vault.create(`${suggestion.display}.md`, '');
      linkText = useMarkdownLinks
        ? `[${suggestion.display}](${encodeURI(newFile.path)})`
        : `[[${newFile.basename}]]`;
      if (this.app.workspace.activeLeaf) {
        await this.app.workspace.activeLeaf.openFile(newFile);
      }
    } else {
      if (useMarkdownLinks) {
        linkText = `[${suggestion.display}](${encodeURI(suggestion.file!.path)})`;
      } else {
        const linkPath = suggestion.file!.basename;
        linkText = `[[${linkPath}|${suggestion.display}]]`;
      }
    }
    editor.replaceRange(linkText, { line: start.line, ch: start.ch }, endPos);
    const newCursorPos = start.ch + linkText.length;
    try {
      editor.setCursor({ line: start.line, ch: newCursorPos });
    } catch (error) {
      console.error('Error setting cursor:', error);
      new Notice('Error setting cursor position. Please check console for details.');
    }
  }
}

class QuickSwitchModal extends FuzzySuggestModal<QuickSwitchItem['item']> {
  private plugin: PropertyOverFilenamePlugin;
  private fileCache: Map<string, CachedFileData> = new Map();
  private recentFiles: TFile[] = [];
  private searchTimeout: number | null = null;

  constructor(app: App, plugin: PropertyOverFilenamePlugin) {
    super(app);
    this.plugin = plugin;
    this.limit = 100;
    this.setPlaceholder('Type to search notes by title or filename...');
    this.buildFileCache();
    this.updateRecentFiles();
    this.addKeyboardNavigation();
  }

  private addKeyboardNavigation(): void {
    // Add escape key handling
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  private buildFileCache(): void {
    this.fileCache.clear();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      this.updateFileCache(file);
    });
  }

  private updateFileCache(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    let displayName = file.basename;
    let isCustomDisplay = false;
    let aliases: string[] = [];

    if (frontmatter && frontmatter[this.plugin.settings.propertyKey] !== undefined && frontmatter[this.plugin.settings.propertyKey] !== null) {
      const propertyValue = String(frontmatter[this.plugin.settings.propertyKey]).trim();
      if (propertyValue !== '') {
        displayName = propertyValue;
        isCustomDisplay = true;
      }
    }

    if (frontmatter?.aliases) {
      aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [frontmatter.aliases];
      aliases = aliases.map(alias => String(alias).trim()).filter(alias => alias !== '');
    }

    this.fileCache.set(file.path, {
      file,
      displayName,
      aliases,
      lastModified: file.stat.mtime,
      isCustomDisplay
    });
  }

  private updateRecentFiles(): void {
    // Get recently opened files from workspace
    const recentFiles = this.app.workspace.getLeavesOfType('markdown')
      .map(leaf => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView)
      .map(view => view.file)
      .filter((file): file is TFile => file !== null) // Filter out null files
      .filter((file, index, self) => self.indexOf(file) === index) // Remove duplicates
      .slice(0, 10); // Limit to 10 recent files
    
    this.recentFiles = recentFiles;
  }

  getItems(): QuickSwitchItem['item'][] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: QuickSwitchItem['item']): string {
    if ('isNewNote' in item) {
      return `Create new note: ${item.newName}`;
    }
    const display = this.getDisplayName(item);
    return display + (this.plugin.settings.includeFilenameInSearch && display !== item.basename ? ` (${item.basename})` : '');
  }

  getDisplayName(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    const propertyValue = frontmatter?.[this.plugin.settings.propertyKey];
    if (propertyValue !== undefined && propertyValue !== null) {
      const trimmed = String(propertyValue).trim();
      if (trimmed !== '') {
        return trimmed;
      }
    }
    return file.basename;
  }

  getSuggestions(query: string): FuzzyMatch<QuickSwitchItem['item']>[] {
    if (!this.plugin.settings.enableForQuickSwitcher) {
      return [];
    }

    const searchQuery = query.trim();
    
    // Clear previous timeout
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    // If no query, show recent files
    if (!searchQuery) {
      return this.getRecentFilesResults();
    }

    return this.performSearch(searchQuery);
  }

  private getRecentFilesResults(): FuzzyMatch<QuickSwitchItem['item']>[] {
    this.updateRecentFiles();
    return this.recentFiles.map(file => ({
      item: file,
      match: { score: 1000, matches: [] }
    }));
  }

  private performSearch(searchQuery: string): FuzzyMatch<QuickSwitchItem['item']>[] {
    const search = prepareFuzzySearch(searchQuery);
    const results: FuzzyMatch<QuickSwitchItem['item']>[] = [];

    // Use cached data for much faster search
    for (const cachedData of this.fileCache.values()) {
      const { file, displayName, aliases } = cachedData;
      const text = this.getItemText(file);
      const match = search(text) ?? { score: 0, matches: [] };
      
      let aliasMatch = false;
      if (this.plugin.settings.includeAliasesInSearch && aliases.length > 0) {
        aliasMatch = aliases.some(alias => this.fuzzyMatch(alias, searchQuery));
      }
      
      if (aliasMatch && match.matches.length === 0) {
        results.push({ item: file, match: { score: -0.1, matches: [[0, searchQuery.length]] } });
      } else if (match.matches.length > 0) {
        results.push({ item: file, match });
      }
    }

    try {
      // Sort by score and then alphabetically
      results.sort((a, b) => {
        const scoreDiff = b.match.score - a.match.score;
        if (scoreDiff !== 0) return scoreDiff;
        return this.getItemText(a.item).localeCompare(this.getItemText(b.item));
      });

      // Check for exact matches
      const lowerQuery = searchQuery.toLowerCase();
      const hasExact = results.some(r => 
        r.item instanceof TFile && (
          this.getDisplayName(r.item).toLowerCase() === lowerQuery ||
          (this.plugin.settings.includeFilenameInSearch && r.item.basename.toLowerCase() === lowerQuery) ||
          (this.plugin.settings.includeAliasesInSearch && this.fileCache.get(r.item.path)?.aliases.some(alias => alias.toLowerCase() === lowerQuery))
        )
      );

      // Add new note option if no exact match
      if (!hasExact) {
        const newItem = { isNewNote: true, newName: searchQuery };
        results.unshift({
          item: newItem,
          match: { score: 1000, matches: [[0, searchQuery.length]] },
        });
      }

      return results.slice(0, this.limit);
    } catch (error) {
      console.error('Error generating suggestions:', error);
      new Notice('Error updating Quick Switcher suggestions. Please check console for details.');
      return [];
    }
  }

  fuzzyMatch(str: string, query: string): boolean {
    let i = 0;
    const lowerStr = str.toLowerCase();
    const lowerQuery = query.toLowerCase();
    for (const char of lowerQuery) {
      i = lowerStr.indexOf(char, i) + 1;
      if (i === 0) return false;
    }
    return true;
  }

  renderSuggestion(suggestion: FuzzyMatch<QuickSwitchItem['item']>, el: HTMLElement): void {
    const { item, match } = suggestion;
    const query = this.inputEl.value.trim();
    const text = this.getItemText(item);
    const content = el.createDiv({ cls: 'suggestion-content' });

    if ('isNewNote' in item) {
      content.setText(text);
      return;
    }

    if (query && match.matches.length > 0) {
      let index = 0;
      const fragment = document.createDocumentFragment();
      for (const m of match.matches) {
        fragment.appendText(text.slice(index, m[0]));
        const highlight = document.createElement('span');
        highlight.className = 'suggestion-highlight';
        highlight.appendText(text.slice(m[0], m[1]));
        fragment.appendChild(highlight);
        index = m[1];
      }
      fragment.appendText(text.slice(index));
      content.appendChild(fragment);
    } else {
      content.setText(text);
    }
    if (item instanceof TFile) {
      content.createDiv({ cls: 'suggestion-note', text: item.path.replace('.md', '') });
    }
  }

  onChooseItem(item: QuickSwitchItem['item'], evt: MouseEvent | KeyboardEvent): void {
    if ('isNewNote' in item) {
      this.app.vault
        .create(`${item.newName}.md`, '')
        .then((file) => {
          this.app.workspace.getLeaf().openFile(file);
        })
        .catch((err) => {
          new Notice(`Error creating note: ${err.message}`);
        });
    } else {
      this.app.workspace.getLeaf().openFile(item);
    }
  }
}

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

class SettingTab extends PluginSettingTab {
  plugin: PropertyOverFilenamePlugin;

  constructor(app: App, plugin: PropertyOverFilenamePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Property key')
      .setDesc('The property to use as the display title.')
      .addText((text) =>
        text
          .setPlaceholder('title')
          .setValue(this.plugin.settings.propertyKey)
          .onChange(async (value) => {
            this.plugin.settings.propertyKey = value || 'title';
            await this.plugin.saveSettings(this.plugin.settings.enableForQuickSwitcher);
          })
      );

    new Setting(containerEl)
      .setName('When linking notes')
      .setDesc('Enable property-based titles in the link suggester.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableForLinking)
          .onChange(async (value) => {
            this.plugin.settings.enableForLinking = value;
            await this.plugin.saveSettings(this.plugin.settings.enableForQuickSwitcher);
          })
      );

    new Setting(containerEl)
      .setName('In Quick Switcher')
      .setDesc('Enable property-based titles in the quick switcher.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableForQuickSwitcher)
          .onChange(async (value) => {
            const prevQuickSwitcherState = this.plugin.settings.enableForQuickSwitcher;
            this.plugin.settings.enableForQuickSwitcher = value;
            await this.plugin.saveSettings(prevQuickSwitcherState);
          })
      );

    new Setting(containerEl)
      .setName('Include filename in fuzzy searches')
      .setDesc('Include note filenames in fuzzy search results for link suggester and quick switcher.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeFilenameInSearch)
          .onChange(async (value) => {
            this.plugin.settings.includeFilenameInSearch = value;
            await this.plugin.saveSettings(this.plugin.settings.enableForQuickSwitcher);
          })
      );

    new Setting(containerEl)
      .setName('Include aliases in fuzzy searches')
      .setDesc('Include property aliases in fuzzy search results for link suggester and quick switcher.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeAliasesInSearch)
          .onChange(async (value) => {
            this.plugin.settings.includeAliasesInSearch = value;
            await this.plugin.saveSettings(this.plugin.settings.enableForQuickSwitcher);
          })
      );
  }
}