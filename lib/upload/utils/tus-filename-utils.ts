import { UploadMetadata } from '../types/upload-types';
import { sanitizeFilename } from './tus-file-utils';
import { getUniqueFilename, getDestinationDir } from '../services/tus-file-operations';

// Extensible duplicate handling strategy handlers
type DuplicateHandler = (filename: string, directory: string) => string;

const duplicateStrategies: Record<string, DuplicateHandler> = {
  'prevent': (filename, _directory) => filename, // No modification, will be handled by validation
  'number': (filename, directory) => getUniqueFilename(filename, directory),
  // Future strategies can be easily added here:
  // 'timestamp': (filename, directory) => `${Date.now()}_${filename}`,
  // 'uuid': (filename, directory) => `${crypto.randomUUID()}_${filename}`,
  // 'overwrite': (filename, directory) => filename, // Allow overwrite
};

// Register a new duplicate handling strategy (for extensibility)
export function registerDuplicateStrategy(name: string, handler: DuplicateHandler): void {
  duplicateStrategies[name] = handler;
}

// Extensible filename strategy handlers
type FilenameHandler = (meta: Partial<UploadMetadata>, uploadId: string) => string;

const filenameStrategies: Record<string, FilenameHandler> = {
  'default': (meta, uploadId) => uploadId,
  'original': (meta, uploadId) => {
    if (!meta.filename) return uploadId;
    const sanitized = sanitizeFilename(meta.filename);
    const duplicateStrategy = meta.onDuplicate || 'prevent';
    const handler = duplicateStrategies[duplicateStrategy] || duplicateStrategies['prevent'];
    const destinationDir = getDestinationDir(meta.destinationPath);
    return handler(sanitized, destinationDir);
  }
  // Future strategies can be easily added here:
  // 'supabase-id': (meta, uploadId) => `${meta.supabaseRowId}_${meta.filename}`,
  // 'timestamp': (meta, uploadId) => `${Date.now()}_${meta.filename}`,
  // 'custom': (meta, uploadId) => meta.customFilename || uploadId,
};

// Register a new filename strategy (for extensibility)
export function registerFilenameStrategy(name: string, handler: FilenameHandler): void {
  filenameStrategies[name] = handler;
}

// Helper function to determine final filename using strategy pattern
export function getFinalFilename(meta: Partial<UploadMetadata>, uploadId: string): string {
  const strategy = meta.withFilename || 'default';
  const handler = filenameStrategies[strategy] || filenameStrategies['default'];
  return handler(meta, uploadId);
}

// Helper function to check if strategy uses original filename
export function usesOriginalFilename(meta: Partial<UploadMetadata>): boolean {
  const strategy = meta.withFilename || 'default';
  return strategy === 'original' && !!meta.filename;
}

// Legacy compatibility (deprecated)
export function shouldUseOriginalFilename(meta: Partial<UploadMetadata>): boolean {
  return usesOriginalFilename(meta);
}