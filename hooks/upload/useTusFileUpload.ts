'use client';

import { useState, useRef, useCallback } from 'react';
import * as tus from 'tus-js-client';
import { TUS_CLIENT_CONFIG } from '@/lib/upload/config/tus-upload-config';
import { QueuedFile } from '@/lib/upload/types/upload-types';
import { generateId, getPartCount, findOptimalBatch, formatFileSize, FileWithParts } from '@/lib/upload/utils/tus-file-utils';

export const useTusFileUpload = () => {
  // SINGLE SOURCE OF TRUTH - Only one state for files
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  
  // Simple refs for upload management
  const activeUploadsRef = useRef<Map<string, tus.Upload>>(new Map());
  const fileQueueRef = useRef<QueuedFile[]>([]);
  
  // Keep ref in sync with state
  fileQueueRef.current = fileQueue;

  // UNIFIED STATUS UPDATE - Simplified with single responsibility
  const updateFileStatus = useCallback((fileId: string, updates: Partial<QueuedFile>) => {
    setFileQueue(prev => prev.map(file => 
      file.id === fileId ? { ...file, ...updates } : file
    ));
  }, []);

  // Handle file selection
  const handleFileSelection = useCallback((files: FileList | null) => {
    if (!files) return;
    
    let fileArray = Array.from(files);
    
    // Check if adding these files would exceed the max selection limit
    const currentFileCount = fileQueue.length;
    const totalFiles = currentFileCount + fileArray.length;
    
    if (totalFiles > TUS_CLIENT_CONFIG.maxFileSelection) {
      const remainingSlots = TUS_CLIENT_CONFIG.maxFileSelection - currentFileCount;
      if (remainingSlots <= 0) {
        setMessage(`Maximum ${TUS_CLIENT_CONFIG.maxFileSelection} files allowed. Remove some files first.`);
        return;
      }
      setMessage(`Only ${remainingSlots} more files can be added (${TUS_CLIENT_CONFIG.maxFileSelection} max).`);
      fileArray = fileArray.slice(0, remainingSlots);
    } else {
      setMessage('');
    }
    
    const queuedFiles: QueuedFile[] = fileArray.map(file => ({
      id: generateId(),
      file: file,
      status: 'pending' as const,
      progress: 0,
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedBytes: 0
    }));
    
    // Append new files to existing queue instead of replacing
    setFileQueue(prev => [...prev, ...queuedFiles]);
  }, [fileQueue.length]);

  // COMPLETE FILE UPLOAD - Upload entire file as single unit
  const uploadFileComplete = useCallback((queuedFile: QueuedFile): Promise<void> => {
    return new Promise((resolve, reject) => {
      const file = queuedFile.file;
      
      console.log(`Uploading complete file: ${file.name} (${formatFileSize(file.size)})`);
      
      const upload = new tus.Upload(file, {
        endpoint: TUS_CLIENT_CONFIG.endpoint,
        chunkSize: TUS_CLIENT_CONFIG.chunkSize,
        retryDelays: TUS_CLIENT_CONFIG.retryDelays,
        metadata: {
          filename: file.name,
          filetype: file.type,
          // No multipart metadata for complete file uploads
          withFilename: TUS_CLIENT_CONFIG.withFilename,
          onDuplicate: TUS_CLIENT_CONFIG.onDuplicate,
          destinationPath: TUS_CLIENT_CONFIG.destinationPath
        },
        onError: reject,
        onProgress: (bytesUploaded, bytesTotal) => {
          const progress = (bytesUploaded / bytesTotal) * 100;
          updateFileStatus(queuedFile.id, {
            progress: Math.min(progress, 99),
            uploadedBytes: bytesUploaded
          });
        },
        onSuccess: () => {
          updateFileStatus(queuedFile.id, { status: 'completed', progress: 100 });
          resolve();
        },
      });

      // Store upload reference for potential cancellation
      activeUploadsRef.current.set(queuedFile.id, upload);
      
      upload.start();
    });
  }, [updateFileStatus]);

  // MULTIPART UPLOAD - Split file into parts and upload in parallel
  const uploadFileMultipart = useCallback((queuedFile: QueuedFile): Promise<void> => {
    return new Promise((resolve, reject) => {
      const file = queuedFile.file;
      const totalParts = getPartCount(file.size);
      const multipartId = generateId();
      const partSize = Math.ceil(file.size / totalParts);
      
      console.log(`Uploading ${file.name} (${formatFileSize(file.size)}) in ${totalParts} parts`);
      
      // Track bytes uploaded per part for accurate progress
      const partBytesUploaded = new Array(totalParts).fill(0);
      let completedParts = 0;
      let hasError = false;
      
      // Progress update function
      const updateProgress = () => {
        const totalBytesUploaded = partBytesUploaded.reduce((sum, bytes) => sum + bytes, 0);
        const progress = (totalBytesUploaded / file.size) * 100;
        updateFileStatus(queuedFile.id, {
          progress: Math.min(progress, 99),
          uploadedBytes: totalBytesUploaded
        });
      };
      
      // Upload all parts in parallel
      const partUploads = Array.from({ length: totalParts }, (_, i) =>
        uploadPart(queuedFile, i, partSize, multipartId, totalParts, (bytesUploaded) => {
          partBytesUploaded[i] = bytesUploaded;
          updateProgress();
        })
      );
      
      // Handle part completions
      partUploads.forEach((uploadPromise, index) => {
        uploadPromise
          .then(() => {
            if (hasError) return;
            
            completedParts++;
            
            // Check if all parts completed
            if (completedParts === totalParts) {
              updateFileStatus(queuedFile.id, { status: 'completed', progress: 100 });
              resolve();
            }
          })
          .catch((error) => {
            if (!hasError) {
              hasError = true;
              reject(error);
            }
          });
      });
    });
  }, [updateFileStatus]);


  // Start upload process with dynamic stream-based batching
  const startUpload = useCallback(() => {
    if (!uploading && fileQueue.length > 0) {
      processQueueDynamic();
    }
  }, [uploading, fileQueue]);

  // Process the queue with dynamic stream-based batching and continuous monitoring
  const processQueueDynamic = useCallback(async () => {
    setUploading(true);
    
    while (true) {
      // Continuously check for pending files (including newly added ones)
      const remainingFiles = fileQueueRef.current
        .filter(f => f.status === 'pending')
        .map(file => ({
          id: file.id,
          name: file.name,
          size: file.size,
          parts: getPartCount(file.size)
        }));
      
      // If no pending files, exit the loop
      if (remainingFiles.length === 0) {
        break;
      }
      
      // Find optimal batch using knapsack algorithm
      const batch = findOptimalBatch(remainingFiles, TUS_CLIENT_CONFIG.maxStreamCount);
      
      if (batch.length === 0) {
        // If no valid batch found, take the first file
        batch.push(remainingFiles[0]);
      }
      
      const totalStreams = batch.reduce((sum, file) => sum + file.parts, 0);
      setMessage(`Uploading ${batch.length} files (${totalStreams} streams)...`);
      
      // Start all files in batch simultaneously
      const batchPromises = batch.map(async (fileInfo) => {
        const queuedFile = fileQueueRef.current.find(f => f.id === fileInfo.id);
        if (!queuedFile || queuedFile.status !== 'pending') {
          return; // Skip if file was removed or status changed
        }
        
        try {
          updateFileStatus(queuedFile.id, { status: 'uploading', progress: 0 });
          
          if (fileInfo.parts === 1) {
            // Single part - upload complete file
            await uploadFileComplete(queuedFile);
          } else {
            // Multiple parts - upload with multipart logic
            await uploadFileMultipart(queuedFile);
          }
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          updateFileStatus(queuedFile.id, {
            status: 'error',
            progress: 0,
            error: errorMessage
          });
        }
      });
      
      // Wait for all files in batch to complete
      await Promise.allSettled(batchPromises);
      
      // Small delay to prevent tight loop and allow UI updates
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    setUploading(false);
    setMessage('All files processed.');
  }, [updateFileStatus, uploadFileComplete, uploadFileMultipart]);

  // SIMPLIFIED PART UPLOAD - Clean, focused responsibility
  const uploadPart = useCallback((
    queuedFile: QueuedFile,
    partIndex: number,
    partSize: number,
    multipartId: string,
    totalParts: number,
    onProgressUpdate: (bytesUploaded: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const file = queuedFile.file;
      const start = partIndex * partSize;
      const end = Math.min(start + partSize, file.size);
      const partBlob = file.slice(start, end);
      const partNumber = partIndex + 1;

      const upload = new tus.Upload(partBlob, {
        endpoint: TUS_CLIENT_CONFIG.endpoint,
        chunkSize: TUS_CLIENT_CONFIG.chunkSize,
        retryDelays: TUS_CLIENT_CONFIG.retryDelays,
        metadata: {
          filename: file.name,
          filetype: file.type,
          multipartId: multipartId,
          partIndex: partNumber.toString(),
          totalParts: totalParts.toString(),
          originalFileSize: file.size.toString(),
          withFilename: TUS_CLIENT_CONFIG.withFilename,
          onDuplicate: TUS_CLIENT_CONFIG.onDuplicate,
          destinationPath: TUS_CLIENT_CONFIG.destinationPath
        },
        onError: reject,
        onProgress: (bytesUploaded, bytesTotal) => {
          // Report actual bytes uploaded for this part
          onProgressUpdate(bytesUploaded);
        },
        onSuccess: () => resolve(),
      });

      // Store upload reference for potential cancellation
      activeUploadsRef.current.set(`${queuedFile.id}-${partIndex}`, upload);
      
      upload.start();
    });
  }, []);

  // Remove file from queue
  const removeFile = useCallback((fileId: string) => {
    // Cancel any active uploads for this file
    activeUploadsRef.current.forEach((upload, key) => {
      if (key.startsWith(fileId)) {
        upload.abort();
        activeUploadsRef.current.delete(key);
      }
    });
    
    setFileQueue(prev => prev.filter(f => f.id !== fileId));
  }, []);

  // Clear all files
  const clearQueue = useCallback(() => {
    // Cancel all active uploads
    activeUploadsRef.current.forEach(upload => upload.abort());
    activeUploadsRef.current.clear();
    
    setFileQueue([]);
    setMessage('');
  }, []);

  // Clear completed and errored files
  const clearCompleted = useCallback(() => {
    setFileQueue(prev => prev.filter(f => f.status !== 'completed' && f.status !== 'error'));
  }, []);

  // Clear pending files only
  const clearPending = useCallback(() => {
    setFileQueue(prev => prev.filter(f => f.status !== 'pending'));
  }, []);

  return {
    fileQueue,
    uploading,
    message,
    handleFileSelection,
    startUpload,
    removeFile,
    clearCompleted,
    clearPending
  };
};