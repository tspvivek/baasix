/**
 * Database Seeding Utility
 *
 * Provides utilities for seeding the database with initial data.
 * Useful for development, testing, and setting up new environments.
 */

import { ItemsService } from '../services/ItemsService.js';
import { schemaManager } from './schemaManager.js';
import type { SeedData, SeedResult } from '../types/index.js';

// Re-export types for backward compatibility
export type { SeedData, SeedResult };

/**
 * Seeding utility class
 */
class SeedUtility {
  /**
   * Seed a single collection
   */
  async seedCollection(options: SeedData): Promise<SeedResult> {
    const { collection, data, clearBefore = false, skipDuplicates = true } = options;
    
    const result: SeedResult = {
      collection,
      created: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
    };

    try {
      const service = new ItemsService(collection);

      // Clear existing data if requested
      if (clearBefore) {
        console.log(`[Seed] Clearing existing data in ${collection}...`);
        const existing = await service.readByQuery({});
        for (const item of existing.data) {
          await service.deleteOne(item.id, { force: true });
        }
        console.log(`[Seed] Cleared ${existing.data.length} items from ${collection}`);
      }

      // Normalize data to array
      const dataArray = Array.isArray(data) ? data : [data];

      // Get unique fields for duplicate checking
      const uniqueFields = skipDuplicates ? this.getUniqueFields(collection) : [];

      // Seed each item
      for (const item of dataArray) {
        try {
          // Check for duplicates
          if (skipDuplicates && uniqueFields.length > 0) {
            const isDuplicate = await this.checkDuplicate(service, item, uniqueFields);
            if (isDuplicate) {
              result.skipped++;
              console.log(`[Seed] Skipped duplicate in ${collection}:`, item);
              continue;
            }
          }

          // Create item
          await service.createOne(item);
          result.created++;
        } catch (error: any) {
          result.errors++;
          result.errorDetails.push({
            item,
            error: error.message,
          });
          console.error(`[Seed] Error creating item in ${collection}:`, error.message);
        }
      }

      console.log(`[Seed] Completed ${collection}: created=${result.created}, skipped=${result.skipped}, errors=${result.errors}`);
      
      return result;
    } catch (error: any) {
      console.error(`[Seed] Fatal error seeding ${collection}:`, error);
      throw error;
    }
  }

  /**
   * Seed multiple collections
   */
  async seedMultiple(seeds: SeedData[]): Promise<SeedResult[]> {
    const results: SeedResult[] = [];
    
    console.log(`[Seed] Starting to seed ${seeds.length} collections...`);
    
    for (const seed of seeds) {
      const result = await this.seedCollection(seed);
      results.push(result);
    }
    
    console.log('[Seed] All collections seeded successfully');
    
    return results;
  }

  /**
   * Get unique fields for a collection
   */
  private getUniqueFields(collection: string): string[] {
    const schema = schemaManager.getSchema(collection);
    if (!schema) {
      return [];
    }

    const uniqueFields: string[] = [];
    for (const [fieldName, fieldDef] of Object.entries(schema.columns)) {
      const fieldDefTyped = fieldDef as any;
      if (fieldDefTyped.isUnique || fieldDefTyped.primaryKey) {
        uniqueFields.push(fieldName);
      }
    }

    return uniqueFields;
  }

  /**
   * Check if item already exists based on unique fields
   */
  private async checkDuplicate(
    service: ItemsService,
    item: Record<string, any>,
    uniqueFields: string[]
  ): Promise<boolean> {
    for (const field of uniqueFields) {
      if (field in item && item[field] != null) {
        try {
          const existing = await service.readByQuery({
            filter: { [field]: item[field] },
            limit: 1,
          });
          
          if (existing.data.length > 0) {
            return true;
          }
        } catch {
          // Ignore errors
        }
      }
    }
    
    return false;
  }

  /**
   * Create seed data template for a collection
   */
  generateTemplate(collection: string, count: number = 5): Record<string, any>[] {
    const schema = schemaManager.getSchema(collection);
    if (!schema) {
      console.error(`Schema not found for collection: ${collection}`);
      return [];
    }

    const templates: Record<string, any>[] = [];
    
    for (let i = 0; i < count; i++) {
      const template: Record<string, any> = {};
      
      for (const [fieldName, fieldDef] of Object.entries(schema.columns)) {
        const fieldDefTyped = fieldDef as any;
        const dataType = fieldDefTyped.dataType;
        
        // Skip auto-increment and timestamp fields
        if (fieldDefTyped.primaryKey && fieldDefTyped.generated) continue;
        if (['createdAt', 'updatedAt', 'deletedAt'].includes(fieldName)) continue;
        
        // Generate sample data based on type
        template[fieldName] = this.generateSampleValue(fieldName, dataType, i);
      }
      
      templates.push(template);
    }
    
    return templates;
  }

  /**
   * Generate sample value for a field
   */
  private generateSampleValue(fieldName: string, dataType: string, index: number): any {
    const lowerFieldName = fieldName.toLowerCase();
    
    // Generate based on field name
    if (lowerFieldName.includes('email')) {
      return `user${index + 1}@example.com`;
    }
    if (lowerFieldName.includes('name')) {
      return `Sample Name ${index + 1}`;
    }
    if (lowerFieldName.includes('title')) {
      return `Sample Title ${index + 1}`;
    }
    if (lowerFieldName.includes('description')) {
      return `Sample description for item ${index + 1}`;
    }
    if (lowerFieldName.includes('url')) {
      return `https://example.com/item-${index + 1}`;
    }
    if (lowerFieldName.includes('phone')) {
      return `+1-555-${String(index + 1).padStart(4, '0')}`;
    }
    
    // Generate based on data type
    switch (dataType) {
      case 'string':
      case 'text':
        return `Sample ${fieldName} ${index + 1}`;
      
      case 'integer':
      case 'bigInteger':
        return index + 1;
      
      case 'float':
      case 'decimal':
        return (index + 1) * 1.5;
      
      case 'boolean':
        return index % 2 === 0;
      
      case 'date':
      case 'datetime':
      case 'timestamp':
        const date = new Date();
        date.setDate(date.getDate() + index);
        return date;
      
      case 'json':
      case 'jsonb':
        return { sample: true, index: index + 1 };
      
      case 'array':
        return [`item${index + 1}`, `value${index + 1}`];
      
      case 'uuid':
        return null; // Let database generate
      
      default:
        return null;
    }
  }

  /**
   * Print seed summary
   */
  printSummary(results: SeedResult[]): void {
    console.log('\n' + '='.repeat(60));
    console.log('SEED SUMMARY');
    console.log('='.repeat(60));
    
    let totalCreated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    for (const result of results) {
      console.log(`\n${result.collection}:`);
      console.log(`  Created: ${result.created}`);
      console.log(`  Skipped: ${result.skipped}`);
      console.log(`  Errors:  ${result.errors}`);
      
      if (result.errorDetails.length > 0) {
        console.log(`  Error Details:`);
        for (const detail of result.errorDetails.slice(0, 3)) {
          console.log(`    - ${detail.error}`);
        }
        if (result.errorDetails.length > 3) {
          console.log(`    ... and ${result.errorDetails.length - 3} more`);
        }
      }
      
      totalCreated += result.created;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    }
    
    console.log('\n' + '-'.repeat(60));
    console.log(`TOTALS:`);
    console.log(`  Collections: ${results.length}`);
    console.log(`  Created:     ${totalCreated}`);
    console.log(`  Skipped:     ${totalSkipped}`);
    console.log(`  Errors:      ${totalErrors}`);
    console.log('='.repeat(60) + '\n');
  }
}

// Export singleton instance
const seedUtility = new SeedUtility();
export default seedUtility;

// Export convenience functions
export const {
  seedCollection,
  seedMultiple,
  generateTemplate,
  printSummary,
} = seedUtility;
