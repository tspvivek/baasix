import env from "../utils/env.js";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import FilesService from "./FilesService.js";
import ItemsService from "./ItemsService.js";
import type { AssetQuery, AssetResult, ProcessedImage } from '../types/index.js';
import { getProjectPath } from "../utils/dirname.js";

class AssetsService extends FilesService {
  private assetTempDir: string;
  private itemsService: ItemsService;

  constructor(params: { accountability?: any } = {}) {
    const { accountability } = params;
    super({ accountability });
    
    // Temp directory for S3 file processing (not for caching)
    this.assetTempDir = env.get("ASSET_TEMP_DIR") || getProjectPath("asset-temp");
    if (!fs.existsSync(this.assetTempDir)) {
      fs.mkdirSync(this.assetTempDir, { recursive: true });
    }
    
    this.itemsService = new ItemsService("baasix_File", { accountability });
  }

  async getAsset(id: string | number, query: AssetQuery, bypassPermissions = false): Promise<AssetResult> {
    let file: any;
    
    if (bypassPermissions) {
      // If bypassPermissions is explicitly requested, use it directly
      file = await this.itemsService.readOne(id, {}, true);
    } else {
      // For public files (isPublic: true), we need to bypass permission checks
      // First, try to read with bypassed permissions to check if file exists and is public
      const fileCheck = await this.itemsService.readOne(id, {}, true);
      
      if (!fileCheck) {
        throw new Error("File not found");
      }
      
      // If file is public, allow access without permission check
      if (fileCheck.isPublic === true) {
        file = fileCheck;
      } else {
        // File is not public, check permissions normally
        file = await this.itemsService.readOne(id, {}, false);
      }
    }

    if (!file) throw new Error("File not found");

    const provider = this.storageService.getProvider(file.storage);
    const isS3 = provider.driver === "S3";
    
    // For S3 video/audio files, we don't need to download the file
    if (isS3 && (file.type.startsWith("video/") || file.type.startsWith("audio/"))) {
      return {
        buffer: null,
        contentType: file.type,
        filePath: null,
        file: file,
        isS3: true
      };
    }

    const { width, height, fit, quality, withoutEnlargement } = query;
    const hasTransformParams = width || height || quality;

    // Get content type with fallback
    const fileContentType = file.type || await this.getFileType(file.filename) || "application/octet-stream";

    if (fileContentType.startsWith("image/")) {
      // If no transform params, return the original image
      if (!hasTransformParams) {
        const buffer = await this.getFileBuffer(file, provider, isS3);
        return {
          buffer,
          contentType: fileContentType,
          filePath: null,
          file: file,
          isS3: isS3
        };
      }

      // Generate processed filename to store alongside original
      const processedFilename = this.getProcessedFilename(file.filename, query);
      
      // Check if processed version exists in storage
      const processedBuffer = await this.getProcessedFromStorage(provider, processedFilename, isS3);
      
      if (processedBuffer) {
        // Processed version exists, return it
        return {
          buffer: processedBuffer,
          contentType: "image/jpeg",
          filePath: null,
          file: file,
          isS3: isS3
        };
      }

      // Process the image and store it
      const originalBuffer = await this.getFileBuffer(file, provider, isS3);
      const processedImage = await this.processImageBuffer(originalBuffer, {
        width,
        height,
        fit,
        quality,
        withoutEnlargement,
      });

      // Save processed image to the same storage adapter
      await this.saveProcessedToStorage(provider, processedFilename, processedImage.buffer);

      return {
        buffer: processedImage.buffer,
        contentType: "image/jpeg",
        filePath: null,
        file: file,
        isS3: isS3
      };
    } else {
      // Non-image files
      const buffer = await this.getFileBuffer(file, provider, isS3);
      let filePath = null;
      
      // For video/audio files with local storage, provide file path for range requests
      if ((fileContentType.startsWith("video/") || fileContentType.startsWith("audio/")) && !isS3) {
        filePath = path.join(provider.basePath, file.filename);
      }
      
      return {
        buffer,
        contentType: fileContentType,
        filePath,
        file: file,
        isS3: isS3
      };
    }
  }

  /**
   * Get file buffer from storage (works for both LOCAL and S3)
   */
  private async getFileBuffer(file: any, provider: any, isS3: boolean): Promise<Buffer> {
    if (isS3) {
      const stream = await provider.getFile(file.filename);
      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } else {
      const filePath = path.join(provider.basePath, file.filename);
      return fs.promises.readFile(filePath);
    }
  }

  /**
   * Generate a filename for processed/resized images
   * Format: {originalName}_processed_{hash}.jpg
   */
  getProcessedFilename(originalFilename: string, query: AssetQuery): string {
    const cacheParams = {
      width: query.width,
      height: query.height,
      fit: query.fit,
      quality: query.quality,
      withoutEnlargement: query.withoutEnlargement,
    };
    const hash = crypto.createHash("md5").update(JSON.stringify(cacheParams)).digest("hex").substring(0, 8);
    const ext = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, ext);
    return `${baseName}_processed_${hash}.jpg`;
  }

  /**
   * Try to get a processed image from storage
   * Returns null if not found
   */
  private async getProcessedFromStorage(provider: any, filename: string, isS3: boolean): Promise<Buffer | null> {
    try {
      if (isS3) {
        const stream = await provider.getFile(filename);
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      } else {
        const filePath = path.join(provider.basePath, filename);
        return await fs.promises.readFile(filePath);
      }
    } catch (error: any) {
      // File doesn't exist
      if (error.code === 'ENOENT' || error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      // For S3, check if it's a not found error
      if (error.Code === 'NoSuchKey' || error.message?.includes('NoSuchKey')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save processed image to storage
   */
  private async saveProcessedToStorage(provider: any, filename: string, buffer: Buffer): Promise<void> {
    try {
      await provider.saveFile(filename, buffer);
    } catch (error) {
      // Log but don't fail - the image is still returned to user
      console.error("Failed to save processed image to storage:", error);
    }
  }

  /**
   * Process image from buffer instead of file path
   */
  async processImageBuffer(
    inputBuffer: Buffer,
    { width, height, fit, quality, withoutEnlargement }: AssetQuery
  ): Promise<ProcessedImage> {
    let image = sharp(inputBuffer);

    if (width || height) {
      const resizeOptions: any = {
        width: width ? parseInt(width.toString()) : undefined,
        height: height ? parseInt(height.toString()) : undefined,
        fit: fit || "cover",
        withoutEnlargement: withoutEnlargement === "true" || withoutEnlargement === true,
      };
      image = image.resize(resizeOptions);
    }

    // Always convert to JPEG for processed images
    const jpegQuality = quality ? parseInt(quality.toString()) : 80;
    image = image.jpeg({ quality: jpegQuality });

    const buffer = await image.toBuffer();
    return { buffer, contentType: "image/jpeg" };
  }

  /**
   * Delete processed versions of an image when the original is deleted
   * This can be called from a hook when a file is deleted
   */
  async deleteProcessedVersions(file: any): Promise<void> {
    if (!file.type?.startsWith("image/")) return;

    const provider = this.storageService.getProvider(file.storage);
    const isS3 = provider.driver === "S3";
    const baseName = path.basename(file.filename, path.extname(file.filename));
    const pattern = `${baseName}_processed_`;

    try {
      if (isS3) {
        // For S3, we'd need to list objects with prefix - complex to implement
        // Could be added later if needed
        console.info("S3 processed version cleanup not implemented yet");
      } else {
        // For LOCAL storage, list directory and delete matching files
        const files = await fs.promises.readdir(provider.basePath);
        for (const f of files) {
          if (f.startsWith(pattern)) {
            await fs.promises.unlink(path.join(provider.basePath, f));
          }
        }
      }
    } catch (error) {
      console.error("Failed to delete processed versions:", error);
    }
  }
}

export default AssetsService;
