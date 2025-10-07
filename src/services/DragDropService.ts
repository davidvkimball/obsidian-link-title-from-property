import { TFile, MarkdownView } from "obsidian";

export class DragDropService {
  private plugin: any;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  handleDragDrop(event: DragEvent, editor: any): void {
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
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      return;
    }

    // Get the display name from frontmatter
    const displayName = this.getDisplayName(file);

    // Don't prevent default - let Obsidian insert the default link first
    // Then we'll replace it with our custom display text
    setTimeout(() => {
      this.replaceLastInsertedLink(file, displayName, editor);
    }, 50);
  }

  handleDOMDrop(event: DragEvent): void {
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

    // Parse Obsidian URL format: obsidian://open?vault=...&file=...
    let actualFilePath = filePath;
    if (filePath.startsWith('obsidian://open?')) {
      const url = new URL(filePath);
      const fileParam = url.searchParams.get('file');
      if (fileParam) {
        actualFilePath = decodeURIComponent(fileParam) + '.md';
      } else {
        return;
      }
    } else if (!filePath.endsWith('.md')) {
      return;
    }

    // Find the file in the vault
    const file = this.plugin.app.vault.getAbstractFileByPath(actualFilePath);
    
    if (!file || !(file instanceof TFile)) {
      return;
    }

    // Get the display name from frontmatter
    const displayName = this.getDisplayName(file);

    // Don't prevent default - let Obsidian insert the default link first
    // Then we'll replace it with our custom display text
    setTimeout(() => {
      const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView && activeView.editor) {
        this.replaceLastInsertedLink(file, displayName, activeView.editor);
      }
    }, 50);
  }

  private getDisplayName(file: TFile): string {
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter;
    let displayName = file.basename; // Default to file name
    
    if (frontmatter && frontmatter[this.plugin.settings.propertyKey] !== undefined && frontmatter[this.plugin.settings.propertyKey] !== null) {
      const propertyValue = String(frontmatter[this.plugin.settings.propertyKey]).trim();
      if (propertyValue !== '') {
        displayName = propertyValue; // Use frontmatter title
      }
    }

    return displayName;
  }

  private replaceLastInsertedLink(file: TFile, displayName: string, editor: any): void {
    const content = editor.getValue();
    const cursor = editor.getCursor();
    
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
      lastMatch = match;
    }
    
    if (lastMatch) {
      const linkPath = lastMatch[1];
      const newLinkText = `[[${linkPath}|${displayName}]]`;
      const startPos = { line: cursor.line, ch: lastMatch.index };
      const endPos = { line: cursor.line, ch: lastMatch.index + lastMatch[0].length };
      editor.replaceRange(newLinkText, startPos, endPos);
      return;
    }
    
    // Reset regex for markdown links
    markdownLinkRegex.lastIndex = 0;
    
    // Find the last markdown link on the current line
    while ((match = markdownLinkRegex.exec(currentLine)) !== null) {
      lastMatch = match;
    }
    
    if (lastMatch) {
      const linkUrl = lastMatch[2];
      const newLinkText = `[${displayName}](${linkUrl})`;
      const startPos = { line: cursor.line, ch: lastMatch.index };
      const endPos = { line: cursor.line, ch: lastMatch.index + lastMatch[0].length };
      editor.replaceRange(newLinkText, startPos, endPos);
    }
  }
}
