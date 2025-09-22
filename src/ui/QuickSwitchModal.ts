import { App, FuzzySuggestModal, MarkdownView, Notice, TFile, prepareFuzzySearch, FuzzyMatch } from 'obsidian';
import { QuickSwitchItem, CachedFileData, SearchMatchReason } from '../types';
import { fuzzyMatch, buildFileCache } from '../utils/search';

export class QuickSwitchModal extends FuzzySuggestModal<QuickSwitchItem['item']> {
  private plugin: any; // PropertyOverFilenamePlugin
  private fileCache: Map<string, CachedFileData> = new Map();
  private recentFiles: TFile[] = [];
  private searchTimeout: number | null = null;
  private matchReasons: Map<string, SearchMatchReason> = new Map();

  constructor(app: App, plugin: any) {
    super(app);
    this.plugin = plugin;
    this.limit = 10; // Match Obsidian's default limit
    
    // Set placeholder based on setting
    if (this.plugin.settings.enableForQuickSwitcher) {
      this.setPlaceholder('Type to search notes by title or filename...');
    } else {
      this.setPlaceholder('Type to search files...');
    }
    
    this.buildFileCache();
    this.updateRecentFiles();
    this.addKeyboardNavigation();
    this.addFooter();
    
    // Only add scoping class when enabled
    if (this.plugin.settings.enableForQuickSwitcher) {
      this.containerEl.addClass('property-over-filename-modal');
    }
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
      footer.innerHTML = `<div class="prompt-instruction"><span class="prompt-instruction-command">↑↓</span><span>to navigate</span></div><div class="prompt-instruction"><span class="prompt-instruction-command">↵</span><span>to open</span></div><div class="prompt-instruction"><span class="prompt-instruction-command">ctrl ↵</span><span>to open in new tab</span></div><div class="prompt-instruction"><span class="prompt-instruction-command">ctrl alt ↵</span><span>to open to the right</span></div><div class="prompt-instruction"><span class="prompt-instruction-command">shift ↵</span><span>to create</span></div><div class="prompt-instruction"><span class="prompt-instruction-command">esc</span><span>to dismiss</span></div>`;
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
    // Use Obsidian's internal recent files mechanism for perfect compatibility
    let recentFiles: TFile[] = [];
    
    const workspace = this.app.workspace as any;
    
    // Access Obsidian's recentFileTracker to get the same files as default quick switcher
    if (workspace.recentFileTracker?.getLastOpenFiles) {
      const lastOpenFiles = workspace.recentFileTracker.getLastOpenFiles();
      
      // Convert file paths to TFile objects
      recentFiles = lastOpenFiles
        .map((filePath: string) => this.app.vault.getAbstractFileByPath(filePath))
        .filter((file: any): file is TFile => file instanceof TFile)
        .slice(0, 10);
    }
    
    // Fallback if recentFileTracker is not available
    if (recentFiles.length === 0) {
      const openFiles = this.app.workspace.getLeavesOfType('markdown')
        .map(leaf => leaf.view)
        .filter((view): view is MarkdownView => view instanceof MarkdownView)
        .map(view => view.file)
        .filter((file): file is TFile => file !== null)
        .filter((file, index, self) => self.indexOf(file) === index);
      
      recentFiles = [...openFiles];
      
      if (recentFiles.length < 10) {
        const allFiles = this.app.vault.getMarkdownFiles();
        const remainingSlots = 10 - recentFiles.length;
        const additionalFiles = allFiles
          .filter(file => !recentFiles.includes(file))
          .slice(0, remainingSlots);
        recentFiles.push(...additionalFiles);
      }
      
      recentFiles = recentFiles.slice(0, 10);
    }
    
    this.recentFiles = recentFiles;
  }

  getItems(): QuickSwitchItem['item'][] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: QuickSwitchItem['item']): string {
    if ('isNewNote' in item) {
      return item.newName; // Just return the name, Obsidian will handle the "Enter to create" text
    }
    
    // When disabled, show just the filename like default Obsidian
    if (!this.plugin.settings.enableForQuickSwitcher) {
      return item.basename;
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
      // When disabled, use default Obsidian behavior - show all files with default search
      const searchQuery = query.trim();
      
      if (!searchQuery) {
        // Show recent files like default Obsidian
        return this.getRecentFilesResults();
      }
      
      // Use default Obsidian search - just show files with filename matching
      const files = this.app.vault.getMarkdownFiles();
      const search = prepareFuzzySearch(searchQuery);
      const results: FuzzyMatch<QuickSwitchItem['item']>[] = [];
      
      for (const file of files) {
        const match = search(file.basename) ?? { score: 0, matches: [] };
        if (match.matches.length > 0) {
          results.push({ item: file, match });
        }
      }
      
      // Sort by score and then alphabetically
      results.sort((a, b) => {
        const scoreDiff = b.match.score - a.match.score;
        if (scoreDiff !== 0) return scoreDiff;
        if (a.item instanceof TFile && b.item instanceof TFile) {
          return a.item.basename.localeCompare(b.item.basename);
        }
        return 0;
      });
      
      return results.slice(0, this.limit);
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
    
    // Only show recent files, exactly like Obsidian's default
    return this.recentFiles.map(file => ({
      item: file,
      match: { score: 1000, matches: [] }
    }));
  }

  private performSearch(searchQuery: string): FuzzyMatch<QuickSwitchItem['item']>[] {
    const search = prepareFuzzySearch(searchQuery);
    const results: FuzzyMatch<QuickSwitchItem['item']>[] = [];
    this.matchReasons.clear(); // Clear previous match reasons

    // Use cached data for much faster search
    for (const cachedData of this.fileCache.values()) {
      const { file, displayName, aliases } = cachedData;
      const text = this.getItemText(file);
      const match = search(text) ?? { score: 0, matches: [] };
      
      // Track which fields caused the match
      const matchReason: SearchMatchReason = {
        matchedInTitle: false,
        matchedInFilename: false,
        matchedInAlias: false
      };
      
      // Check if title/property match
      if (match.matches.length > 0) {
        matchReason.matchedInTitle = true;
      }
      
      // Check if filename match (only if different from title)
      if (this.plugin.settings.includeFilenameInSearch && 
          file.basename !== displayName && 
          fuzzyMatch(file.basename, searchQuery)) {
        matchReason.matchedInFilename = true;
      }
      
      // Check if alias match
      let aliasMatch = false;
      if (this.plugin.settings.includeAliasesInSearch && aliases.length > 0) {
        aliasMatch = aliases.some(alias => fuzzyMatch(alias, searchQuery));
        if (aliasMatch) {
          matchReason.matchedInAlias = true;
        }
      }
      
      // If we have any match, add to results
      if (match.matches.length > 0 || aliasMatch) {
        results.push({ item: file, match: match.matches.length > 0 ? match : { score: -0.1, matches: [[0, searchQuery.length]] } });
        this.matchReasons.set(file.path, matchReason);
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
      results.some(r => 
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
      // For new notes, use the exact HTML structure from default Obsidian
      el.empty();
      el.addClass('mod-complex');
      
      // Main suggestion content
      const suggestionContent = el.createDiv({ cls: 'suggestion-content' });
      const suggestionTitle = suggestionContent.createDiv({ cls: 'suggestion-title' });
      suggestionTitle.setText(text);
      
      // Add "Enter to create" text on the right using the correct class
      const suggestionAux = el.createDiv({ cls: 'suggestion-aux' });
      const suggestionAction = suggestionAux.createSpan({ cls: 'suggestion-action' });
      suggestionAction.setText('Enter to create');
      
      return;
    }

    // When disabled, use default Obsidian styling (no custom classes or icons)
    if (!this.plugin.settings.enableForQuickSwitcher) {
      // Use default Obsidian single-line display
      if (item instanceof TFile) {
        el.setText(item.path.replace('.md', ''));
      } else {
        el.setText(text);
      }
    } else {
      // When enabled, use our custom styling with icons
      const matchReason = this.matchReasons.get(item.path);
      const shouldShowIcon = matchReason && (matchReason.matchedInTitle || matchReason.matchedInFilename || matchReason.matchedInAlias);
      
      if (shouldShowIcon) {
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
        
        // Add suggestion-aux with appropriate icon based on match reason
        const suggestionAux = el.createDiv({ cls: 'suggestion-aux' });
        const suggestionFlair = suggestionAux.createSpan({ 
          cls: 'suggestion-flair', 
          attr: { 'aria-label': this.getIconLabel(matchReason) } 
        });
        
        // Determine icon based on priority: title > filename > alias
        if (matchReason.matchedInTitle) {
          // Type icon for title/property matches
          suggestionFlair.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-type"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
        } else if (matchReason.matchedInFilename) {
          // File icon for filename matches
          suggestionFlair.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-file-text"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14,2 14,8 20,8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10,9 9,9 8,9"></polyline></svg>`;
        } else if (matchReason.matchedInAlias) {
          // Arrow icon for alias matches
          suggestionFlair.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-forward"><polyline points="15 17 20 12 15 7"></polyline><path d="M4 18v-2a4 4 0 0 1 4-4h12"></path></svg>`;
        }
      } else {
        // For normal filename/folder results, show like default Obsidian with full path (no icon)
        if (item instanceof TFile) {
          el.setText(item.path.replace('.md', ''));
        } else {
          el.setText(text);
        }
      }
    }
  }

  private getIconLabel(matchReason: SearchMatchReason): string {
    if (matchReason.matchedInTitle) {
      return 'Title/Property Match';
    } else if (matchReason.matchedInFilename) {
      return 'Filename Match';
    } else if (matchReason.matchedInAlias) {
      return 'Alias Match';
    }
    return 'Match';
  }

  private isUsingCustomProperty(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    const propertyValue = frontmatter?.[this.plugin.settings.propertyKey];
    return propertyValue !== undefined && propertyValue !== null && String(propertyValue).trim() !== '';
  }

  private isUsingAlias(file: TFile): boolean {
    // Check if this file has aliases and if we're currently searching
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    const aliases = frontmatter?.aliases;
    
    if (!aliases) return false;
    
    // For now, show alias icon if the file has aliases and we're not using a custom property
    const isUsingCustomProperty = this.isUsingCustomProperty(file);
    return !isUsingCustomProperty && aliases;
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

