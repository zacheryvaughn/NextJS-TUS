import fs from 'fs';
import path from 'path';
import { TUS_SERVER_CONFIG } from '../config/tus-upload-config';

// Utility functions
export const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Normalize destination path - handles various input formats
export const normalizeDestinationPath = (destinationPath?: string): string => {
  if (!destinationPath) return '';
  
  // Remove leading/trailing slashes and normalize
  let normalized = destinationPath.trim().replace(/^\/+|\/+$/g, '');
  
  // Ensure it ends with a slash if not empty
  if (normalized && !normalized.endsWith('/')) {
    normalized += '/';
  }
  
  return normalized;
};

// Get full destination directory path
export const getDestinationDir = (destinationPath?: string): string => {
  const normalized = normalizeDestinationPath(destinationPath);
  return path.join(TUS_SERVER_CONFIG.mountPath, normalized);
};

// Get full file path with destination
export const getFullFilePath = (filename: string, destinationPath?: string): string => {
  const destinationDir = getDestinationDir(destinationPath);
  return path.join(destinationDir, filename);
};

export const parseMetadata = (header: string | null): Record<string, string> => {
  if (!header) return {};
  return Object.fromEntries(
    header.split(",")
      .map(item => item.split(" "))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, Buffer.from(value, "base64").toString("utf8")])
  );
};

export const getUniqueFilename = (filename: string, dir: string): string => {
  // Ensure the directory exists before checking for files
  ensureDir(dir);
  
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let i = 1, candidate = filename;
  
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}(${i++})${ext}`;
  }
  return candidate;
};

export const moveFile = (from: string, to: string, jsonPath: string, keepJson = false): boolean => {
  // Ensure destination directory exists
  const destinationDir = path.dirname(to);
  ensureDir(destinationDir);
  
  if (!moveFileWithFallback(from, to)) return false;
  return handleJsonFile(jsonPath, to, keepJson);
};

const moveFileWithFallback = (from: string, to: string): boolean => {
  try {
    fs.renameSync(from, to);
    return true;
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EXDEV') {
      try {
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
        return true;
      } catch (copyError: unknown) {
        const copyErr = copyError as Error;
        console.error(`Copy failed: ${copyErr.message}`);
        return false;
      }
    } else {
      const moveErr = error as Error;
      console.error(`Move failed: ${moveErr.message}`);
      return false;
    }
  }
};

const handleJsonFile = (jsonPath: string, destinationPath: string, keepJson: boolean): boolean => {
  try {
    if (!fs.existsSync(jsonPath)) return true;
    
    if (keepJson) {
      const jsonDestination = `${destinationPath}.json`;
      return moveFileWithFallback(jsonPath, jsonDestination);
    } else {
      fs.unlinkSync(jsonPath);
      return true;
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`JSON file handling failed: ${err.message}`);
    return false;
  }
};

export const checkDuplicateFile = (filename: string, destinationPath?: string): boolean => {
  const filePath = getFullFilePath(filename, destinationPath);
  return fs.existsSync(filePath);
};