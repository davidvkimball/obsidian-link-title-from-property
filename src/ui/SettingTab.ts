import { App, PluginSettingTab, Setting } from 'obsidian';

export class SettingTab extends PluginSettingTab {
  plugin: any; // PropertyOverFilenamePlugin

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    // Add scoping class to prevent CSS from affecting other settings
    containerEl.addClass('property-over-filename-settings');

    new Setting(containerEl)
      .setName('Property key')
      .setDesc('The property to use as the display title.')
      .addText((text) =>
        text
          .setPlaceholder('title')
          .setValue(this.plugin.settings.propertyKey)
          .onChange(async (value) => {
            this.plugin.settings.propertyKey = value.trim() || 'title';
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.updateLinkSuggester();
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
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.updateLinkSuggester();
        })
      );

    new Setting(containerEl)
      .setName('In quick switcher')
      .setDesc('Enable property-based titles in the quick switcher.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableForQuickSwitcher)
          .onChange(async (value) => {
            const prevQuickSwitcherState = this.plugin.settings.enableForQuickSwitcher;
            this.plugin.settings.enableForQuickSwitcher = value;
            await this.plugin.saveSettings(prevQuickSwitcherState);
          })
      );

    new Setting(containerEl)
      .setName('Include file name in fuzzy searches')
      .setDesc('Include note file names in fuzzy search results for link suggester and quick switcher.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeFilenameInSearch)
          .onChange(async (value) => {
            this.plugin.settings.includeFilenameInSearch = value;
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('Include aliases in fuzzy searches')
      .setDesc('Include property aliases in fuzzy search results for link suggester and quick switcher.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeAliasesInSearch)
          .onChange(async (value) => {
            this.plugin.settings.includeAliasesInSearch = value;
            await this.plugin.saveData(this.plugin.settings);
          })
      );

    new Setting(containerEl)
      .setName('When dragging notes')
      .setDesc('Use property-based titles when dragging notes from the file explorer.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableForDragDrop)
          .onChange(async (value) => {
            this.plugin.settings.enableForDragDrop = value;
            await this.plugin.saveData(this.plugin.settings);
          })
      );
  }
}
