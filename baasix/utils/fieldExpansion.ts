import { schemaManager } from './schemaManager.js';
import { relationBuilder } from './relationUtils.js';

/**
 * Field Expansion Utility
 * 
 * Matches Sequelize implementation 1:1
 */

export class FieldExpansionUtil {
  /**
   * Expand field selectors like ["*", "author.*", "-password"]
   */
  static expandFields(fields: string[], collectionName: string): string[] {
    let expandedFields: string[] = [];

    try {
      const table = schemaManager.getTable(collectionName);
      const tableColumns = (table as any).$inferSelect ? Object.keys((table as any).$inferSelect) : [];

      for (const field of fields) {
        if (field === '*') {
          // Wildcard - add all direct fields
          expandedFields.push(...tableColumns);
        } else if (field.includes('*')) {
          // Wildcard field like "author.*"
          this.expandWildcardField(field, collectionName, expandedFields);
        } else {
          // Direct field
          expandedFields.push(field);
        }
      }

      // Remove duplicates
      expandedFields = [...new Set(expandedFields)];
      
      // Remove redundant fields
      return this.removeRedundantFields(expandedFields);
    } catch (error) {
      console.error(`Error expanding fields for ${collectionName}:`, error);
      return fields;
    }
  }

  /**
   * Expand wildcard field patterns
   */
  private static expandWildcardField(
    field: string,
    collectionName: string,
    expandedFields: string[],
    prefix: string = ''
  ): void {
    const parts = field.split('.');
    
    try {
      let currentCollection = collectionName;
      let currentPrefix = prefix;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        
        if (part === '*') {
          // Get all fields at this level
          const table = schemaManager.getTable(currentCollection);
          const tableColumns = (table as any).$inferSelect ? Object.keys((table as any).$inferSelect) : [];
          
          if (i === parts.length - 1) {
            // Last part is wildcard - expand all fields at this level
            expandedFields.push(...tableColumns.map((attr) => `${currentPrefix}${attr}`));
          } else {
            // Intermediate wildcard - expand fields and recurse for associations
            expandedFields.push(...tableColumns.map((attr) => `${currentPrefix}${attr}`));
            
            // Expand associations
            const associations = relationBuilder.getAssociations(currentCollection);
            if (associations) {
              for (const [associationName, association] of Object.entries(associations)) {
                this.expandWildcardField(
                  parts.slice(i + 1).join('.'),
                  association.model,
                  expandedFields,
                  `${currentPrefix}${associationName}.`
                );
              }
            }
          }
          break;
        } else {
          // Check if it's a field or association
          const table = schemaManager.getTable(currentCollection);
          const tableColumns = (table as any).$inferSelect ? Object.keys((table as any).$inferSelect) : [];
          
          if (tableColumns.includes(part)) {
            // It's a field
            expandedFields.push(currentPrefix + part);
            break;
          } else {
            // Check if it's an association
            const associations = relationBuilder.getAssociations(currentCollection);
            const association = associations?.[part];
            
            if (association) {
              currentPrefix += part + '.';
              currentCollection = association.model;
              
              if (i === parts.length - 1) {
                // Last part is an association - include all its fields
                const assocTable = schemaManager.getTable(currentCollection);
                const assocColumns = (assocTable as any).$inferSelect ? Object.keys((assocTable as any).$inferSelect) : [];
                expandedFields.push(...assocColumns.map((attr) => `${currentPrefix}${attr}`));
              }
            } else {
              // Not a field or association - add as-is (might be computed field)
              expandedFields.push(currentPrefix + part);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error expanding wildcard field ${field}:`, error);
    }
  }

  /**
   * Remove redundant fields (e.g., if we have "author" and "author.name", keep only "author")
   */
  private static removeRedundantFields(fields: string[]): string[] {
    return fields.filter(
      (field, index, self) =>
        index === self.findIndex((t) => t === field || t.startsWith(`${field}.`))
    );
  }

  /**
   * Check if a field should be included based on selectors
   */
  static shouldIncludeField(field: string, selectors: string[]): boolean {
    // If wildcard is present, include all fields unless explicitly excluded
    if (selectors.includes('*')) {
      // Check for exclusions (fields starting with -)
      const exclusions = selectors.filter((s) => s.startsWith('-')).map((s) => s.substring(1));
      return !exclusions.includes(field);
    }

    // Check if field is in selectors
    return selectors.includes(field);
  }
}

export default FieldExpansionUtil;

