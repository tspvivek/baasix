import { Request } from "express";

declare global {
  namespace Express {
    export interface Request {
      accountability?: {
        user?: {
          id: string;
          email: string;
          role: string;
        };
        role?: string;
        tenant?: string;
        permissions?: any[];
        ipaddress?: string;
      };
    }
  }
}
