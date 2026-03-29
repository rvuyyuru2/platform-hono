import { HonoRequest } from 'hono';

import { StorageFile, Storage } from './storage';

export interface MemoryStorageFile extends StorageFile {
  buffer: Buffer;
  stream: () => ReadableStream<Uint8Array>;
}

export class MemoryStorage implements Storage<MemoryStorageFile> {
  public async handleFile(
    file: File,
    _req: HonoRequest,
    fieldName: string,
  ): Promise<MemoryStorageFile> {
    // arrayBuffer() is supported by both Node.js (v16+) and Bun
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      buffer,
      size: buffer.length,
      encoding: '7bit',
      mimetype: file.type,
      fieldName,
      originalFilename: file.name,
      uploadedAt: new Date().toISOString(),
      stream: () => file.stream(),
    };
  }

  public async removeFile(file: StorageFile): Promise<void> {
    if ('buffer' in file) {
      delete (file as MemoryStorageFile).buffer;
    }
  }
}
