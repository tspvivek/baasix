/**
 * Mail Service Types
 * Types for email delivery system
 */

import type nodemailer from 'nodemailer';

/**
 * Mail options for sending emails
 */
export interface MailOptions {
  to: string;
  subject: string;
  templateName: string;
  context: Record<string, any>;
  from?: string;
  sender?: string;
  attachments?: any[];
  tenantId?: string | number;
}

/**
 * Sender configuration
 */
export interface SenderConfig {
  transporter: nodemailer.Transporter;
  from: string;
}

/**
 * Tenant-specific transporter configuration
 */
export interface TenantTransporter {
  transporter: nodemailer.Transporter;
  from: string;
  fromName?: string;
}
