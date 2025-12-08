import { Express } from "express";
import FilesService from "../services/FilesService.js";
import AssetsService from "../services/AssetsService.js";
import SettingsService from "../services/SettingsService.js";
import fileUpload from "express-fileupload";
import { APIError } from "../utils/errorHandler.js";
import env from "../utils/env.js";
import fs from "fs";
import axios from "axios";

const registerEndpoint = (app: Express) => {
  // Middleware to initialize FileService
  const initFileService = (req: any, res: any, next: any) => {
    req.filesService = new FilesService({
      accountability: req.accountability,
    });
    next();
  };

  // Get all files
  app.get("/files", initFileService, async (req: any, res, next) => {
    try {
      const result = await req.filesService.itemService.readByQuery(req.query);
      res.status(200).json(result);
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Get single file
  app.get("/files/:id", initFileService, async (req: any, res, next) => {
    try {
      const file = await req.filesService.readOne(req.params.id, req.query);
      res.status(200).json({ data: file });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Create file
  app.post(
    "/files",
    initFileService,
    fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }),
    async (req: any, res, next) => {
      try {
        const file = req.files.file;
        const metadata = {
          ...req.body,
          title: req.body.title || file.name,
          storage: req.body.storage || env.get("STORAGE_DEFAULT_SERVICE"),
        };
        const createdFile = await req.filesService.createOne({ file }, metadata);
        res.status(200).json({ data: createdFile });
      } catch (error) {
        console.error(error);
        next(error);
      }
    }
  );

  // Update file
  app.patch(
    "/files/:id",
    initFileService,
    fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }),
    async (req: any, res, next) => {
      try {
        const file = req.files?.file;
        const metadata = req.body;
        const updatedFile = await req.filesService.updateOne(req.params.id, { file }, metadata);
        res.status(200).json({ data: updatedFile });
      } catch (error) {
        console.error(error);
        next(error);
      }
    }
  );

  // Delete file
  app.delete("/files/:id", initFileService, async (req: any, res, next) => {
    try {
      await req.filesService.deleteOne(req.params.id);
      res.status(200).json({ message: "File deleted successfully" });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Upload file from URL
  app.post("/files/upload-from-url", initFileService, async (req: any, res, next) => {
    try {
      const { url, ...metadata } = req.body;
      const file = await req.filesService.uploadFromUrl(url, metadata);
      res.status(200).json({ data: file });
    } catch (error) {
      console.error(error);
      next(error);
    }
  });

  // Get asset (with image processing support)
  app.get("/assets/:id", initFileService, async (req: any, res, next) => {
    try {
      const isDownload = req.query.download === "true";
      const assetService = new AssetsService({
        accountability: req.accountability,
      });

      let fileId = req.params.id;
      let bypassPermissions = false;

      // Handle special project asset names
      if (
        ["project_logo_light", "project_logo_dark", "project_favicon", "project_icon", "email_icon"].includes(
          req.params.id
        )
      ) {
        const settings = await SettingsService.getSettings();
        const file = (settings as any)[req.params.id];

        if (file) {
          fileId = file.id;
          bypassPermissions = true;
        } else {
          res.status(404).send("File not found");
          return;
        }
      }

      const { buffer, contentType, filePath, file, isS3 } = await assetService.getAsset(
        fileId,
        req.query,
        bypassPermissions
      );

      // Helper function to get download filename with proper encoding
      const getDownloadHeaders = (file: any) => {
        const downloadFilename = file.originalFilename || file.title || file.filename;
        const encodedFilename = encodeURIComponent(downloadFilename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
        return `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`;
      };

      // For S3 files, handle secure proxy or direct redirect based on configuration
      if (isS3 && !isDownload) {
        try {
          const provider = (assetService as any).storageService.getProvider(file.storage);

          if (env.get("ASSET_PROXY_ENABLED") === "true") {
            // Parse ASSET_SECURE_PROXY_URLS as array of file types
            const secureFileTypes = env.get("ASSET_SECURE_PROXY_URLS")
              ? env.get("ASSET_SECURE_PROXY_URLS").split(",").map((type: string) => type.trim().toLowerCase())
              : [];

            // Check if current file type requires secure proxy
            const requiresSecureProxy = secureFileTypes.some((type: string) => {
              if (type === "video" && contentType.startsWith("video/")) return true;
              if (type === "audio" && contentType.startsWith("audio/")) return true;
              if (type === "image" && contentType.startsWith("image/")) return true;
              if (contentType.startsWith(type + "/")) return true;
              return false;
            });

            if (requiresSecureProxy) {
              // Server proxy with header validation for secure file types
              const userId = req.accountability.user.id.toString();
              const requiredHeader = "x-baasix-user-auth";
              const providedAuth = req.headers[requiredHeader];

              // Validate user ID in header
              if (providedAuth !== userId) {
                return res.status(403).json({ error: "Invalid or missing authentication header" });
              }
            }

            // Stream from S3 through server with range support
            const presignedUrl = await provider.getPublicUrl(file.filename);

            const requestHeaders: any = {};
            if (req.headers.range) {
              requestHeaders.range = req.headers.range;
            }

            const s3Response = await axios({
              method: "GET",
              url: presignedUrl,
              headers: requestHeaders,
              responseType: "stream",
              validateStatus: (status: number) => status < 400,
            });

            // Forward S3 response headers
            res.set({
              "Content-Type": s3Response.headers["content-type"] || contentType,
              "Content-Length": s3Response.headers["content-length"],
              "Accept-Ranges": "bytes",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            });

            if (s3Response.headers["content-range"]) {
              res.set("Content-Range", s3Response.headers["content-range"]);
              res.status(206);
            }

            s3Response.data.pipe(res);
            return;
          } else {
            // Direct redirect for non-secure file types or unauthenticated users
            if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
              const presignedUrl = await provider.getPublicUrl(file.filename);
              res.redirect(302, presignedUrl);
              return;
            }
          }
        } catch (error) {
          console.error("Failed to handle S3 file request, falling back to proxy:", error);
          // Fall through to normal handling if S3 handling fails
        }
      }

      // Handle S3 file downloads - stream through server with correct filename
      if (isS3 && isDownload) {
        try {
          const provider = (assetService as any).storageService.getProvider(file.storage);
          const presignedUrl = await provider.getPublicUrl(file.filename);

          const s3Response = await axios({
            method: "GET",
            url: presignedUrl,
            responseType: "stream",
            validateStatus: (status: number) => status < 400,
          });

          const downloadFilename = file.originalFilename || file.title || file.filename;
          
          // Use res.attachment() which properly sets Content-Disposition
          res.attachment(downloadFilename);
          res.setHeader("Content-Type", s3Response.headers["content-type"] || contentType);
          res.setHeader("Content-Length", s3Response.headers["content-length"]);

          s3Response.data.pipe(res);
          return;
        } catch (error) {
          console.error("Failed to handle S3 download, falling back to buffer:", error);
          // Fall through to normal handling if S3 handling fails
        }
      }

      // Handle range requests for local video files
      if (
        contentType &&
        (contentType.startsWith("video/") || contentType.startsWith("audio/")) &&
        filePath &&
        !isS3
      ) {
        const range = req.headers.range;

        if (range) {
          const stat = await fs.promises.stat(filePath);
          const fileSize = stat.size;
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;

          const stream = fs.createReadStream(filePath, { start, end });

          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": contentType,
          });

          stream.pipe(res);
          return;
        }

        // If not a range request, set Accept-Ranges header for video files
        res.setHeader("Accept-Ranges", "bytes");
      }

      res.contentType(contentType);

      if (isDownload) {
        res.setHeader("Content-Disposition", getDownloadHeaders(file));
      }

      res.send(buffer);
    } catch (error) {
      console.error(error);
      next(error);
    }
  });
};

export default {
  id: "files",
  handler: registerEndpoint,
};
