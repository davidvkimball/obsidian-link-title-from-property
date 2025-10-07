# Property Over File Name Plugin

Enhances Obsidian's link suggester and Quick Switcher to use frontmatter properties (e.g., `title`) instead of file names for note titles, with optional file name and alias searching.

Particularly helpful when used in conjunction wth [Astro Composer](https://github.com/davidvkimball/obsidian-astro-composer) Obsidian Plugin and the [Astro Modular](https://github.com/davidvkimball/astro-modular) blog theme.

## Features
- Displays frontmatter property (e.g., `title`) in link suggester (`[[`) and Quick Switcher (`Ctrl+O`).
- Supports creating new notes via link suggester and Quick Switcher.
- Configurable to include file names and aliases in fuzzy searches.
- Fully local, no network requests, respects user privacy.

## Installation
1. Copy `main.js` and `manifest.json` to `<Vault>/.obsidian/plugins/property-over-filename/`.
2. In Obsidian, go to **Settings → Community plugins**, enable **Community plugins**, and toggle on **Property Over File Name**.

## Usage
- **Link Suggester**: Type `[[` to see suggestions based on the frontmatter `title` (or configured property). Select a note to insert a link (e.g., `[[file name|Title]]` or `[Title](path)` for Markdown links).
- **Quick Switcher**: Press `Ctrl+O` to search notes by title (or file name/aliases if enabled). Select to open or create a note.
- **Settings**:
  - Go to **Settings → Property Over File Name**.
  - **Property key**: Set the frontmatter property for titles (default: `title`).
  - **When linking notes**: Enable/disable property-based titles in link suggester.
  - **In Quick Switcher**: Enable/disable property-based titles in Quick Switcher.
  - **Include file name in fuzzy searches**: Include note file names in search results.
  - **Include aliases in fuzzy searches**: Include frontmatter `aliases` in search results.

### Example Note
```yaml
---
title: My Custom Title
aliases: [Alias1, Alias2]
---
Content...
```
- File name: `note.md`
- Link suggester shows `My Custom Title`; searchable by `My Custom Title`, `note` (if file name search enabled), or `Alias1`/`Alias2` (if alias search enabled).
- Quick Switcher shows `My Custom Title (note)` (if file name differs and search enabled).

## Development
- Build: `npm install && npm run build`
- Test: Copy `main.js` and `manifest.json` to plugin folder, reload Obsidian.
- Issues: Check console (`Ctrl+Shift+I`) for errors like `Error setting cursor`.

## License
MIT License
