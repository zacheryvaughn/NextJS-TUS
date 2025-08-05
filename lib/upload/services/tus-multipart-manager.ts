import fs from 'fs';
import path from 'path';
import { TUS_SERVER_CONFIG } from '../config/tus-upload-config';
import { MultipartAssembly, UploadMetadata } from '../types/upload-types';
import { getFinalFilename, usesOriginalFilename } from '../utils/tus-filename-utils';
import { moveFile, getFullFilePath } from './tus-file-operations';

export class TusMultipartManager {
  private assemblies = new Map<string, MultipartAssembly>();

  isMultipartUpload(metadata: Partial<UploadMetadata>): boolean {
    return !!(metadata.multipartId && metadata.partIndex && metadata.totalParts);
  }

  // SIMPLIFIED MULTIPART COMPLETION - Clear logic, single responsibility
  async handlePartCompletion(uploadId: string, metadata: Partial<UploadMetadata>): Promise<boolean> {
    const multipartId = metadata.multipartId!;
    const partIndex = parseInt(metadata.partIndex!);
    const totalParts = parseInt(metadata.totalParts!);
    
    console.log(`Processing part ${partIndex}/${totalParts} for ${metadata.filename}`);
    
    // Initialize or get assembly tracker
    if (!this.assemblies.has(multipartId)) {
      this.assemblies.set(multipartId, {
        parts: new Map(),
        totalParts: totalParts,
        metadata: metadata
      });
    }

    const assembly = this.assemblies.get(multipartId)!;
    assembly.parts.set(partIndex, uploadId);
    
    // Check if all parts are complete
    if (assembly.parts.size === assembly.totalParts) {
      console.log(`All parts received for ${multipartId}, assembling...`);
      
      try {
        await this.assembleFile(multipartId, assembly);
        this.assemblies.delete(multipartId);
        console.log(`File assembly complete: ${metadata.filename}`);
        return true;
      } catch (error) {
        console.error(`Assembly failed for ${multipartId}:`, error);
        this.assemblies.delete(multipartId);
        throw error;
      }
    }
    
    return false; // Still waiting for more parts
  }

  private async assembleFile(multipartId: string, assembly: MultipartAssembly): Promise<void> {
    const meta = assembly.metadata as Partial<UploadMetadata>;
    const firstPartId = assembly.parts.get(1)!;
    
    console.log(`🔧 Assembling ${assembly.totalParts} parts for ${meta.filename}`);
    
    try {
      // Use the first part as the base file
      const baseFilePath = path.join(TUS_SERVER_CONFIG.stagingDir, firstPartId);
      
      // Append all other parts in order
      for (let i = 2; i <= assembly.totalParts; i++) {
        const partId = assembly.parts.get(i)!;
        const partPath = path.join(TUS_SERVER_CONFIG.stagingDir, partId);
        
        console.log(`📎 Appending part ${i} to base file`);
        await this.appendPartToFile(baseFilePath, partPath);
        
        // Clean up the part file after appending
        this.cleanupPartFiles(partId);
      }
      
      // Update the metadata for the assembled file
      this.updateAssembledMetadata(firstPartId, meta);
      
      // Move the assembled file to final destination
      this.processAssembledFile({
        id: firstPartId,
        metadata: {
          filename: meta.filename || '',
          filetype: meta.filetype || '',
          withFilename: meta.withFilename || 'default',
          onDuplicate: meta.onDuplicate || 'prevent',
          destinationPath: meta.destinationPath
        }
      });
      
      console.log(`✅ Assembly complete for ${meta.filename}`);
      
    } catch (error) {
      console.error(`❌ Assembly failed for ${multipartId}:`, error);
      throw error;
    }
  }

  private async appendPartToFile(baseFilePath: string, partPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        // Read the part file and append to base file
        const partData = fs.readFileSync(partPath);
        fs.appendFileSync(baseFilePath, partData);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  private cleanupPartFiles(partId: string): void {
    const partPath = path.join(TUS_SERVER_CONFIG.stagingDir, partId);
    const jsonPath = path.join(TUS_SERVER_CONFIG.stagingDir, `${partId}.json`);
    
    try {
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
        console.log(`🗑️ Cleaned up part file: ${partId}`);
      }
      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
        console.log(`🗑️ Cleaned up part metadata: ${partId}.json`);
      }
    } catch (error) {
      console.error(`⚠️ Error cleaning up part ${partId}:`, error);
    }
  }

  private updateAssembledMetadata(fileId: string, meta: Partial<UploadMetadata>): void {
    const jsonPath = path.join(TUS_SERVER_CONFIG.stagingDir, `${fileId}.json`);
    
    try {
      const originalJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      
      const updatedMetadata = {
        id: fileId,
        metadata: {
          filename: meta.filename || '',
          filetype: meta.filetype || '',
          withFilename: meta.withFilename || 'default',
          onDuplicate: meta.onDuplicate || 'prevent',
          destinationPath: meta.destinationPath
        },
        size: parseInt(meta.originalFileSize || '0'),
        offset: parseInt(meta.originalFileSize || '0'), // Mark as fully uploaded
        creation_date: originalJson.creation_date
      };
      
      fs.writeFileSync(jsonPath, JSON.stringify(updatedMetadata, null, 2));
      console.log(`📝 Updated metadata for assembled file: ${fileId}`);
      
    } catch (error) {
      console.error(`❌ Error updating metadata for ${fileId}:`, error);
    }
  }

  private processAssembledFile(upload: { id: string; metadata: Partial<UploadMetadata> }): void {
    const meta = upload.metadata || {};
    const finalFilename = getFinalFilename(meta, upload.id);
    
    const stagingPath = path.join(TUS_SERVER_CONFIG.stagingDir, upload.id);
    const destinationPath = getFullFilePath(finalFilename, meta.destinationPath);
    const jsonPath = path.join(TUS_SERVER_CONFIG.stagingDir, `${upload.id}.json`);

    console.log(`📁 Moving assembled file to final destination: ${destinationPath}`);
    moveFile(stagingPath, destinationPath, jsonPath, !usesOriginalFilename(meta));
  }
}