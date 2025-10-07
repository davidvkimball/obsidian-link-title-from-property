import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, Notice, TFile } from 'obsidian';
import { SuggestionItem, CachedFileData, EditorSuggestInternal, SearchMatchReason } from '../types';
import { fuzzyMatch, getMatchScore, buildFileCache } from '../utils/search';

export class LinkTitleSuggest extends EditorSuggest<SuggestionItem> {
  private plugin: any; // PropertyOverFileNamePlugin
  private fileCache: Map<string, CachedFileData> = new Map();
  private searchTimeout: number | null = null;
  private matchReasons: Map<string, SearchMatchReason> = new Map();

  constructor(plugin: any) {
    super(plugin.app);
    this.plugin = plugin;
    this.buildFileCache();
  }

  open(): void {
    super.open();
    const el = (this as EditorSuggestInternal).suggestEl;
    if (el) {
      // Add scoping class to prevent CSS from affecting other suggestion systems
      el.addClass('property-over-filename-suggestion');
      
      if (!el.querySelector('.prompt-instructions')) {
        const instructions = el.createDiv({ cls: 'prompt-instructions' });
        instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type # to link heading');
        instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type ^ to link blocks');
        instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type | to change display text');
      }
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

  buildFileCache(): void {
    this.fileCache = buildFileCache(
      this.app.vault.getMarkdownFiles(),
      this.app.metadataCache,
      this.plugin.settings.propertyKey
    );
  }

  updateFileCache(file: TFile): void {
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
    this.matchReasons.clear(); // Clear previous match reasons

    // Use cached data for much faster search
    for (const cachedData of this.fileCache.values()) {
      const { file, displayName, aliases, isCustomDisplay } = cachedData;
      
      // Track which fields caused the match
      const matchReason: SearchMatchReason = {
        matchedInTitle: false,
        matchedInFilename: false,
        matchedInAlias: false
      };
      
      let matches = false;
      
      // Check if title/property match
      if (!query || fuzzyMatch(displayName, query)) {
        matches = true;
        matchReason.matchedInTitle = true;
      }
      
      // Check if file name match (only if different from title)
      if (this.plugin.settings.includeFilenameInSearch && 
          file.basename !== displayName && 
          fuzzyMatch(file.basename, query)) {
        matches = true;
        matchReason.matchedInFilename = true;
      }
      
      // Check if alias match
      if (this.plugin.settings.includeAliasesInSearch && aliases.length > 0) {
        const aliasMatch = aliases.some(alias => fuzzyMatch(alias, query));
        if (aliasMatch) {
          matches = true;
          matchReason.matchedInAlias = true;
        }
      }
      
      if (matches) {
        suggestions.push({ file, display: displayName, isCustomDisplay });
        existingFiles.add(file.basename.toLowerCase());
        this.matchReasons.set(file.path, matchReason);
      }
    }

    // If no suggestions found, add a "No match found" item
    if (suggestions.length === 0 && query) {
      suggestions.push({
        display: 'No match found',
        isCustomDisplay: false,
        isNoMatch: true
      });
    }

    return this.sortSuggestions(suggestions, query);
  }

  sortSuggestions(suggestions: SuggestionItem[], query: string): SuggestionItem[] {
    return suggestions.sort((a, b) => {
      const aScore = getMatchScore(a.display, query, a.file?.basename ?? '', this.plugin.settings.includeFilenameInSearch);
      const bScore = getMatchScore(b.display, query, b.file?.basename ?? '', this.plugin.settings.includeFilenameInSearch);
      return bScore - aScore || a.display.localeCompare(b.display);
    });
  }

  renderSuggestion(suggestion: SuggestionItem, el: HTMLElement): void {
    el.empty();
    
    if (suggestion.isNoMatch) {
      // For "No match found", show just the text
      el.setText(suggestion.display);
      return;
    }
    
    if (suggestion.file) {
      // Get the match reason for this file
      const matchReason = this.matchReasons.get(suggestion.file.path);
      const shouldShowIcon = matchReason && (matchReason.matchedInTitle || matchReason.matchedInFilename || matchReason.matchedInAlias);
      
      if (shouldShowIcon) {
        // Add mod-complex class to match Obsidian's structure
        el.addClass('mod-complex');

        // Create the main suggestion container
        const suggestionContent = el.createDiv({ cls: 'suggestion-content' });
        
        // Main title
        const titleEl = suggestionContent.createDiv({ cls: 'suggestion-title' });
        titleEl.setText(suggestion.display);
        
        // File path below
        const pathEl = suggestionContent.createDiv({ cls: 'suggestion-note' });
        pathEl.setText(suggestion.file.path.replace('.md', ''));
        
        // Add suggestion-aux with appropriate icon based on match reason
        const suggestionAux = el.createDiv({ cls: 'suggestion-aux' });
        const suggestionFlair = suggestionAux.createSpan({ 
          cls: 'suggestion-flair', 
          attr: { 'aria-label': this.getIconLabel(matchReason) } 
        });
        
        // Determine icon based on priority: title > file name > alias
        if (matchReason.matchedInTitle) {
          // Type icon for title/property matches
          suggestionFlair.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-type"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
        } else if (matchReason.matchedInFilename) {
          // File icon for file name matches
          suggestionFlair.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-file-text"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14,2 14,8 20,8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10,9 9,9 8,9"></polyline></svg>`;
        } else if (matchReason.matchedInAlias) {
          // Arrow icon for alias matches
          suggestionFlair.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-forward"><polyline points="15 17 20 12 15 7"></polyline><path d="M4 18v-2a4 4 0 0 1 4-4h12"></path></svg>`;
        }
      } else {
        // For normal file name results, show like default Obsidian (no icon)
        const content = el.createDiv({ cls: 'suggestion-content' });
        content.createDiv({ cls: 'suggestion-title', text: suggestion.display });
        content.createDiv({ cls: 'suggestion-note', text: suggestion.file.path.replace('.md', '') });
      }
    }
  }

  private getIconLabel(matchReason: SearchMatchReason): string {
    if (matchReason.matchedInTitle) {
      return 'Title/Property Match';
    } else if (matchReason.matchedInFilename) {
      return 'File Name Match';
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

  async selectSuggestion(suggestion: SuggestionItem, evt: MouseEvent | KeyboardEvent): Promise<void> {
    // Don't do anything for "No match found"
    if (suggestion.isNoMatch) {
      return;
    }
    
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !this.context) return;
    const editor = activeView.editor;
    const { start, end } = this.context;
    const line = editor.getLine(start.line);
    let endPos = end;
    if (line.slice(end.ch, end.ch + 2) === ']]') {
      endPos = { line: end.line, ch: end.ch + 2 };
    }
    const useMarkdownLinks = (this.app.vault as any).getConfig('useMarkdownLinks') ?? false;
    let linkText: string;

    if (useMarkdownLinks) {
      linkText = `[${suggestion.display}](${encodeURI(suggestion.file!.path)})`;
    } else {
      const linkPath = suggestion.file!.basename;
      linkText = `[[${linkPath}|${suggestion.display}]]`;
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