import { Notice } from "obsidian";

export function registerCommands(plugin: any) {
  // Quick Switcher command
  plugin.addCommand({
    id: 'open-quick-switcher',
    name: 'Open Quick Switcher (Property-based)',
    callback: () => {
      import('../ui/QuickSwitchModal').then(({ QuickSwitchModal }) => {
        new QuickSwitchModal(plugin.app, plugin).open();
      });
    }
  });

  // Toggle linking command
  plugin.addCommand({
    id: 'toggle-linking',
    name: 'Toggle property-based linking',
    callback: async () => {
      plugin.settings.enableForLinking = !plugin.settings.enableForLinking;
      await plugin.saveData(plugin.settings);
      plugin.updateLinkSuggester();
      new Notice(`Property-based linking ${plugin.settings.enableForLinking ? 'enabled' : 'disabled'}`);
    }
  });

  // Toggle Quick Switcher command
  plugin.addCommand({
    id: 'toggle-quick-switcher',
    name: 'Toggle property-based Quick Switcher',
    callback: async () => {
      const prevState = plugin.settings.enableForQuickSwitcher;
      plugin.settings.enableForQuickSwitcher = !plugin.settings.enableForQuickSwitcher;
      await plugin.saveSettings(prevState);
      new Notice(`Property-based Quick Switcher ${plugin.settings.enableForQuickSwitcher ? 'enabled' : 'disabled'}`);
    }
  });

  // Rebuild cache command
  plugin.addCommand({
    id: 'rebuild-cache',
    name: 'Rebuild file cache',
    callback: () => {
      plugin.rebuildCache();
      new Notice('File cache rebuilt');
    }
  });

  // Toggle drag and drop command
  plugin.addCommand({
    id: 'toggle-drag-drop',
    name: 'Toggle property-based drag and drop',
    callback: async () => {
      plugin.settings.enableForDragDrop = !plugin.settings.enableForDragDrop;
      await plugin.saveData(plugin.settings);
      new Notice(`Property-based drag and drop ${plugin.settings.enableForDragDrop ? 'enabled' : 'disabled'}`);
    }
  });
}
