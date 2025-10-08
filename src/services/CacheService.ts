import { TFile } from "obsidian";
import { EditorSuggest } from "../types";

export class CacheService {
  private plugin: any;
  private suggest?: EditorSuggest;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  setSuggest(suggest: EditorSuggest) {
    this.suggest = suggest;
  }

  invalidateCache(file: TFile): void {
    if (this.suggest) {
      this.suggest.updateFileCache(file);
    }
  }

  rebuildCache(): void {
    if (this.suggest) {
      this.suggest.buildFileCache();
    }
  }
}
