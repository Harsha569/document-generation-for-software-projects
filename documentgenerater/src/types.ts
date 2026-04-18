/**
 * Live AI Project Docs - Type Definitions
 */

// Project connection and scanning types
export interface ProjectData {
  projectName: string;
  rootPath: string;
  files: FileInfo[];
  languages: string[];
}

export interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  language: string;
  lastModified: number;
}

export interface ProjectResponse {
  projectId: string;
  status: 'connected' | 'pending' | 'error';
  message?: string;
}

// File synchronization types
export type ChangeType = 'save' | 'create' | 'delete' | 'rename';

export interface FileUpdate {
  projectId: string;
  filePath: string;
  relativePath: string;
  content?: string;
  changeType: ChangeType;
  timestamp: number;
  oldPath?: string; // For rename operations
}

export interface FileUpdateBatch {
  projectId: string;
  updates: FileUpdate[];
  batchTimestamp: number;
}

// Documentation types
export interface Documentation {
  projectId: string;
  sections: DocSection[];
  lastUpdated: number;
  generationStatus: 'ready' | 'generating' | 'error';
}

export interface DocSection {
  id: string;
  title: string;
  type: 'overview' | 'architecture' | 'modules' | 'flow' | 'apis' | 'changelog' | 'custom';
  content: string;
  lastUpdated: number;
  affectedFiles?: string[];
}

// Timeline types
export interface TimelineEntry {
  id: string;
  date: string;
  time: string;
  filesChanged: string[];
  summary: string;
  affectedSection: string;
  changeType: ChangeType;
}

export interface Timeline {
  projectId: string;
  entries: TimelineEntry[];
}

// Q&A types
export interface Question {
  projectId: string;
  query: string;
  context?: string;
}

export interface Answer {
  response: string;
  sources: SourceReference[];
  confidence: number;
}

export interface SourceReference {
  filePath: string;
  lineRange?: [number, number];
  snippet?: string;
}

// Code explanation types
export interface ExplainRequest {
  projectId: string;
  code: string;
  filePath: string;
  language: string;
  type: 'file' | 'selection' | 'function';
}

export interface Explanation {
  summary: string;
  details: string;
  relatedDocs?: string[];
}

// Extension state types
export interface ExtensionState {
  isConnected: boolean;
  projectId?: string;
  projectName?: string;
  lastSync?: number;
  syncStatus: 'idle' | 'syncing' | 'error';
}

// API error types
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// WebView message types
export type WebViewMessageType = 
  | 'ready'
  | 'refresh'
  | 'navigate'
  | 'ask'
  | 'updateDocs'
  | 'updateTimeline'
  | 'updateStatus'
  | 'error';

export interface WebViewMessage {
  type: WebViewMessageType;
  payload?: unknown;
}

export interface DocsNavigatePayload {
  sectionId: string;
}

export interface AskPayload {
  question: string;
}
