import { TFile } from 'obsidian';
import { CachedFileData } from '../types';

export function fuzzyMatch(str: string, query: string): boolean {
  let i = 0;
  const lowerStr = str.toLowerCase();
  const lowerQuery = query.toLowerCase();
  for (const char of lowerQuery) {
    i = lowerStr.indexOf(char, i) + 1;
    if (i === 0) return false;
  }
  return true;
}

export function getMatchScore(display: string, query: string, basename: string, includeFilenameInSearch: boolean): number {
  let score = 0;
  const lowerDisplay = display.toLowerCase();
  const lowerBasename = basename.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // Exact matches get highest score
  if (lowerDisplay === lowerQuery) score += 1000;
  else if (lowerBasename === lowerQuery) score += 900;
  
  // Starts with query gets high score
  else if (lowerDisplay.startsWith(lowerQuery)) score += 100;
  else if (includeFilenameInSearch && lowerBasename.startsWith(lowerQuery)) score += 80;
  
  // Contains query gets medium score
  else if (lowerDisplay.includes(lowerQuery)) score += 50;
  else if (includeFilenameInSearch && lowerBasename.includes(lowerQuery)) score += 30;
  
  // Word boundary matches get bonus
  const wordBoundaryRegex = new RegExp(`\\b${lowerQuery}`, 'i');
  if (wordBoundaryRegex.test(lowerDisplay)) score += 20;
  if (includeFilenameInSearch && wordBoundaryRegex.test(lowerBasename)) score += 15;
  
  // Penalty for very long names
  const lengthPenalty = Math.max(0, (display.length - query.length) * 0.1);
  score -= lengthPenalty;
  
  return Math.max(0, score);
}

export function buildFileCache(
  files: TFile[], 
  metadataCache: any, 
  propertyKey: string
): Map<string, CachedFileData> {
  const cache = new Map<string, CachedFileData>();
  
  files.forEach((file) => {
    const fileCache = metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter;
    let displayName = file.basename;
    let isCustomDisplay = false;
    let aliases: string[] = [];

    if (frontmatter && frontmatter[propertyKey] !== undefined && frontmatter[propertyKey] !== null) {
      const propertyValue = String(frontmatter[propertyKey]).trim();
      if (propertyValue !== '') {
        displayName = propertyValue;
        isCustomDisplay = true;
      }
    }

    if (frontmatter?.aliases) {
      aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [frontmatter.aliases];
      aliases = aliases.map(alias => String(alias).trim()).filter(alias => alias !== '');
    }

    cache.set(file.path, {
      file,
      displayName,
      aliases,
      lastModified: file.stat.mtime,
      isCustomDisplay
    });
  });
  
  return cache;
}
