import env from "../utils/env.js";
import { promises as fs, createWriteStream } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { getProjectPath } from "../utils/dirname.js";
import sharp from "sharp";
// @ts-ignore - No type definitions available
import ffprobe from "ffprobe";
// @ts-ignore - No type definitions available
import { path as ffprobePath } from "ffprobe-static";
import { lookup } from "mime-types";
import ItemsService from "./ItemsService.js";
import storageService from "./StorageService.js";
import { APIError } from "../utils/errorHandler.js";
import axios from "axios";
import { db } from "../utils/db.js";
import { eq } from "drizzle-orm";
import type { FileData, FileMetadata, InternalUploadedFile } from '../types/index.js';

// Import baasix_File table schema
// This will need to be imported from your schema file
// For now, we'll assume it's available

class FilesService {
  private accountability?: any;
  protected storageService: typeof storageService;
  private itemService: ItemsService;
  private tempDir: string;

  constructor(params: { accountability?: any } = {}) {
    const { accountability } = params;
    this.accountability = accountability;
    this.storageService = storageService;
    this.itemService = new ItemsService("baasix_File", { accountability });
    this.tempDir = env.get("STORAGE_TEMP_PATH") || os.tmpdir();
  }

  /**
   * Coerce metadata values to correct types
   * Form data sends booleans as strings, need to convert them
   */
  private coerceMetadataTypes(metadata: FileMetadata): FileMetadata {
    const coerced = { ...metadata };
    
    // Handle isPublic boolean field
    if ('isPublic' in coerced) {
      if (typeof coerced.isPublic === 'string') {
        (coerced as any).isPublic = (coerced.isPublic as string).toLowerCase() === 'true';
      }
    }
    
    return coerced;
  }

  async createOne(fileData: FileData, metadata: FileMetadata = {}): Promise<string | number> {
    const { file } = fileData;
    if (!file) throw new APIError("File is required", 400);

    // Coerce metadata types (form data sends booleans as strings)
    const coercedMetadata = this.coerceMetadataTypes(metadata);

    const storage = coercedMetadata.storage || env.get("STORAGE_DEFAULT_SERVICE");
    let uniqueid: string | number | null = null;

    try {
      // Upload to temp location
      const tempPath = file.path || (await this.uploadToTemp(file));

      // Create a temporary entry with required fields
      const { title, name, description, originalFilename, ...remainingMetadata } = coercedMetadata;

      // Use originalFilename from metadata if provided, otherwise use uploaded file name
      const resolvedOriginalFilename = originalFilename || file.name;

      const initFileDetails: any = {
        title: title || file.name,
        filename: name || file.name,
        originalFilename: resolvedOriginalFilename,
        description: description || null,
        storage: storage,
        size: file.size,
        type: file.mimetype || file.type || (await this.getFileType(tempPath)) || "application/octet-stream",
        ...remainingMetadata
      };

      uniqueid = await this.itemService.createOne(initFileDetails);

      const uploadedFile = await this.handleFileUpload(tempPath, file.name, storage!, uniqueid);

      const fileDetails = await this.getFileDetails(uploadedFile, tempPath, {
        ...coercedMetadata,
        storage,
        filename: uploadedFile.filename,
        originalFilename: resolvedOriginalFilename,
      });

      // Update the entry with full file details
      // Using Drizzle instead of Sequelize
      await this.itemService.updateOne(uniqueid, fileDetails);

      // Clean up temp file
      await fs.unlink(tempPath);

      return uniqueid;
    } catch (error) {
      // If an error occurs, attempt to delete the temporary entry
      if (uniqueid) {
        await this.itemService.deleteOne(uniqueid).catch(console.error);
      }
      throw error;
    }
  }

  async uploadToTemp(file: any): Promise<string> {
    console.log("Uploading to temp", file.name);
    const originalExtension = path.extname(file.name);
    const tempFilename = crypto.randomBytes(16).toString("hex") + originalExtension;
    // Create temp directory if it doesn't exist
    await fs.mkdir(this.tempDir, { recursive: true });
    const tempPath = path.join(this.tempDir, tempFilename);

    if (file.path) {
      // File is on disk, move it to temp
      await fs.copyFile(file.path, tempPath);
    } else if (file.data) {
      // File is in memory, write it to temp
      await fs.writeFile(tempPath, file.data);
    } else {
      throw new APIError("Invalid file object", 400);
    }

    return tempPath;
  }

  async handleFileUpload(
    tempPath: string,
    originalFilename: string,
    storage: string,
    uniqueid: string | number
  ): Promise<InternalUploadedFile> {
    const provider = this.storageService.getProvider(storage);

    const extension = path.extname(originalFilename);
    const filename = `${uniqueid}-${path.basename(originalFilename, extension).substring(0, 40)}${extension}`;
    let filePath: string;

    const fileContent = await fs.readFile(tempPath);

    if (provider.driver === "LOCAL") {
      filePath = path.join(provider.basePath!, filename);
      const destinationDir = path.dirname(filePath);
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(filePath, fileContent);
    } else if (provider.driver === "S3") {
      filePath = filename; // For S3, the path is just the key
      await provider.saveFile(filePath, fileContent);
    } else {
      throw new APIError(`Unsupported storage driver: ${provider.driver}`, 400);
    }

    return {
      path: filePath,
      filename: filename,
      name: originalFilename,
    };
  }

  async getFileDetails(
    file: InternalUploadedFile,
    tempPath: string,
    { storage, folder, filename, title, description, type, originalFilename }: FileMetadata
  ): Promise<any> {
    if (!type) type = await this.getFileType(tempPath);

    const fileDetails: any = {
      filename: filename || file.name,
      title: title || file.name,
      description: description || "",
      storage: storage,
      type: type,
      size: (await fs.stat(tempPath)).size,
      originalFilename: originalFilename || file.name,
    };

    if (fileDetails.type.startsWith("image/")) {
      const metadata = await sharp(tempPath).metadata();
      fileDetails.width = metadata.width;
      fileDetails.height = metadata.height;
      fileDetails.metadata = metadata;
      delete fileDetails.metadata.icc;
    } else if (fileDetails.type.startsWith("video/") || fileDetails.type.startsWith("audio/")) {
      const metadata = await ffprobe(tempPath, { path: ffprobePath });
      fileDetails.duration = Math.round(metadata.streams[0].duration);
      fileDetails.metadata = metadata;
    }
    return fileDetails;
  }

  async getFileType(filePath: string): Promise<string> {
    console.log("Getting file type for", filePath);
    const mimeType = lookup(filePath);
    if (!mimeType) return "application/octet-stream";
    return mimeType;
  }

  async readByQuery(query: any): Promise<any> {
    return this.itemService.readByQuery(query);
  }

  async readOne(id: string | number, query?: any, bypassPermissions = false): Promise<any> {
    return this.itemService.readOne(id, query, bypassPermissions);
  }

  async updateOne(id: string | number, fileData: FileData, metadata: FileMetadata = {}): Promise<string | number> {
    const existingFile = await this.itemService.readOne(id);
    if (!existingFile) throw new APIError("File not found", 404);

    // Coerce metadata types (form data sends booleans as strings)
    const coercedMetadata = this.coerceMetadataTypes(metadata);

    const { file } = fileData;
    let fileDetails: any = {
      ...coercedMetadata,
    };

    if (file) {
      const storage = coercedMetadata.storage || existingFile.storage;
      const uploadedFile = await this.handleFileUpload(file.path, file.name, storage, id);
      fileDetails = {
        ...fileDetails,
        ...(await this.getFileDetails(uploadedFile, file.path, {
          ...coercedMetadata,
          storage,
          filename: uploadedFile.filename,
        })),
      };
    }

    await this.itemService.updateOne(id, fileDetails);

    if (file) {
      await this.deleteFile(existingFile);
    }

    return id;
  }

  async deleteOne(id: string | number): Promise<string | number> {
    const file = await this.itemService.readOne(id);
    if (!file) throw new APIError("File not found", 404);

    await this.itemService.deleteOne(id);
    await this.deleteFile(file);

    return id;
  }

  async deleteFile(file: any): Promise<void> {
    if (!file) throw new APIError("File not found", 404);

    const provider = this.storageService.getProvider(file.storage);

    if (provider.driver === "LOCAL") {
      const filePath = path.join(provider.basePath!, file.filename);
      if (
        await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false)
      ) {
        await fs.unlink(filePath);
      }
    } else if (provider.driver === "S3") {
      await provider.deleteFile(file.filename);
    } else {
      throw new APIError(`Unsupported storage driver: ${provider.driver}`, 400);
    }
  }

  async uploadFromUrl(fileUrl: string, metadata: FileMetadata = {}): Promise<string | number> {
    const fileName = fileUrl.split("/").pop() || "download";
    const tempPath = getProjectPath(env.get("STORAGE_TEMP_PATH") || "temp", `temp-${fileName}`);

    try {
      await fs.mkdir(path.dirname(tempPath), { recursive: true });
      await this.downloadFile(fileUrl, tempPath);

      const fileStats = await fs.stat(tempPath);
      const file = {
        path: tempPath,
        name: fileName,
        size: fileStats.size,
      };

      return this.createOne({ file }, metadata);
    } catch (error) {
      console.error(error);
      throw new APIError("Error downloading or uploading the file", 500);
    }
  }

  async downloadFile(url: string, outputLocationPath: string): Promise<void> {
    const writer = createWriteStream(outputLocationPath);
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }
}

export default FilesService;
