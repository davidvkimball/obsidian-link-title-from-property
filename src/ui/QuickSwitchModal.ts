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
