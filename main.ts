import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface PluginSettings {
  propertyKey: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
  propertyKey: 'title',
};

interface SuggestionItem {
  file?: TFile; // Optional for new note suggestion
  display: string;
  isCustomDisplay: boolean;
  isNewNote?: boolean; // Flag for new note creation
}

class LinkTitleSuggest extends EditorSuggest<SuggestionItem> {
  private plugin: LinkTitleFromPropertyPlugin;

  constructor(plugin: LinkTitleFromPropertyPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  open(): void {
    super.open();
    const el = (this as any).suggestEl;
    if (el && !el.querySelector('.prompt-instructions')) {
      const instructions = el.createDiv({ cls: 'prompt-instructions' });
      const p1 = instructions.createDiv({ cls: 'prompt-instruction' });
      p1.setText('Type # to link heading');
      const p2 = instructions.createDiv({ cls: 'prompt-instruction' });
      p2.setText('Type ^ to link blocks');
      const p3 = instructions.createDiv({ cls: 'prompt-instruction' });
      p3.setText('Type | to change display text');
    }
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).substring(0, cursor.ch);
    const match = /\[\[([^#^|\]]+)$/.exec(line);
    if (match) {
      return {
        start: { line: cursor.line, ch: line.lastIndexOf('[[') },
        end: cursor,
        query: match[1],
      };
    }
    return null;
  }

  getSuggestions(context: EditorSuggestContext): SuggestionItem[] {
    const query = context.query.trim();
    const suggestions: SuggestionItem[] = [];
    const existingFiles = new Set<string>();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      let display = file.basename;
      let isCustomDisplay = false;
      if (frontmatter && frontmatter[this.plugin.settings.propertyKey] !== undefined && frontmatter[this.plugin.settings.propertyKey] !== null) {
        const propertyValue = String(frontmatter[this.plugin.settings.propertyKey]).trim();
        if (propertyValue !== '') {
          display = propertyValue;
          isCustomDisplay = true;
        }
      }
      if (this.fuzzyMatch(display, context.query) || this.fuzzyMatch(file.basename, context.query)) {
        suggestions.push({ file, display, isCustomDisplay });
        existingFiles.add(file.basename.toLowerCase());
      }
    });

    // Add new note suggestion as first option if query doesn't match an existing file exactly
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
      if (a.isNewNote) return -1; // New note always first
      if (b.isNewNote) return 1;
      return bScore - aScore || a.display.localeCompare(b.display); // Fallback to score then alphabetical
    });
  }

  getMatchScore(display: string, query: string, basename: string): number {
    let score = 0;
    const lowerDisplay = display.toLowerCase();
    const lowerBasename = basename.toLowerCase();
    const lowerQuery = query.toLowerCase();
    if (lowerDisplay.startsWith(lowerQuery)) score += 10;
    else if (lowerDisplay.includes(lowerQuery)) score += 5;
    if (lowerBasename.startsWith(lowerQuery)) score += 8;
    else if (lowerBasename.includes(lowerQuery)) score += 4;
    return score;
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
    const currentLine = editor.getLine(end.line);
    const useMarkdownLinks = (this.app.vault as any).getConfig('useMarkdownLinks') ?? false;
    let linkText: string;

    if (suggestion.isNewNote) {
      const newFile = await this.app.vault.create(`${suggestion.display}.md`, '');
      linkText = useMarkdownLinks
        ? `[${suggestion.display}](${encodeURI(newFile.path)})`
        : `[[${newFile.basename}]]`;
    } else {
      if (useMarkdownLinks) {
        linkText = `[${suggestion.display}](${encodeURI(suggestion.file!.path)})`;
      } else {
        const linkPath = suggestion.file!.basename;
        linkText = `[[${linkPath}|${suggestion.display}]]`;
      }
    }

    // Replace the full input, including any trailing characters up to the line end
    const fullStart = { line: start.line, ch: start.ch };
    const fullEnd = { line: end.line, ch: currentLine.length };
    editor.replaceRange(linkText, fullStart, fullEnd);

    // Move cursor and clear selection to prevent auto-completion
    const newCursor = { line: end.line, ch: start.ch + linkText.length };
    editor.setCursor(newCursor);
    editor.setSelection(newCursor, newCursor);
  }
}

export default class LinkTitleFromPropertyPlugin extends Plugin {
  settings: PluginSettings;
  suggest: LinkTitleSuggest;

  async onload() {
    await this.loadSettings();
    this.suggest = new LinkTitleSuggest(this);

    const editorSuggest = (this.app.workspace as any).editorSuggest;
    if (editorSuggest) {
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => !s.constructor.name.includes('LinkSuggest'));
      editorSuggest.suggests.unshift(this.suggest);
    }

    this.registerEditorSuggest(this.suggest);
    this.addSettingTab(new SettingTab(this.app, this));
  }

  onunload() {
    const editorSuggest = (this.app.workspace as any).editorSuggest;
    if (editorSuggest) {
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => s !== this.suggest);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class SettingTab extends PluginSettingTab {
  plugin: LinkTitleFromPropertyPlugin;

  constructor(app: App, plugin: LinkTitleFromPropertyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Property key')
      .setDesc('The frontmatter property to use as the display title (e.g., "title" or "display_title").')
      .addText((text) =>
        text
          .setPlaceholder('title')
          .setValue(this.plugin.settings.propertyKey)
          .onChange(async (value) => {
            this.plugin.settings.propertyKey = value || 'title';
            await this.plugin.saveSettings();
          })
      );
  }
}