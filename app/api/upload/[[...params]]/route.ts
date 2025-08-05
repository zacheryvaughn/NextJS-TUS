import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TUS_SERVER_CONFIG } from '@/lib/upload/config/tus-upload-config';
import { UploadInfo, UploadMetadata } from '@/lib/upload/types/upload-types';
import { sanitizeFilename } from '@/lib/upload/utils/tus-file-utils';
import { getFinalFilename, usesOriginalFilename } from '@/lib/upload/utils/tus-filename-utils';
import {
  ensureDir,
  parseMetadata,
  moveFile,
  checkDuplicateFile,
  getFullFilePath
} from '@/lib/upload/services/tus-file-operations';
import { TusMultipartManager } from '@/lib/upload/services/tus-multipart-manager';

// Initialize directories
ensureDir(TUS_SERVER_CONFIG.stagingDir);
ensureDir(TUS_SERVER_CONFIG.mountPath);

// Initialize TUS multipart manager
const tusMultipartManager = new TusMultipartManager();

// Handle POST requests (create upload)
export async function POST(req: NextRequest) {
  try {
    const uploadLength = req.headers.get('upload-length');
    const uploadMetadata = req.headers.get('upload-metadata');
    
    if (!uploadLength) {
      return NextResponse.json({ error: 'Missing Upload-Length header' }, { status: 400 });
    }

    const metadata = parseMetadata(uploadMetadata) as Partial<UploadMetadata>;
    
    // Check for duplicate files
    if (metadata.withFilename === "original" &&
        metadata.filename &&
        metadata.onDuplicate === "prevent") {
      if (checkDuplicateFile(sanitizeFilename(metadata.filename), metadata.destinationPath)) {
        return NextResponse.json(
          { error: { message: `File "${metadata.filename}" already exists and duplicates are not allowed` } },
          { status: 409 }
        );
      }
    }

    const uploadId = uuidv4();
    const filePath = path.join(TUS_SERVER_CONFIG.stagingDir, uploadId);
    const metadataPath = path.join(TUS_SERVER_CONFIG.stagingDir, `${uploadId}.json`);

    // Create empty file
    fs.writeFileSync(filePath, '');

    // Save metadata
    const uploadInfo: UploadInfo = {
      id: uploadId,
      size: parseInt(uploadLength),
      offset: 0,
      metadata: metadata,
      creation_date: new Date().toISOString()
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(uploadInfo, null, 2));

    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const location = `${protocol}://${host}/api/upload/${uploadId}`;

    return new NextResponse(null, {
      status: 201,
      headers: {
        'Location': location,
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0'
      }
    });

  } catch (error) {
    console.error('POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle PATCH requests (upload data)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ params: string[] }> }) {
  try {
    const resolvedParams = await params;
    const uploadId = resolvedParams.params?.[0];
    if (!uploadId) {
      return NextResponse.json({ error: 'Missing upload ID' }, { status: 400 });
    }

    const uploadOffset = req.headers.get('upload-offset');
    const contentType = req.headers.get('content-type');
    
    if (!uploadOffset) {
      return NextResponse.json({ error: 'Missing Upload-Offset header' }, { status: 400 });
    }

    if (contentType !== 'application/offset+octet-stream') {
      return NextResponse.json({ error: 'Invalid Content-Type' }, { status: 400 });
    }

    const filePath = path.join(TUS_SERVER_CONFIG.stagingDir, uploadId);
    const metadataPath = path.join(TUS_SERVER_CONFIG.stagingDir, `${uploadId}.json`);

    if (!fs.existsSync(metadataPath)) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const uploadInfo: UploadInfo = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const offset = parseInt(uploadOffset);

    if (offset !== uploadInfo.offset) {
      return NextResponse.json({ error: 'Offset mismatch' }, { status: 409 });
    }

    // Read request body
    const body = await req.arrayBuffer();
    const buffer = Buffer.from(body);

    // Append data to file
    const fd = fs.openSync(filePath, 'a');
    fs.writeSync(fd, buffer, 0, buffer.length, offset);
    fs.closeSync(fd);

    // Update metadata
    uploadInfo.offset += buffer.length;
    fs.writeFileSync(metadataPath, JSON.stringify(uploadInfo, null, 2));

    // SIMPLIFIED COMPLETION CHECK - Clear, single responsibility
    const isPartComplete = uploadInfo.offset >= uploadInfo.size;
    
    if (isPartComplete) {
      console.log(`Part ${uploadId} completed, processing...`);
      const isFileComplete = await handleUploadComplete(uploadId, uploadInfo);
      
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': uploadInfo.offset.toString(),
          ...(isFileComplete && { 'Upload-Complete': 'true' })
        }
      });
    }

    // Part not complete yet
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': uploadInfo.offset.toString()
      }
    });

  } catch (error) {
    console.error('PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle HEAD requests (get upload info)
export async function HEAD(req: NextRequest, { params }: { params: Promise<{ params: string[] }> }) {
  try {
    const resolvedParams = await params;
    const uploadId = resolvedParams.params?.[0];
    if (!uploadId) {
      return new NextResponse(null, { status: 400 });
    }

    const metadataPath = path.join(TUS_SERVER_CONFIG.stagingDir, `${uploadId}.json`);

    if (!fs.existsSync(metadataPath)) {
      return new NextResponse(null, { status: 404 });
    }

    const uploadInfo: UploadInfo = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': uploadInfo.offset.toString(),
        'Upload-Length': uploadInfo.size.toString(),
        'Cache-Control': 'no-store'
      }
    });

  } catch (error) {
    console.error('HEAD error:', error);
    return new NextResponse(null, { status: 500 });
  }
}

// Handle OPTIONS requests (CORS and capabilities)
export async function OPTIONS(_req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Tus-Resumable': '1.0.0',
      'Tus-Version': '1.0.0',
      'Tus-Extension': 'creation,termination',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,PATCH,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'Tus-Resumable,Upload-Length,Upload-Offset,Upload-Metadata,Content-Type',
      'Access-Control-Expose-Headers': 'Tus-Resumable,Upload-Offset,Location,Upload-Complete'
    }
  });
}

// SIMPLIFIED UPLOAD COMPLETION HANDLER - Single responsibility, clear logic
async function handleUploadComplete(uploadId: string, uploadInfo: UploadInfo): Promise<boolean> {
  const meta = uploadInfo.metadata || {} as Partial<UploadMetadata>;
  const isMultipart = !!(meta.multipartId && meta.partIndex && meta.totalParts);
  
  if (isMultipart && meta.totalParts !== "1") {
    // Multipart upload - delegate to manager
    return await tusMultipartManager.handlePartCompletion(uploadId, meta);
  }
  
  // Single part upload - process immediately
  const finalFilename = getFinalFilename(meta, uploadId);
  const stagingPath = path.join(TUS_SERVER_CONFIG.stagingDir, uploadId);
  const destinationPath = getFullFilePath(finalFilename, meta.destinationPath);
  const jsonPath = path.join(TUS_SERVER_CONFIG.stagingDir, `${uploadId}.json`);

  moveFile(stagingPath, destinationPath, jsonPath, !usesOriginalFilename(meta));
  console.log(`Upload complete: ${destinationPath}`);
  
  return true;
}