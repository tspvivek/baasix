import { Express } from "express";
import settingsService from "../services/SettingsService.js";
import { APIError } from "../utils/errorHandler.js";
import { adminOnly } from "../utils/auth.js";

const registerEndpoint = (app: Express) => {
  // Get project information (public)
  app.get("/", async (req, res, next) => {
    try {
      const tenantId = req.query.tenant_id as string;
      const projectInfo = await settingsService.getProjectInfo(tenantId);
      res.json(projectInfo);
    } catch (error) {
      next(error);
    }
  });

  app.post("/", async (req, res, next) => {
    try {
      const tenantId = req.query.tenant_id as string;
      const projectInfo = await settingsService.getProjectInfo(tenantId);
      res.json(projectInfo);
    } catch (error) {
      next(error);
    }
  });

  // Get settings (public access - returns global by default, tenant-specific if available)
  app.get("/settings", async (req, res, next) => {
    try {
      const tenantId = (req.query.tenant_id as string) || req.accountability?.tenant;

      // Determine which settings to get
      let settings;
      if (tenantId) {
        // Get tenant-specific settings (falls back to global automatically)
        settings = await settingsService.getTenantSettings(tenantId);
      } else {
        // Get global settings
        settings = settingsService.getGlobalSettings();
      }

      // Filter out SMTP details for all users (including admin)
      const sanitized = settingsService.sanitizeSettings(settings);

      res.json({ data: sanitized });
    } catch (error) {
      next(error);
    }
  });

  // Update settings (admin only)
  app.patch("/settings", adminOnly, async (req, res, next) => {
    try {
      const data = req.body;
      const tenantId = req.query.tenant_id as string;

      let updatedSettings;
      if (tenantId) {
        updatedSettings = await settingsService.updateTenantSettings(
          tenantId,
          data,
          req.accountability
        );
      } else {
        updatedSettings = await settingsService.updateGlobalSettings(
          data,
          req.accountability
        );
      }

      const sanitized = settingsService.sanitizeSettings(updatedSettings);

      res.json({ data: sanitized });
    } catch (error) {
      next(error);
    }
  });

  // Get SMTP config (admin only)
  app.get("/settings/smtp", async (req, res, next) => {
    try {
      // TODO: Check admin permission
      const tenantId = req.accountability?.tenant;

      const smtpConfig = await settingsService.getTenantSMTPConfig(tenantId);

      res.json({ data: smtpConfig });
    } catch (error) {
      next(error);
    }
  });

  // Get email branding
  app.get("/settings/branding", async (req, res, next) => {
    try {
      const tenantId = (req.query.tenant_id as string);

      if (!tenantId) {
        throw new APIError("tenant_id query parameter is required", 400);
      }

      const branding = await settingsService.getTenantBranding(tenantId);

      res.json({ data: branding });
    } catch (error) {
      next(error);
    }
  });

  // Test email configuration (admin only)
  app.post("/settings/test-email", adminOnly, async (req, res, next) => {
    try {
      const { email } = req.body;
      const tenantId = (req.query.tenant_id as string);

      if (!email) {
        throw new APIError("Email address is required", 400);
      }

      // Note: mailService not implemented in Drizzle version yet
      // For now, just return success
      res.json({
        message: "Test email endpoint - not fully implemented yet"
      });
    } catch (error) {
      next(error);
    }
  });

  // Reload settings (admin only)
  app.post("/settings/reload", adminOnly, async (req, res, next) => {
    try {
      const tenantId = (req.query.tenant_id as string);

      if (tenantId) {
        await settingsService.invalidateTenantCache(tenantId);
        await settingsService.getTenantSettings(tenantId); // Reload
        res.json({ message: `Tenant settings reloaded successfully for: ${tenantId}` });
      } else {
        await settingsService.loadGlobalSettings();
        await settingsService.invalidateAllCaches();
        res.json({ message: "Global settings reloaded successfully" });
      }
    } catch (error) {
      next(error);
    }
  });

  // Delete tenant settings (admin only)
  app.delete("/settings/tenant", adminOnly, async (req, res, next) => {
    try {
      const tenantId = (req.query.tenant_id as string);

      if (!tenantId) {
        throw new APIError("tenant_id query parameter is required", 400);
      }

      await settingsService.deleteTenantSettings(tenantId, req.accountability);

      res.json({
        message: "Tenant settings deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "settings",
  handler: registerEndpoint,
};
