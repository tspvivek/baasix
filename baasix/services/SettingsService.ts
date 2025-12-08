import env from "../utils/env.js";
import { APIError } from "../utils/errorHandler.js";
import ItemsService from "./ItemsService.js";
import { getCache } from "../utils/cache.js";
import type { TenantSettings } from '../types/index.js';

class SettingsService {
  private globalSettings: TenantSettings | null = null;

  constructor() {
    console.info("SettingsService instance created");
  }

  /**
   * Get cache instance
   */
  getCache() {
    return getCache();
  }

  async loadGlobalSettings(): Promise<void> {
    try {
      const itemsService = new ItemsService("baasix_Settings", {
        accountability: undefined,
      });

      const settings = await itemsService.readByQuery({
        filter: { tenant_Id: { isNull: true } }, // Global settings have null tenant_Id
        limit: 1,
        fields: [
          "*",
          "project_logo_light.*",
          "project_logo_dark.*",
          "project_logo_full.*",
          "project_logo_transparent.*",
          "project_favicon.*",
          "project_icon.*",
          "email_icon.*",
        ],
      });

      if (!settings.data[0]) {
        // Create default global settings if none exist
        const defaultSettings = await this.createDefaultGlobalSettings(itemsService);
        this.globalSettings = defaultSettings;
      } else {
        this.globalSettings = settings.data[0];
      }

      console.info("Global settings loaded successfully");
    } catch (error) {
      console.error("Error loading global settings:", error);
      throw error;
    }
  }

  // Legacy method for backward compatibility
  async loadSettings(): Promise<void> {
    return this.loadGlobalSettings();
  }

  async createDefaultGlobalSettings(itemsService: ItemsService): Promise<TenantSettings> {
    try {
      const defaultData: TenantSettings = {
        tenant_Id: null, // Global settings
        project_name: "Baasix Project",
        title: "Baasix Project",
        project_url: null,
        app_url: null,
        project_color: "#663399",
        secondary_color: "#f0f0f0",
        description: "Powered by Baasix",
        keywords: "cms, headless, api",
        from_email_name: "Baasix",
        smtp_enabled: false,
        smtp_port: 587,
        smtp_secure: false,
        timezone: "UTC",
        language: "en",
        date_format: "YYYY-MM-DD",
        currency: "USD",
        metadata: {},
        modules: {},
      };

      const settingId = await itemsService.createOne(defaultData);
      return await itemsService.readOne(settingId);
    } catch (error: any) {
      console.error("Error creating default global settings:", error);
      throw new APIError("Error creating default global settings", 500, error.message);
    }
  }

  // Legacy method for backward compatibility
  async createDefaultSettings(itemsService: ItemsService): Promise<TenantSettings> {
    return this.createDefaultGlobalSettings(itemsService);
  }

  getGlobalSettings(): TenantSettings {
    if (!this.globalSettings) {
      throw new APIError("Global settings not loaded", 500);
    }
    return this.globalSettings;
  }

  // Legacy method for backward compatibility
  getSettings(): TenantSettings {
    return this.getGlobalSettings();
  }

  /**
   * Get tenant-specific settings: global base + tenant overrides
   */
  async getTenantSettings(tenantId: string | number): Promise<TenantSettings> {
    if (!tenantId) {
      return this.getGlobalSettings();
    }

    const cache = this.getCache();
    const cacheKey = `settings:tenant:${tenantId}`;

    // Check cache first
    const cachedSettings = await cache.get(cacheKey);
    if (cachedSettings) {
      return cachedSettings;
    }

    try {
      // Always start with global settings as the base
      const globalSettings = this.getGlobalSettings();
      const mergedSettings: TenantSettings = { ...globalSettings };

      const itemsService = new ItemsService("baasix_Settings", {
        accountability: undefined,
      });

      const tenantSettings = await itemsService.readByQuery({
        filter: { tenant_Id: tenantId },
        limit: 1,
        fields: [
          "*",
          "project_logo_light.*",
          "project_logo_dark.*",
          "project_logo_full.*",
          "project_logo_transparent.*",
          "project_favicon.*",
          "project_icon.*",
          "email_icon.*",
        ],
      });

      if (tenantSettings.data[0]) {
        // Merge tenant-specific overrides on top of global settings
        const tenantOverrides = tenantSettings.data[0];

        // Only override with non-null values from tenant settings
        Object.keys(tenantOverrides).forEach((key) => {
          if (tenantOverrides[key] !== null && tenantOverrides[key] !== undefined && key !== "tenant_Id") {
            mergedSettings[key] = tenantOverrides[key];
          }
        });
      }

      // Cache the merged settings with infinite TTL
      await cache.set(cacheKey, mergedSettings, -1);
      return mergedSettings;
    } catch (error) {
      console.error(`Error loading tenant settings for ${tenantId}:`, error);
      // Fall back to global settings on error
      return this.getGlobalSettings();
    }
  }

  async updateGlobalSettings(data: Partial<TenantSettings>, accountability?: any): Promise<TenantSettings> {
    try {
      const itemsService = new ItemsService("baasix_Settings", {
        accountability,
      });

      // Find global settings record
      const globalSettings = await itemsService.readByQuery({
        filter: { tenant_Id: { isNull: true } },
        limit: 1,
      });

      if (globalSettings.data[0]) {
        await itemsService.updateOne(globalSettings.data[0].id, data);
      } else {
        // Create global settings if they don't exist
        await itemsService.createOne({ ...data, tenant_Id: null });
      }

      // Reload global settings and clear all caches
      await this.loadGlobalSettings();
      await this.invalidateAllCaches();

      return this.globalSettings!;
    } catch (error: any) {
      console.error("Error updating global settings:", error);
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError("Error updating global settings", 500, error.message);
    }
  }

  // Legacy method for backward compatibility
  async updateSettings(data: Partial<TenantSettings>, accountability?: any): Promise<TenantSettings> {
    return this.updateGlobalSettings(data, accountability);
  }

  async updateTenantSettings(
    tenantId: string | number,
    data: Partial<TenantSettings>,
    accountability?: any
  ): Promise<TenantSettings> {
    if (!tenantId) {
      throw new APIError("Tenant ID is required for tenant settings", 400);
    }

    try {
      const itemsService = new ItemsService("baasix_Settings", {
        accountability,
      });

      // Find existing tenant settings
      const existingSettings = await itemsService.readByQuery({
        filter: { tenant_Id: tenantId },
        limit: 1,
      });

      if (existingSettings.data[0]) {
        // Update existing tenant settings
        await itemsService.updateOne(existingSettings.data[0].id, data);
      } else {
        // Create new tenant settings
        await itemsService.createOne({ ...data, tenant_Id: tenantId });
      }

      // Invalidate cache for this tenant
      await this.invalidateTenantCache(tenantId);

      return await this.getTenantSettings(tenantId);
    } catch (error: any) {
      console.error(`Error updating tenant settings for ${tenantId}:`, error);
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError("Error updating tenant settings", 500, error.message);
    }
  }

  async deleteTenantSettings(tenantId: string | number, accountability?: any): Promise<void> {
    if (!tenantId) {
      throw new APIError("Tenant ID is required", 400);
    }

    try {
      const itemsService = new ItemsService("baasix_Settings", {
        accountability,
      });

      const existingSettings = await itemsService.readByQuery({
        filter: { tenant_Id: tenantId },
        limit: 1,
      });

      if (existingSettings.data[0]) {
        await itemsService.deleteOne(existingSettings.data[0].id);
        await this.invalidateTenantCache(tenantId);
      }
    } catch (error: any) {
      console.error(`Error deleting tenant settings for ${tenantId}:`, error);
      throw new APIError("Error deleting tenant settings", 500, error.message);
    }
  }

  /**
   * Get SMTP configuration for tenant with fallback hierarchy
   */
  async getTenantSMTPConfig(tenantId: string | number): Promise<any | null> {
    const settings = await this.getTenantSettings(tenantId);

    if (!settings.smtp_enabled || !settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
      return null;
    }

    return {
      host: settings.smtp_host,
      port: settings.smtp_port,
      secure: settings.smtp_secure,
      auth: {
        user: settings.smtp_user,
        pass: settings.smtp_pass,
      },
      from: settings.smtp_from_address || settings.smtp_user,
      fromName: settings.from_email_name || settings.project_name,
    };
  }

  /**
   * Get email branding for tenant
   */
  async getTenantEmailBranding(tenantId: string | number): Promise<any> {
    const settings = await this.getTenantSettings(tenantId);

    return {
      project_name: settings.project_name,
      title: settings.title,
      project_url: settings.project_url,
      app_url: settings.app_url,
      logo_url: settings.email_icon ? `${settings.project_url}/assets/${settings.email_icon.id}` : null,
      project_color: settings.project_color,
      email_signature: settings.email_signature,
      from_email_name: settings.from_email_name,
    };
  }

  /**
   * Get tenant branding configuration
   */
  async getTenantBranding(tenantId: string | number): Promise<any> {
    const settings = await this.getTenantSettings(tenantId);

    return {
      project_name: settings.project_name,
      title: settings.title,
      project_url: settings.project_url,
      app_url: settings.app_url,
      description: settings.description,
      keywords: settings.keywords,
      logo_url: settings.email_icon ? `${settings.project_url}/assets/${settings.email_icon.id}` : null,
      project_color: settings.project_color,
      secondary_color: settings.secondary_color,
      timezone: settings.timezone,
      language: settings.language,
      date_format: settings.date_format,
      currency: settings.currency,
    };
  }

  /**
   * Sanitize settings by removing sensitive SMTP credentials
   */
  sanitizeSettings(settings: TenantSettings | null): TenantSettings | null {
    if (!settings) {
      return settings;
    }

    // Create a copy to avoid mutating the original
    const sanitized = { ...settings };

    // Remove sensitive SMTP fields
    const sensitiveFields = [
      "smtp_user",
      "smtp_pass",
      "smtp_host",
      "smtp_port",
      "smtp_secure",
      "smtp_from_address",
    ];

    sensitiveFields.forEach((field) => {
      delete sanitized[field];
    });

    return sanitized;
  }

  /**
   * Cache management
   */
  async invalidateTenantCache(tenantId: string | number): Promise<void> {
    const cache = this.getCache();
    const cacheKey = `settings:tenant:${tenantId}`;
    await cache.delete(cacheKey);
    console.info(`Tenant settings cache invalidated for: ${tenantId}`);
  }

  async invalidateAllCaches(): Promise<void> {
    const cache = this.getCache();
    await cache.invalidateModel("settings:tenant");
    console.info("All tenant settings cache cleared");
  }

  async getProjectInfo(tenantId: string | number | null = null): Promise<any> {
    try {
      const settings = tenantId ? await this.getTenantSettings(tenantId) : this.getGlobalSettings();

      return {
        project: {
          name: settings.project_name,
          title: settings.title,
          url: settings.project_url,
          app_url: settings.app_url,
          color: settings.project_color,
          secondary_color: settings.secondary_color,
          description: settings.description,
          keywords: settings.keywords,
          branding: {
            "logo-light": settings.project_logo_light?.id || null,
            "logo-dark": settings.project_logo_dark?.id || null,
            "logo-full": settings.project_logo_full?.id || null,
            "logo-transparent": settings.project_logo_transparent?.id || null,
            favicon: settings.project_favicon?.id || null,
            icon: settings.project_icon?.id || null,
            "email-icon": settings.email_icon?.id || null,
          },
          localization: {
            timezone: settings.timezone,
            language: settings.language,
            date_format: settings.date_format,
            currency: settings.currency,
          },
          smtp_enabled: settings.smtp_enabled,
          multitenant: env.get("MULTI_TENANT") || false,
          metadata: settings.metadata || {},
          modules: settings.modules || {},
        },
        version: env.get("npm_package_version") || "0.0.1",
      };
    } catch (error: any) {
      console.error("Error getting project info:", error);
      throw new APIError("Error getting project info", 500, error.message);
    }
  }

  /**
   * Get settings by matching app_url
   */
  async getSettingsByAppUrl(appUrl: string): Promise<TenantSettings> {
    if (!appUrl) {
      throw new APIError("app_url is required", 400);
    }

    try {
      // First check global settings
      const globalSettings = this.getGlobalSettings();
      if (globalSettings.app_url === appUrl) {
        return globalSettings;
      }

      // Query database for tenant settings
      const itemsService = new ItemsService("baasix_Settings", {
        accountability: undefined,
      });

      const tenantSettings = await itemsService.readByQuery({
        filter: { app_url: { _ilike: appUrl } },
        limit: 1,
        fields: ["tenant_Id"],
      });

      if (tenantSettings.data[0]) {
        // Use getTenantSettings to get cached/merged settings
        const tenantId = tenantSettings.data[0].tenant_Id;
        return await this.getTenantSettings(tenantId);
      }

      throw new APIError("No settings found with the provided app_url", 404);
    } catch (error: any) {
      if (error instanceof APIError) {
        throw error;
      }
      console.error(`Error getting settings by app_url ${appUrl}:`, error);
      throw new APIError("Error retrieving settings by app_url", 500, error.message);
    }
  }

  /**
   * Get all unique URLs from global and tenant settings for CORS/auth whitelist
   */
  async getAllSettingsUrls(): Promise<string[]> {
    try {
      const urls = new Set<string>();

      // Get global settings URLs
      const globalSettings = this.getGlobalSettings();
      if (globalSettings.project_url) {
        urls.add(globalSettings.project_url.trim());
      }
      if (globalSettings.app_url) {
        urls.add(globalSettings.app_url.trim());
      }

      // Get all tenant settings from database
      const itemsService = new ItemsService("baasix_Settings", {
        accountability: undefined,
      });

      const allSettings = await itemsService.readByQuery({
        filter: { tenant_Id: { isNotNull: true } }, // Get only tenant settings
        fields: ["tenant_Id", "project_url", "app_url"],
        limit: -1, // Get all
      });

      // Add tenant URLs
      allSettings.data.forEach((setting: any) => {
        if (setting.project_url) {
          urls.add(setting.project_url.trim());
        }
        if (setting.app_url) {
          urls.add(setting.app_url.trim());
        }
      });

      // Filter out empty strings and invalid URLs
      const validUrls = Array.from(urls).filter((url) => {
        if (!url) return false;
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      });

      console.info(`Found ${validUrls.length} unique URLs from settings`);
      return validUrls;
    } catch (error) {
      console.error("Error getting settings URLs:", error);
      return []; // Return empty array on error, don't break CORS
    }
  }
}

// Create and export singleton instance
const settingsService = new SettingsService();
export default settingsService;
