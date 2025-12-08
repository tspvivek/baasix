/**
 * Dynamic Variable Resolver
 * 
 * TODO: Full implementation
 * This is a stub that provides the interface expected by ItemsService
 */

/**
 * Resolve dynamic variables in filter objects
 * e.g., $CURRENT_USER -> actual user ID
 */
import ItemsService from "../services/ItemsService.js";

import type { Accountability } from '../types/index.js';

// Re-export for backward compatibility
export type { Accountability };

/**
 * Helper function to resolve NOW variables with relative date calculations
 * Supports: $NOW, $NOW+DAYS_7, $NOW-HOURS_2, etc.
 */
function resolveNowVariable(variable: string): string {
  const now = new Date();

  // Handle basic $NOW
  if (variable === "NOW") {
    return now.toISOString();
  }

  // Parse relative date expressions like $NOW+DAYS_7, $NOW-HOURS_2, etc.
  const match = variable.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/);
  if (!match) {
    // If it doesn't match the pattern, return current timestamp
    return now.toISOString();
  }

  const [, operator, unit, amount] = match;
  const value = parseInt(amount, 10);
  const multiplier = operator === '+' ? 1 : -1;

  // Calculate the offset in milliseconds
  let offsetMs = 0;
  switch (unit.toLowerCase().replace(/s$/, '')) { // Remove plural 's'
    case 'year':
      offsetMs = value * 365 * 24 * 60 * 60 * 1000;
      break;
    case 'month':
      offsetMs = value * 30 * 24 * 60 * 60 * 1000; // Approximate month as 30 days
      break;
    case 'week':
      offsetMs = value * 7 * 24 * 60 * 60 * 1000;
      break;
    case 'day':
      offsetMs = value * 24 * 60 * 60 * 1000;
      break;
    case 'hour':
      offsetMs = value * 60 * 60 * 1000;
      break;
    case 'minute':
      offsetMs = value * 60 * 1000;
      break;
    case 'second':
      offsetMs = value * 1000;
      break;
    default:
      return now.toISOString();
  }

  // Apply the offset
  const resultDate = new Date(now.getTime() + (multiplier * offsetMs));
  return resultDate.toISOString();
}

/**
 * Collect all variables that need to be resolved from the object
 */
function collectVariables(obj: any, variablesToResolve: Record<string, Set<string>>): void {
  if (typeof obj === "string" && obj.startsWith("$")) {
    const [target, ...parts] = obj.slice(1).split(".");
    if (target === "CURRENT_USER" || target === "CURRENT_ROLE") {
      const field = parts.length > 0 ? parts.join(".") : "id";
      variablesToResolve[target].add(field);
    } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
      if (!variablesToResolve[target]) {
        variablesToResolve[target] = new Set();
      }
      variablesToResolve[target].add("value");
    }
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => {
      if (typeof item === "string" && item.startsWith("$")) {
        const [target, ...parts] = item.slice(1).split(".");
        if (target === "CURRENT_USER" || target === "CURRENT_ROLE") {
          const field = parts.length > 0 ? parts.join(".") : "id";
          variablesToResolve[target].add(field);
        } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
          if (!variablesToResolve[target]) {
            variablesToResolve[target] = new Set();
          }
          variablesToResolve[target].add("value");
        }
      } else {
        collectVariables(item, variablesToResolve);
      }
    });
    return;
  }

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      // Check keys for variables
      if (key.startsWith("$")) {
        const [target, ...parts] = key.slice(1).split(".");
        if (target === "CURRENT_USER" || target === "CURRENT_ROLE") {
          const field = parts.length > 0 ? parts.join(".") : "id";
          variablesToResolve[target].add(field);
        } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
          if (!variablesToResolve[target]) {
            variablesToResolve[target] = new Set();
          }
          variablesToResolve[target].add("value");
        }
      }

      // Check values recursively
      collectVariables(value, variablesToResolve);
    }
  }
}

/**
 * Resolve collected variables by fetching user/role data and calculating dates
 */
async function resolveCollectedVariables(
  variablesToResolve: Record<string, Set<string>>,
  accountability: Accountability
): Promise<Record<string, any>> {
  const resolved: Record<string, any> = {
    CURRENT_USER: {},
    CURRENT_ROLE: {},
    NOW: {},
  };

  if (!accountability?.user?.id) {
    return resolved;
  }

  if (variablesToResolve.CURRENT_USER.size > 0) {
    const userItemsService = new ItemsService("baasix_User", { accountability: undefined });
    const fields = Array.from(variablesToResolve.CURRENT_USER);
    try {
      resolved.CURRENT_USER = await userItemsService.readOne(accountability.user.id, {
        fields: fields
      });
    } catch (error: any) {
      console.error(`Error resolving user data: ${error.message}`);
    }
  }

  if (variablesToResolve.CURRENT_ROLE.size > 0 && accountability.role) {
    const roleItemsService = new ItemsService("baasix_Role", { accountability: undefined });
    const fields = Array.from(variablesToResolve.CURRENT_ROLE);
    try {
      const roleId = typeof accountability.role === 'object' ? accountability.role.id : accountability.role;
      resolved.CURRENT_ROLE = await roleItemsService.readOne(roleId, {
        fields: fields
      });
    } catch (error: any) {
      console.error(`Error resolving role data: ${error.message}`);
    }
  }

  // Resolve NOW variables (including relative dates)
  for (const nowVariable of Object.keys(variablesToResolve)) {
    if (nowVariable.startsWith("NOW")) {
      resolved[nowVariable] = { value: resolveNowVariable(nowVariable) };
    }
  }

  return resolved;
}

/**
 * Get nested value from object using dot-notation path
 */
function getNestedValue(obj: any, path: string[]): any {
  if (!obj) return null;
  return path.reduce((current, part) => (current && current[part] !== undefined ? current[part] : null), obj);
}

/**
 * Replace variables in the object with resolved values
 */
function replaceVariables(obj: any, resolvedVariables: Record<string, any>): any {
  if (typeof obj === "string" && obj.startsWith("$")) {
    const [target, ...parts] = obj.slice(1).split(".");
    if (target === "CURRENT_USER" || target === "CURRENT_ROLE") {
      const field = parts.length > 0 ? parts.join(".") : "id";
      const value = getNestedValue(resolvedVariables[target], field.split("."));
      return value;
    } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
      const value = resolvedVariables[target]?.value;
      return value;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => replaceVariables(item, resolvedVariables));
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      let newKey = key;
      if (key.startsWith("$")) {
        const [target, ...parts] = key.slice(1).split(".");
        if (target === "CURRENT_USER" || target === "CURRENT_ROLE") {
          // For key replacements, we typically want to keep the path structure
          newKey = parts.join(".");
        } else if (target === "NOW" || target.match(/^NOW([+-])(YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)_(\d+)$/)) {
          // For NOW, we replace with the timestamp value directly
          newKey = resolvedVariables[target]?.value;
        }
      }
      result[newKey] = replaceVariables(value, resolvedVariables);
    }
    return result;
  }

  return obj;
}

/**
 * Main function to resolve dynamic variables in an object
 * Supports: $CURRENT_USER.field, $CURRENT_ROLE.field, $NOW, $NOW+DAYS_7, etc.
 */
export async function resolveDynamicVariables(
  obj: any,
  accountability: Accountability
): Promise<any> {
  const variablesToResolve: Record<string, Set<string>> = {
    CURRENT_USER: new Set(),
    CURRENT_ROLE: new Set(),
    NOW: new Set(),
  };

  // First pass: collect all variables that need to be resolved
  collectVariables(obj, variablesToResolve);

  // Resolve all collected variables
  const resolvedVariables = await resolveCollectedVariables(variablesToResolve, accountability);

  // Second pass: replace variables with resolved values
  return replaceVariables(obj, resolvedVariables);
}
