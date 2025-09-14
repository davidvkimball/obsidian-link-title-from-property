import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, Notice, TFile } from 'obsidian';
import { PluginSettings, SuggestionItem, CachedFileData, EditorSuggestInternal } from '../types';
import { fuzzyMatch, getMatchScore, buildFileCache } from '../utils/search';

export class LinkTitleSuggest extends EditorSuggest<SuggestionItem> {
  private plugin: any; // PropertyOverFilenamePlugin
  private fileCache: Map<string, CachedFileData> = new Map();
  private searchTimeout: number | null = null;

  constructor(plugin: any) {
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

    // Use cached data for much faster search
    for (const cachedData of this.fileCache.values()) {
      const { file, displayName, aliases, isCustomDisplay } = cachedData;
      
      let matches = !query || fuzzyMatch(displayName, query);
      
      if (this.plugin.settings.includeFilenameInSearch) {
        matches = matches || fuzzyMatch(file.basename, query);
      }
      
      if (this.plugin.settings.includeAliasesInSearch && aliases.length > 0) {
        matches = matches || aliases.some(alias => fuzzyMatch(alias, query));
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

  sortSuggestions(suggestions: SuggestionItem[], query: string): SuggestionItem[] {
    return suggestions.sort((a, b) => {
      const aScore = getMatchScore(a.display, query, a.file?.basename ?? '', this.plugin.settings.includeFilenameInSearch);
      const bScore = getMatchScore(b.display, query, b.file?.basename ?? '', this.plugin.settings.includeFilenameInSearch);
      if (a.isNewNote) return -1;
      if (b.isNewNote) return 1;
      return bScore - aScore || a.display.localeCompare(b.display);
    });
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
    const useMarkdownLinks = (this.app.vault as any).getConfig('useMarkdownLinks') ?? false;
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
