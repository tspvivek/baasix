import { Express } from "express";
import mailService from "../services/MailService.js";
import { adminOnly } from "../utils/auth.js";

const registerEndpoint = (app: Express) => {
  /**
   * Get all default template types with their metadata
   * Public endpoint - returns available template types and their variables
   */
  app.get("/templates/types", async (req, res, next) => {
    try {
      const types = mailService.getDefaultTemplateTypes();
      const commonVariables = mailService.getCommonVariables();
      
      res.json({
        data: {
          types,
          commonVariables,
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get default template content for a specific type
   * Admin only - returns the default subject, body, and description
   */
  app.get("/templates/default/:type", adminOnly, async (req, res, next) => {
    try {
      const { type } = req.params;
      const template = mailService.getDefaultTemplateContent(type);
      
      if (!template) {
        return res.json({
          data: null,
          message: `No default template found for type: ${type}. This may be a custom template type.`
        });
      }
      
      // Get the type metadata if available
      const types = mailService.getDefaultTemplateTypes();
      const typeInfo = types.find(t => t.type === type);
      
      res.json({
        data: {
          type,
          label: typeInfo?.label || type,
          subject: template.subject,
          body: template.body,
          description: template.description,
          variables: typeInfo?.variables || [],
          commonVariables: mailService.getCommonVariables(),
        }
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get all default templates with their content
   * Admin only - returns all default templates for bulk initialization
   */
  app.get("/templates/defaults", adminOnly, async (req, res, next) => {
    try {
      const types = mailService.getDefaultTemplateTypes();
      const commonVariables = mailService.getCommonVariables();
      
      const templates = types.map(typeInfo => {
        const content = mailService.getDefaultTemplateContent(typeInfo.type);
        return {
          type: typeInfo.type,
          label: typeInfo.label,
          subject: content?.subject || '',
          body: content?.body || '',
          description: content?.description || typeInfo.description,
          variables: typeInfo.variables,
        };
      });
      
      res.json({
        data: {
          templates,
          commonVariables,
        }
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "templates",
  handler: registerEndpoint,
};
