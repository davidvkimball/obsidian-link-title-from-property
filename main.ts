import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, FuzzySuggestModal, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, prepareFuzzySearch, SearchResult, FuzzyMatch } from 'obsidian';

interface PluginSettings {
  propertyKey: string;
  enableForLinking: boolean;
  enableForQuickSwitcher: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  propertyKey: 'title',
  enableForLinking: true,
  enableForQuickSwitcher: true,
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

  constructor(plugin: PropertyOverFilenamePlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  open(): void {
    super.open();
    const el = (this as any).suggestEl;
    if (el && !el.querySelector('.prompt-instructions')) {
      const instructions = el.createDiv({ cls: 'prompt-instructions' });
      instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type # to link heading');
      instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type ^ to link blocks');
      instructions.createDiv({ cls: 'prompt-instruction' }).setText('Type | to change display text');
    }
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
      if (!query || this.fuzzyMatch(display, query) || this.fuzzyMatch(file.basename, query)) {
        suggestions.push({ file, display, isCustomDisplay });
        existingFiles.add(file.basename.toLowerCase());
      }
    });

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

class QuickSwitchModal extends FuzzySuggestModal<QuickSwitchItem['item']> {
  private plugin: PropertyOverFilenamePlugin;

  constructor(app: App, plugin: PropertyOverFilenamePlugin) {
    super(app);
    this.plugin = plugin;
    this.limit = 100;
    this.setPlaceholder('Type to search notes by title or filename...');
  }

  getItems(): QuickSwitchItem['item'][] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: QuickSwitchItem['item']): string {
    if ('isNewNote' in item) {
      return `Create new note: ${item.newName}`;
    }
    const display = this.getDisplayName(item);
    return display + (display !== item.basename ? ` (${item.basename})` : '');
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
    const items = this.getItems();
    const search = prepareFuzzySearch(searchQuery);
    let results: FuzzyMatch<QuickSwitchItem['item']>[] = items.map((item) => {
      const text = this.getItemText(item);
      const match = searchQuery ? search(text) : { score: 0, matches: [] };
      return { item, match: match || { score: 0, matches: [] } };
    });

    try {
      if (searchQuery) {
        results = results
          .filter((r) => r.match.matches.length > 0)
          .sort((a, b) => b.match.score - a.match.score || this.getItemText(a.item).localeCompare(this.getItemText(b.item)))
          .slice(0, this.limit);
        const lowerQuery = searchQuery.toLowerCase();
        const hasExact = items.some((item) => !('isNewNote' in item) && (this.getDisplayName(item).toLowerCase() === lowerQuery || item.basename.toLowerCase() === lowerQuery));
        if (!hasExact) {
          const newItem = { isNewNote: true, newName: searchQuery };
          results.unshift({
            item: newItem,
            match: { score: 1000, matches: [[0, searchQuery.length]] },
          });
        }
      } else {
        results = results
          .sort((a, b) => this.getItemText(a.item).localeCompare(this.getItemText(b.item)))
          .slice(0, this.limit);
      }
      return results;
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
    content.createDiv({ cls: 'suggestion-note', text: item.path.replace('.md', '') });
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
    this.addSettingTab(new SettingTab(this.app, this));
  }

  updateLinkSuggester() {
    const editorSuggest = (this.app.workspace as any).editorSuggest;
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
    const command = (this.app as any).commands.commands['switcher:open'];
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
    const editorSuggest = (this.app.workspace as any).editorSuggest;
    if (editorSuggest && this.suggest) {
      editorSuggest.suggests = editorSuggest.suggests.filter((s: any) => s !== this.suggest);
    }

    const command = (this.app as any).commands.commands['switcher:open'];
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
      .setName('In quick switcher')
      .setDesc('Enable property-based titles in quick switcher.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableForQuickSwitcher)
          .onChange(async (value) => {
            const prevQuickSwitcherState = this.plugin.settings.enableForQuickSwitcher;
            this.plugin.settings.enableForQuickSwitcher = value;
            await this.plugin.saveSettings(prevQuickSwitcherState);
          })
      );
  }
}