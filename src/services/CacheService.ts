import { TFile } from "obsidian";

export class CacheService {
  private plugin: any;
  private suggest?: any;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  setSuggest(suggest: any) {
    this.suggest = suggest;
  }

  invalidateCache(file: TFile): void {
    if (this.suggest) {
      (this.suggest as any).updateFileCache(file);
    }
  }

  rebuildCache(): void {
    if (this.suggest) {
      (this.suggest as any).buildFileCache();
    }
  }
}
