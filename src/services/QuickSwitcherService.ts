import { AppInternal } from "../types";

export class QuickSwitcherService {
  private plugin: any;
  private originalSwitcherCommand?: any;
  private isCommandOverridden = false;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  updateQuickSwitcher() {
    // Only override the command if our Quick Switcher is enabled
    if (this.plugin.settings.enableForQuickSwitcher && !this.isCommandOverridden) {
      this.overrideQuickSwitcherCommand();
    } else if (!this.plugin.settings.enableForQuickSwitcher && this.isCommandOverridden) {
      // Restore original command when disabled
      this.restoreOriginalCommand();
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

    // Create our custom command object
    const customCommand = {
      id: 'switcher:open',
      name: 'Quick Switcher',
      icon: this.originalSwitcherCommand?.icon,
      hotkeys: [{ modifiers: ["Mod"], key: "o" }],
      callback: () => {
        // Prevent any default Quick Switcher from opening
        const workspace = this.plugin.app.workspace as any;
        if (workspace.switcher) {
          workspace.switcher.close();
        }
        
        // Use our custom modal when this command is active
        // Close any existing modals first
        const existingModals = document.querySelectorAll('.modal');
        existingModals.forEach(modal => {
          if (modal instanceof HTMLElement && modal.style.display !== 'none') {
            modal.style.display = 'none';
          }
        });
        
        try {
          import('../ui/QuickSwitchModal').then(({ QuickSwitchModal }) => {
            const modal = new QuickSwitchModal(this.plugin.app, this.plugin);
            modal.open();
          }).catch((error) => {
            console.error('Error loading QuickSwitchModal:', error);
            // Fallback to original command if our modal fails
            if (this.originalSwitcherCommand && this.originalSwitcherCommand.callback) {
              this.originalSwitcherCommand.callback();
            }
          });
        } catch (error) {
          console.error('Error creating QuickSwitchModal:', error);
          // Fallback to original command if our modal fails
          if (this.originalSwitcherCommand && this.originalSwitcherCommand.callback) {
            this.originalSwitcherCommand.callback();
          }
        }
      }
    };

    // Directly assign to the command registry instead of using addCommand
    commands['switcher:open'] = customCommand;

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
