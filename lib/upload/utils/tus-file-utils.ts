import { TUS_SERVER_CONFIG } from '../config/tus-upload-config';

// Generate random ID for files and multipart uploads
export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
};

// Determine number of parts based on file size (dynamic logic)
export const getPartCount = (fileSize: number): number => {
  const MB = 1024 * 1024;
  
  if (fileSize <= 512 * MB) {
    return 1;
  } else if (fileSize > 4096 * MB) {
    return 8;
  } else {
    return Math.ceil(fileSize / (512 * MB));
  }
};

// File with part count for batch optimization
export interface FileWithParts {
  id: string;
  name: string;
  size: number;
  parts: number;
}

// Knapsack algorithm to find optimal batch of files that maximizes stream usage
export const findOptimalBatch = (files: FileWithParts[], maxStreams: number = 8): FileWithParts[] => {
  if (files.length === 0) return [];
  
  let bestBatch: FileWithParts[] = [];
  let bestTotal = 0;

  function backtrack(
    currentBatch: FileWithParts[],
    remainingFiles: FileWithParts[],
    currentTotal: number,
    startIndex: number = 0
  ) {
    // If current total exceeds max streams, this path is invalid
    if (currentTotal > maxStreams) return;

    // If this is better than our current best, update it
    if (currentTotal > bestTotal) {
      bestTotal = currentTotal;
      bestBatch = [...currentBatch];
    }

    // Try adding each remaining file
    for (let i = startIndex; i < remainingFiles.length; i++) {
      const file = remainingFiles[i];
      const newTotal = currentTotal + file.parts;
      
      // Only continue if we don't exceed the limit
      if (newTotal <= maxStreams) {
        backtrack(
          [...currentBatch, file],
          remainingFiles,
          newTotal,
          i + 1
        );
      }
    }
  }

  backtrack([], files, 0);
  return bestBatch;
};

// Sanitize filename for server use
export const sanitizeFilename = (filename: string): string => {
  return filename.replace(TUS_SERVER_CONFIG.filenameSanitizeRegex, "_");
};

// Format file size for display with proper units
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 bytes';
  
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  if (i === 0) {
    return `${bytes} ${units[i]}`;
  }
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
};

// Get status color for UI
export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'pending': return 'text-gray-500';
    case 'uploading': return 'text-blue-500';
    case 'completed': return 'text-green-500';
    case 'error': return 'text-red-500';
    default: return 'text-gray-500';
  }
};

// Get status icon for UI
export const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'pending': return '⏳';
    case 'uploading': return '⬆️';
    case 'completed': return '✅';
    case 'error': return '❌';
    default: return '⏳';
  }
};