import env from "../utils/env.js";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import FilesService from "./FilesService.js";
import ItemsService from "./ItemsService.js";
import type { AssetQuery, AssetResult, ProcessedImage } from '../types/index.js';

class AssetsService extends FilesService {
  private cacheDir: string;
  private maxCacheSize: number;
  private itemsService: ItemsService;

  constructor(params: { accountability?: any } = {}) {
    const { accountability } = params;
    super({ accountability });
    
    this.cacheDir = env.get("ASSET_CACHE_DIR") || path.join(process.cwd(), "asset-cache");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    
    // Convert GB to bytes, default to 1GB if not set
    this.maxCacheSize = (parseFloat(env.get("ASSET_CACHE_SIZE_GB") || "1")) * 1024 * 1024 * 1024;
    this.itemsService = new ItemsService("baasix_File", { accountability });
  }

  async getAsset(id: string | number, query: AssetQuery, bypassPermissions = false): Promise<AssetResult> {
    const file = await this.itemsService.readOne(id, {}, bypassPermissions);

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

    const filePath = await this.getFilePath(file);
    const { width, height, fit, quality, withoutEnlargement } = query;

    if (file.type.startsWith("image/")) {
      const cacheKey = this.getCacheKey(id, query);
      const cachedPath = path.join(this.cacheDir, cacheKey);

      if (
        await fs.promises
          .access(cachedPath)
          .then(() => true)
          .catch(() => false)
      ) {
        const result = await this.getOriginalFile(cachedPath);
        result.file = file;
        result.isS3 = isS3;
        return result;
      }

      const processedImage = await this.processImage(filePath, {
        width,
        height,
        fit,
        quality,
        withoutEnlargement,
      });
      await this.saveToCache(processedImage.buffer, cacheKey);
      (processedImage as any).file = file;
      (processedImage as any).isS3 = isS3;
      return processedImage as any;
    } else {
      const result = await this.getOriginalFile(filePath);
      // Include file path for video/audio files to support range requests
      if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
        result.filePath = filePath;
      }
      result.file = file;
      result.isS3 = isS3;
      return result;
    }
  }

  async getFilePath(file: any): Promise<string> {
    const provider = this.storageService.getProvider(file.storage);

    if (provider.driver === "LOCAL") {
      return path.join(provider.basePath, file.filename);
    } else if (provider.driver === "S3") {
      // For S3, we need to download the file to a temporary location
      const tempFilePath = path.join(this.cacheDir, `temp_${file.filename}`);
      const fileContent = await provider.getFile(file.filename);
      await fs.promises.writeFile(tempFilePath, fileContent);
      return tempFilePath;
    } else {
      throw new Error(`Unsupported storage driver: ${provider.driver}`);
    }
  }

  getCacheKey(id: string | number, query: AssetQuery): string {
    const queryString = JSON.stringify(query);
    return crypto.createHash("md5").update(`${id}-${queryString}`).digest("hex") + ".jpg";
  }

  async saveToCache(buffer: Buffer, cacheKey: string): Promise<void> {
    await this.ensureCacheSizeLimit();
    const cachedPath = path.join(this.cacheDir, cacheKey);
    await fs.promises.writeFile(cachedPath, buffer);
  }

  async ensureCacheSizeLimit(): Promise<void> {
    const currentSize = await this.getCacheSize();
    if (currentSize > this.maxCacheSize) {
      await this.deleteOldestCacheFiles(currentSize - this.maxCacheSize);
    }
  }

  async getCacheSize(): Promise<number> {
    const files = await fs.promises.readdir(this.cacheDir);
    let totalSize = 0;
    for (const file of files) {
      const filePath = path.join(this.cacheDir, file);
      const stats = await fs.promises.stat(filePath);
      totalSize += stats.size;
    }
    return totalSize;
  }

  async deleteOldestCacheFiles(sizeToFree: number): Promise<void> {
    const files = await fs.promises.readdir(this.cacheDir);
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.promises.stat(filePath);
        return { name: file, path: filePath, mtime: stats.mtime, size: stats.size };
      })
    );

    fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

    let freedSize = 0;
    for (const file of fileStats) {
      if (freedSize >= sizeToFree) break;
      await fs.promises.unlink(file.path);
      freedSize += file.size;
    }
  }

  async processImage(
    filePath: string,
    { width, height, fit, quality, withoutEnlargement }: AssetQuery
  ): Promise<ProcessedImage> {
    let image = sharp(filePath);

    if (width || height) {
      const resizeOptions: any = {
        width: width ? parseInt(width.toString()) : undefined,
        height: height ? parseInt(height.toString()) : undefined,
        fit: fit || "cover",
        withoutEnlargement: withoutEnlargement === "true" || withoutEnlargement === true,
      };
      image = image.resize(resizeOptions);
    }

    if (quality) {
      image = image.jpeg({ quality: parseInt(quality.toString()) });
    }

    const buffer = await image.toBuffer();
    return { buffer, contentType: "image/jpeg" };
  }

  async getOriginalFile(filePath: string): Promise<AssetResult> {
    const buffer = await fs.promises.readFile(filePath);
    const contentType = await this.getFileType(filePath);
    return { buffer, contentType, file: null };
  }

  /**
   * Method to clear entire cache (optional, can be useful for maintenance)
   */
  async clearCache(): Promise<void> {
    const files = await fs.promises.readdir(this.cacheDir);
    for (const file of files) {
      await fs.promises.unlink(path.join(this.cacheDir, file));
    }
  }
}

export default AssetsService;
