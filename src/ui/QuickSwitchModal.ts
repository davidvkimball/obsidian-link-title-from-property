import { App, FuzzySuggestModal, MarkdownView, Notice, TFile, prepareFuzzySearch, FuzzyMatch } from 'obsidian';
import { PluginSettings, QuickSwitchItem, CachedFileData } from '../types';
import { fuzzyMatch, buildFileCache } from '../utils/search';

export class QuickSwitchModal extends FuzzySuggestModal<QuickSwitchItem['item']> {
  private plugin: any; // PropertyOverFilenamePlugin
  private fileCache: Map<string, CachedFileData> = new Map();
  private recentFiles: TFile[] = [];
  private searchTimeout: number | null = null;

  constructor(app: App, plugin: any) {
    super(app);
    this.plugin = plugin;
    this.limit = 200; // Increased to show more items like default
    this.setPlaceholder('Type to search notes by title or filename...');
    this.buildFileCache();
    this.updateRecentFiles();
    this.addKeyboardNavigation();
    this.addFooter();
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

  private addFooter(): void {
    // Find the .prompt container and add footer inside it
    const promptContainer = this.containerEl.querySelector('.prompt');
    if (promptContainer) {
      const footer = promptContainer.createDiv({ cls: 'prompt-instructions' });
      footer.innerHTML = `
        <div class="prompt-instruction">
          <span class="prompt-instruction-command">↑↓</span>
          <span>to navigate</span>
        </div>
        <div class="prompt-instruction">
          <span class="prompt-instruction-command">↵</span>
          <span>to open</span>
        </div>
        <div class="prompt-instruction">
          <span class="prompt-instruction-command">ctrl ↵</span>
          <span>to open in new tab</span>
        </div>
        <div class="prompt-instruction">
          <span class="prompt-instruction-command">ctrl alt ↵</span>
          <span>to open to the right</span>
        </div>
        <div class="prompt-instruction">
          <span class="prompt-instruction-command">shift ↵</span>
          <span>to create</span>
        </div>
        <div class="prompt-instruction">
          <span class="prompt-instruction-command">esc</span>
          <span>to dismiss</span>
        </div>
      `;
    }
  }

  buildFileCache(): void {
    this.fileCache = buildFileCache(
      this.app.vault.getMarkdownFiles(),
      this.app.metadataCache,
      this.plugin.settings.propertyKey
    );
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
    return display;
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
        aliasMatch = aliases.some(alias => fuzzyMatch(alias, searchQuery));
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

      // Only add new note option if no results at all
      if (results.length === 0) {
        const newItem = { isNewNote: true, newName: searchQuery };
        results.push({
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

  renderSuggestion(suggestion: FuzzyMatch<QuickSwitchItem['item']>, el: HTMLElement): void {
    const { item } = suggestion;
    const text = this.getItemText(item);
    
    if ('isNewNote' in item) {
      // For new notes, just show the text without arrow
      el.setText(text);
      return;
    }

    // Add mod-complex class to match Obsidian's structure
    el.addClass('mod-complex');

    // Create the main suggestion container
    const suggestionContent = el.createDiv({ cls: 'suggestion-content' });
    
    // Main title
    const titleEl = suggestionContent.createDiv({ cls: 'suggestion-title' });
    titleEl.setText(text);
    
    // File path below
    if (item instanceof TFile) {
      const pathEl = suggestionContent.createDiv({ cls: 'suggestion-note' });
      pathEl.setText(item.path.replace('.md', ''));
    }
    
    // Add suggestion-aux with proper SVG arrow icon (matching Obsidian's structure)
    const suggestionAux = el.createDiv({ cls: 'suggestion-aux' });
    const suggestionFlair = suggestionAux.createSpan({ cls: 'suggestion-flair', attr: { 'aria-label': 'Alias' } });
    suggestionFlair.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-forward"><polyline points="15 17 20 12 15 7"></polyline><path d="M4 18v-2a4 4 0 0 1 4-4h12"></path></svg>`;
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
      // Handle different modifier keys like default Obsidian
      if (evt instanceof KeyboardEvent) {
        if (evt.ctrlKey && evt.altKey) {
          // Open to the right
          this.app.workspace.splitActiveLeaf('horizontal');
          this.app.workspace.getLeaf().openFile(item);
        } else if (evt.ctrlKey) {
          // Open in new tab
          this.app.workspace.getLeaf().openFile(item);
        } else if (evt.shiftKey) {
          // Create new note (this shouldn't happen for existing files, but keeping for consistency)
          this.app.workspace.getLeaf().openFile(item);
        } else {
          // Default: open in current tab
          this.app.workspace.getLeaf().openFile(item);
        }
      } else {
        // Mouse click: default behavior
        this.app.workspace.getLeaf().openFile(item);
      }
    }
  }
}
