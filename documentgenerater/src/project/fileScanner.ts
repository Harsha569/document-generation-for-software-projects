/**
 * Live AI Project Docs - File Scanner
 * 
 * Scans project files and directories, respecting exclusion patterns.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../config';
import { FileInfo } from '../types';

// Language detection by file extension
const LANGUAGE_MAP: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.py': 'python',
    '.java': 'java',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'cpp',
    '.hpp': 'cpp',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.json': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.sql': 'sql',
    '.sh': 'shell',
    '.bash': 'shell',
    '.ps1': 'powershell',
    '.dockerfile': 'dockerfile',
    '.r': 'r',
    '.lua': 'lua',
    '.dart': 'dart',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.erl': 'erlang',
    '.hs': 'haskell',
    '.clj': 'clojure',
    '.fs': 'fsharp',
    '.ml': 'ocaml',
    '.nim': 'nim',
    '.zig': 'zig',
    '.v': 'vlang',
};

export interface ScanResult {
    files: FileInfo[];
    languages: string[];
    totalSize: number;
    fileCount: number;
}

export interface ScanProgress {
    scanned: number;
    total: number;
    currentFile: string;
}

/**
 * Get language from file extension
 */
export function getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return LANGUAGE_MAP[ext] || 'unknown';
}

/**
 * Check if a path matches any of the exclude patterns
 */
function matchesExcludePattern(relativePath: string, patterns: string[]): boolean {
    // Simple glob matching - check common patterns
    for (const pattern of patterns) {
        // Handle **/ prefix
        const cleanPattern = pattern.replace(/^\*\*\//, '');

        // Check if path contains the pattern
        if (pattern.includes('**/')) {
            const parts = cleanPattern.split('**/');
            for (const part of parts) {
                if (part && relativePath.includes(part.replace(/\*+/g, ''))) {
                    return true;
                }
            }
            // Check for common directory exclusions
            if (relativePath.includes('node_modules') ||
                relativePath.includes('.git') ||
                relativePath.includes('dist/') ||
                relativePath.includes('build/') ||
                relativePath.includes('venv/') ||
                relativePath.includes('.venv') ||
                relativePath.includes('env/') ||
                relativePath.includes('site-packages') ||
                relativePath.includes('__pycache__') ||
                relativePath.includes('.env')) {
                return true;
            }
        }

        // Check for exact matches or wildcards
        if (pattern.startsWith('*.')) {
            const ext = pattern.slice(1);
            if (relativePath.endsWith(ext)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Scan files in a directory recursively
 */
async function scanDirectory(
    dirPath: string,
    rootPath: string,
    patterns: string[],
    files: FileInfo[],
    onProgress?: (progress: ScanProgress) => void,
    scannedCount: { value: number } = { value: 0 }
): Promise<void> {
    let entries: fs.Dirent[];

    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
        // Skip directories we can't read
        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        // Skip excluded patterns
        if (matchesExcludePattern(relativePath, patterns)) {
            continue;
        }

        if (entry.isDirectory()) {
            await scanDirectory(fullPath, rootPath, patterns, files, onProgress, scannedCount);
        } else if (entry.isFile()) {
            try {
                const stats = fs.statSync(fullPath);
                const language = getLanguageFromPath(fullPath);

                // Skip binary and very large files
                if (stats.size > 1024 * 1024) { // Skip files > 1MB
                    continue;
                }

                files.push({
                    path: fullPath,
                    relativePath: relativePath.replace(/\\/g, '/'),
                    size: stats.size,
                    language,
                    lastModified: stats.mtimeMs
                });

                scannedCount.value++;

                if (onProgress && scannedCount.value % 100 === 0) {
                    onProgress({
                        scanned: scannedCount.value,
                        total: -1, // Unknown total
                        currentFile: relativePath
                    });
                }
            } catch {
                // Skip files we can't stat
            }
        }
    }
}

/**
 * Scan a workspace folder
 */
export async function scanWorkspace(
    workspaceFolder: vscode.WorkspaceFolder,
    onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
    const config = getConfig();
    const rootPath = workspaceFolder.uri.fsPath;
    const files: FileInfo[] = [];

    await scanDirectory(rootPath, rootPath, config.excludePatterns, files, onProgress);

    // Collect unique languages
    const languageSet = new Set<string>();
    let totalSize = 0;

    for (const file of files) {
        if (file.language !== 'unknown') {
            languageSet.add(file.language);
        }
        totalSize += file.size;
    }

    return {
        files,
        languages: Array.from(languageSet),
        totalSize,
        fileCount: files.length
    };
}

/**
 * Get the content of a file
 */
export async function getFileContent(filePath: string): Promise<string | null> {
    try {
        const document = await vscode.workspace.openTextDocument(filePath);
        return document.getText();
    } catch {
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch {
            return null;
        }
    }
}

/**
 * Quick scan to get file count estimate
 */
export function estimateFileCount(workspaceFolder: vscode.WorkspaceFolder): number {
    // This is a rough estimate for progress indication
    const rootPath = workspaceFolder.uri.fsPath;
    try {
        const entries = fs.readdirSync(rootPath, { withFileTypes: true });
        const fileCount = entries.filter(e => e.isFile()).length;
        const dirCount = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').length;
        // Rough estimate: each directory has ~10 files on average
        return fileCount + dirCount * 10;
    } catch {
        return 100; // Default estimate
    }
}
