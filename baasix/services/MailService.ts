import env from "../utils/env.js";
import nodemailer from "nodemailer";
import { Liquid } from "liquidjs";
import fs from "fs";
import path from "path";
import settingsService from "./SettingsService.js";
import type { MailOptions, SenderConfig, TenantTransporter } from '../types/index.js';
import { getBaasixPath, getProjectPath } from "../utils/dirname.js";

class MailService {
  private senders: Record<string, SenderConfig> = {};
  private tenantTransporters: Map<string | number, TenantTransporter> = new Map();
  private defaultSender: string | null = null;
  private engine: Liquid;
  private defaultTemplate: string = "";
  private defaultTemplatePath: string;
  private customTemplatesPath: string;
  private defaultLogoPath: string;
  private customLogoPath: string;
  private logo: Buffer | null = null;
  private initialized: boolean = false;

  constructor() {
    this.engine = new Liquid();
    // Default templates bundled with package
    this.defaultTemplatePath = getBaasixPath("templates/mails/default.liquid");
    this.defaultLogoPath = getBaasixPath("templates/logo/logo.png");
    // Custom templates in user's project directory
    this.customTemplatesPath = getProjectPath("extensions/baasix-templates/mails");
    this.customLogoPath = getProjectPath("extensions/baasix-templates/logo/logo.png");
    // Note: initialize() is now called explicitly from app.ts, not in constructor
  }

  async initialize(): Promise<void> {
    // Prevent double initialization
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    const sendersEnabled = this.getSendersEnabled();

    if (sendersEnabled.length === 0) {
      console.warn("No mail senders enabled. Check your MAIL_SENDERS_ENABLED environment variable.");
      return;
    }

    for (const sender of sendersEnabled) {
      await this.initializeSender(sender);
    }

    this.defaultSender = env.get("MAIL_DEFAULT_SENDER") || sendersEnabled[0];

    this.loadDefaultTemplate();
    this.loadLogo();
    console.info("Mail Service Initialization Complete");
    console.info("Default Sender:", this.defaultSender);
    console.info("------------------------------");
  }

  getSendersEnabled(): string[] {
    const sendersEnabledString = env.get("MAIL_SENDERS_ENABLED");

    console.info("Senders Enabled:", sendersEnabledString);

    if (!sendersEnabledString) {
      console.warn("MAIL_SENDERS_ENABLED is not defined in the environment variables.");
      return [];
    }
    return sendersEnabledString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async initializeSender(sender: string): Promise<void> {
    const senderUpper = sender.toUpperCase();
    const host = env.get(`${senderUpper}_SMTP_HOST`);
    const port = env.get(`${senderUpper}_SMTP_PORT`);
    const secure = env.get(`${senderUpper}_SMTP_SECURE`) === "true";
    const user = env.get(`${senderUpper}_SMTP_USER`);
    const pass = env.get(`${senderUpper}_SMTP_PASS`);
    const from = env.get(`${senderUpper}_FROM_ADDRESS`);

    if (!host || !port || !user || !pass || !from) {
      console.warn(`Incomplete configuration for sender ${sender}. Skipping.`);
      return;
    }

    this.senders[sender] = {
      transporter: nodemailer.createTransport({
        host,
        port: parseInt(port),
        secure,
        auth: { user, pass },
      }),
      from,
    };

    console.info(`Initialized mail sender: ${sender}`);
  }

  loadDefaultTemplate(): void {
    try {
      this.defaultTemplate = fs.readFileSync(this.defaultTemplatePath, "utf8");
      console.log("Default template loaded successfully");
    } catch (error) {
      console.error("Error loading default template:", error);
      this.defaultTemplate = "<html><body>{{content}}</body></html>"; // Fallback template
    }
  }

  loadLogo(): void {
    try {
      const logoPath = fs.existsSync(this.customLogoPath) ? this.customLogoPath : this.defaultLogoPath;
      this.logo = fs.readFileSync(logoPath);

      console.info("Logo loaded successfully");
    } catch (error) {
      console.error("Error loading logo:", error);
      this.logo = null;
    }
  }

  async getTemplate(templateName: string): Promise<string> {
    const customTemplatePath = path.join(this.customTemplatesPath, `${templateName}.liquid`);

    if (fs.existsSync(customTemplatePath)) {
      return fs.readFileSync(customTemplatePath, "utf8");
    }

    return this.defaultTemplate;
  }

  async renderTemplate(templateName: string, context: Record<string, any>): Promise<string> {
    const template = await this.getTemplate(templateName);
    return this.engine.parseAndRender(template, context);
  }

  /**
   * Get or create tenant-specific transporter
   */
  async getTenantTransporter(tenantId: string | number): Promise<TenantTransporter | null> {
    if (!tenantId) {
      return null;
    }

    // Check cache first
    if (this.tenantTransporters.has(tenantId)) {
      return this.tenantTransporters.get(tenantId)!;
    }

    try {
      const smtpConfig = await settingsService.getTenantSMTPConfig(tenantId);

      if (!smtpConfig) {
        // No tenant-specific SMTP config, use default
        return null;
      }

      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: smtpConfig.auth,
      });

      const tenantTransporter: TenantTransporter = {
        transporter,
        from: smtpConfig.from,
        fromName: smtpConfig.fromName,
      };

      // Cache the transporter
      this.tenantTransporters.set(tenantId, tenantTransporter);

      console.info(`Created tenant-specific transporter for tenant: ${tenantId}`);
      return tenantTransporter;
    } catch (error) {
      console.error(`Error creating tenant transporter for ${tenantId}:`, error);
      return null;
    }
  }

  /**
   * Invalidate tenant transporter cache
   */
  invalidateTenantTransporter(tenantId?: string | number): void {
    if (tenantId) {
      this.tenantTransporters.delete(tenantId);
      console.info(`Tenant transporter cache invalidated for: ${tenantId}`);
    } else {
      // Clear all tenant transporters
      this.tenantTransporters.clear();
      console.info("All tenant transporter cache cleared");
    }
  }

  async sendMail(options: MailOptions): Promise<any> {
    const { to, subject, templateName, context, from, sender = this.defaultSender, attachments, tenantId } = options;

    let transporter: nodemailer.Transporter | null = null;
    let defaultFrom: string = "";
    let finalSender: string = "";

    // Try to use tenant-specific transporter first
    if (tenantId) {
      const tenantTransporter = await this.getTenantTransporter(tenantId);
      if (tenantTransporter) {
        transporter = tenantTransporter.transporter;
        defaultFrom = tenantTransporter.from;
        finalSender = `tenant-${tenantId}`;
        console.info(`Using tenant-specific SMTP for tenant: ${tenantId}`);
      }
    }

    // Fall back to global senders if no tenant-specific config
    if (!transporter) {
      if (!sender || !this.senders[sender]) {
        throw new Error(`Mail sender "${sender}" not configured.`);
      }
      const senderConfig = this.senders[sender];
      transporter = senderConfig.transporter;
      defaultFrom = senderConfig.from;
      finalSender = sender;
    }

    try {
      const customContext: Record<string, any> = {};
      let logo_type = "file";
      let useTenantSettings = false;

      // Get tenant-specific branding if tenantId is provided
      if (tenantId) {
        try {
          const tenantBranding = await settingsService.getTenantEmailBranding(tenantId);

          customContext.email_signature = tenantBranding.email_signature;
          customContext.project_name = tenantBranding.project_name;
          customContext.project_color = tenantBranding.project_color;
          customContext.app_url = tenantBranding.app_url;
          customContext.project_url = tenantBranding.project_url;

          if (tenantBranding.logo_url) {
            customContext.logo_url = tenantBranding.logo_url;
            logo_type = "url";
          } else {
            customContext.logo_url = "cid:logo";
          }
          useTenantSettings = true;
        } catch (error: any) {
          console.warn(`Error loading tenant branding for ${tenantId}, falling back to global settings:`, error.message);
        }
      }

      // Use global settings if no tenant-specific config
      if (!useTenantSettings) {
        const settings = settingsService.getSettings();
        if (settings?.email_signature) {
          customContext.email_signature = settings.email_signature;
        }

        if (settings?.project_name) {
          customContext.project_name = settings.project_name;
        }

        if (settings?.email_icon && settings?.project_url) {
          customContext.logo_url = settings.project_url + "/assets/email_icon";
          logo_type = "url";
        } else {
          customContext.logo_url = "cid:logo";
        }

        if (settings?.project_color) {
          customContext.project_color = settings.project_color;
        }

        if (settings?.app_url) {
          customContext.app_url = settings.app_url;
        }

        if (settings?.project_url) {
          customContext.project_url = settings.project_url;
        }
      }

      const html = await this.renderTemplate(templateName, { ...customContext, ...context });

      const mailOptions: nodemailer.SendMailOptions = {
        from: from || defaultFrom,
        to,
        subject,
        html,
        attachments: attachments || [],
      };

      if (this.logo && logo_type === "file") {
        mailOptions.attachments!.push({
          filename: "logo.png",
          content: this.logo,
          cid: "logo",
        });
      }

      const info = await transporter.sendMail(mailOptions);
      console.log(`Message sent via ${finalSender}: ${info.messageId}`);

      // Log email sent event
      this.logEmail({
        email: to,
        subject,
        templateName,
        sender: finalSender,
        tenantId: tenantId || null,
        status: "sent",
        messageId: info.messageId,
      });

      return info;
    } catch (error: any) {
      console.error("Error sending email:", error);

      // Log email error event
      this.logEmail({
        email: to,
        subject,
        templateName,
        sender: finalSender || sender || '',
        tenantId: tenantId || null,
        status: "error",
        errorMessage: error.message,
      });

      throw error;
    }
  }

  /**
   * Log email to database asynchronously (fire and forget)
   */
  private logEmail(logData: {
    email: string;
    subject: string;
    templateName: string;
    sender: string;
    tenantId: string | number | null;
    status: string;
    messageId?: string;
    errorMessage?: string;
  }): void {
    // Import ItemsService dynamically to avoid circular dependency
    import('./ItemsService.js').then(({ default: ItemsService }) => {
      const emailLogService = new ItemsService('baasix_EmailLog', {
        accountability: undefined, // System operation, bypass permissions
      });

      emailLogService.createOne({
        email: logData.email,
        subject: logData.subject,
        templateName: logData.templateName,
        sender: logData.sender,
        status: logData.status,
        messageId: logData.messageId || null,
        errorMessage: logData.errorMessage || null,
      }, { bypassPermissions: true }).catch((error: any) => {
        console.error('Error logging email to database:', error.message);
      });
    }).catch((error: any) => {
      console.error('Error importing ItemsService for email logging:', error.message);
    });
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_mailService: MailService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_mailService) {
  globalThis.__baasix_mailService = new MailService();
}

const mailService = globalThis.__baasix_mailService;

export default mailService;
