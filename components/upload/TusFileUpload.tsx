'use client';

import React, { useState } from 'react';
import { CloudUpload, X, Play, ListX, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useTusFileUpload } from '@/hooks/upload/useTusFileUpload';
import { formatFileSize } from '@/lib/upload/utils/tus-file-utils';
import { TUS_CLIENT_CONFIG } from '@/lib/upload/config/tus-upload-config';

export default function TusFileUpload() {
  const [isDragOver, setIsDragOver] = useState(false);
  
  const {
    fileQueue,
    uploading,
    handleFileSelection,
    startUpload,
    removeFile,
    clearCompleted,
    clearPending
  } = useTusFileUpload();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelection(files);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only set to false if we're leaving the dropzone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleFileInput = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) handleFileSelection(files);
    };
    input.click();
  };

  return (
    <Card className="w-full max-w-2xl rounded-3xl">
      <CardHeader>
        <CardTitle className="text-xl">Upload Files</CardTitle>
        <CardDescription>
          Resumable parallel uploads with TUS and NextJS.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Drop Zone */}
        <div
          className={`flex flex-col items-center gap-2 bg-neutral-700/10 border-2 border-dashed rounded-xl p-8 transition-colors cursor-pointer ${
            isDragOver
              ? 'border-violet-500/50 bg-violet-500/10'
              : 'hover:border-neutral-500/50 hover:bg-neutral-500/10 active:border-violet-500/50 active:bg-violet-500/10'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onClick={handleFileInput}
        >
          <CloudUpload className="size-10 text-muted-foreground" />
          <p className="font-medium">
            {uploading ? "Add more files while uploading" : "Drop files here or click to browse"}
          </p>
          <p className="text-sm text-muted-foreground">
            Maximum {TUS_CLIENT_CONFIG.maxFileSelection} files
            {uploading && fileQueue.length > 0 && ` (${fileQueue.length} in queue)`}
          </p>
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          <Button
            onClick={startUpload}
            className="bg-violet-600 text-foreground hover:bg-violet-500 cursor-pointer"
            disabled={uploading || fileQueue.filter(f => f.status === 'pending').length === 0}
            size="sm"
          >
            <Play className="h-4 w-4 mr-1" />
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
          <Button
            variant="outline"
            onClick={clearCompleted}
            disabled={fileQueue.filter(f => f.status === 'completed' || f.status === 'error').length === 0}
            size="sm"
            className="cursor-pointer"
          >
            <ListX className="h-4 w-4 mr-1" />
            Clear Completed
          </Button>
          <Button
            variant="outline"
            onClick={clearPending}
            disabled={fileQueue.filter(f => f.status === 'pending').length === 0}
            size="sm"
            className="cursor-pointer"
          >
            <ListX className="h-4 w-4 mr-1" />
            Clear Pending
          </Button>
        </div>

        {/* File List */}
        {fileQueue.length > 0 && (
          <div className="flex flex-col gap-2 bg-neutral-950 border p-3 rounded-xl h-120 overflow-auto">
            {fileQueue.map((file) => (
              <div key={file.id} className="flex items-center gap-3 py-3 px-4 border rounded-lg bg-neutral-900">
                <div className="flex-1 min-w-0">
                  {file.status === 'pending' && (
                    <div className="flex items-center justify-between">
                      {/* File Details */}
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium truncate">
                          {file.name}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {formatFileSize(file.size)}
                        </span>
                      </div>

                      {/* Cancel Button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeFile(file.id)}
                        className="h-6 w-6 p-0 cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  
                  {file.status === 'uploading' && (
                    <div className="flex flex-col gap-2">
                      {/* File Details */}
                      <span className="h-5 flex items-center gap-3 text-sm font-medium text-foreground">
                        {file.name}
                      </span>

                      {/* Progress Bar */}
                      <Progress value={file.progress} className="h-1 [&>div]:bg-violet-500" />

                      {/* Progress Data */}
                      <p className="h-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        {file.uploadedBytes !== undefined ? (
                          <span>{formatFileSize(file.uploadedBytes)} of {formatFileSize(file.size)}</span>
                        ) : (
                          <span>{formatFileSize(file.size)}</span>
                        )}
                        <span>{file.progress.toFixed(1)}%</span>
                      </p>
                    </div>
                  )}
                  
                  {file.status === 'error' && file.error && (
                    <p className="text-xs text-red-600">{file.error}</p>
                  )}
                  
                  {file.status === 'completed' && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold truncate text-green-600">
                        {file.name}
                      </span>
                      <span className="flex items-center text-sm text-green-600 gap-2">
                        <p>Completed</p>
                        <Check />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}