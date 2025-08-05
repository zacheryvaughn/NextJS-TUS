// SIMPLIFIED TYPES - Single source of truth for file state
export interface QueuedFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  progress: number;
  error?: string;
  name: string;
  size: number;
  type: string;
  uploadedBytes?: number;
}

// Filename strategy types for extensibility
export type FilenameStrategy = 'default' | 'original' | string;

// Duplicate handling strategy types for extensibility
export type DuplicateStrategy = 'prevent' | 'number' | string;

// Parallel upload method types
export type ParallelMethod = 'multipart' | 'multifile';

export interface UploadMetadata {
  filename: string;
  filetype: string;
  multipartId?: string;
  partIndex?: string;
  totalParts?: string;
  originalFileSize?: string;
  withFilename: string;
  onDuplicate: string;
  destinationPath?: string;
}

export interface UploadInfo {
  id: string;
  size: number;
  offset: number;
  metadata: Partial<UploadMetadata>;
  creation_date: string;
}

export interface MultipartAssembly {
  parts: Map<number, string>;
  totalParts: number;
  metadata: Partial<UploadMetadata>;
}