import { AppInternal } from "../types";

export class QuickSwitcherService {
  private plugin: any;
  private originalSwitcherCommand?: any;
  private isCommandOverridden = false;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  updateQuickSwitcher() {
    // Always override the command - our callback will handle the setting
    if (!this.isCommandOverridden) {
      this.overrideQuickSwitcherCommand();
    }
  }

  private overrideQuickSwitcherCommand() {
    // Get the command registry
    const commands = (this.plugin.app as unknown as AppInternal).commands.commands;

    // Store the original command BEFORE we delete it
    if (commands['switcher:open'] && !this.originalSwitcherCommand) {
      const originalCmd = commands['switcher:open'] as any;
      this.originalSwitcherCommand = {
        id: originalCmd.id,
        name: originalCmd.name,
        icon: originalCmd.icon,
        hotkeys: originalCmd.hotkeys ? [...originalCmd.hotkeys] : [],
        callback: originalCmd.callback
      };
    }

    // Remove the original command completely to avoid conflicts
    if (commands['switcher:open']) {
      delete commands['switcher:open'];
    }

    // Add our own command with the same ID
    this.plugin.addCommand({
      id: 'switcher:open',
      name: 'Quick Switcher',
      hotkeys: [{ modifiers: ["Mod"], key: "o" }],
      callback: () => {
        if (this.plugin.settings.enableForQuickSwitcher) {
          // Use our custom modal when enabled
          // Close any existing modals first
          const existingModals = document.querySelectorAll('.modal');
          existingModals.forEach(modal => {
            if (modal instanceof HTMLElement && modal.style.display !== 'none') {
              modal.style.display = 'none';
            }
          });
          import('../ui/QuickSwitchModal').then(({ QuickSwitchModal }) => {
            new QuickSwitchModal(this.plugin.app, this.plugin).open();
          });
        } else {
          // Use the original Obsidian Quick Switcher when disabled
          if (this.originalSwitcherCommand && this.originalSwitcherCommand.callback) {
            this.originalSwitcherCommand.callback();
          } else {
            // Fallback: try to open the default switcher
            (this.plugin.app as any).commands.executeCommandById('switcher:open');
          }
        }
      }
    });

    this.isCommandOverridden = true;
  }

  restoreOriginalCommand() {
    if (!this.originalSwitcherCommand) {
      return;
    }

    // Remove our command
    const commands = (this.plugin.app as unknown as AppInternal).commands.commands;
    if (commands['switcher:open']) {
      delete commands['switcher:open'];
    }

    // Restore the original command
    (commands as any)['switcher:open'] = {
      id: this.originalSwitcherCommand.id,
      name: this.originalSwitcherCommand.name,
      icon: this.originalSwitcherCommand.icon,
      hotkeys: this.originalSwitcherCommand.hotkeys,
      callback: this.originalSwitcherCommand.callback
    };

    this.isCommandOverridden = false;
  }
}
