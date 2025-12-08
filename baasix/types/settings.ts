/**
 * Settings Types
 * Types for application and tenant settings
 */

/**
 * Tenant-specific settings interface
 */
export interface TenantSettings {
  [key: string]: any;
  tenant_Id?: string | number | null;
  project_name?: string;
  title?: string;
  project_url?: string | null;
  app_url?: string | null;
  project_color?: string;
  secondary_color?: string;
  description?: string;
  keywords?: string;
  from_email_name?: string;
  smtp_enabled?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_from_address?: string;
  timezone?: string;
  language?: string;
  date_format?: string;
  currency?: string;
  email_signature?: string;
  email_icon?: any;
  metadata?: Record<string, any>;
  modules?: Record<string, any>;
}
