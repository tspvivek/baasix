/**
 * Socket Service Types
 * Types for WebSocket connections
 */

import type { Socket } from 'socket.io';

/**
 * User information for socket connections
 */
export interface UserInfo {
  user: { id: string | number };
  role: any;
  permissions: any;
  tenant: any;
}

/**
 * Socket with authentication data
 */
export interface SocketWithAuth extends Socket {
  userId?: string | number;
  userRole?: any;
  userPermissions?: any;
  userTenant?: any;
}
