# Baasix Type Definitions

This directory contains centralized TypeScript type definitions for the Baasix API. All types have been organized into logical modules for better maintainability and reusability.

## Directory Structure

```
types/
├── index.ts              # Main export file - re-exports all types
├── aggregation.ts        # Aggregation and grouping types
├── auth.ts               # Authentication and authorization types
├── cache.ts              # Cache adapter and configuration types
├── database.ts           # Database and transaction types
├── fields.ts             # Field information and schema types
├── import-export.ts      # Import/export operation types
├── query.ts              # Query, filter, and pagination types
├── relations.ts          # Relation and association types
├── schema.ts             # Schema validation types
├── seed.ts               # Database seeding types
├── services.ts           # Service layer types
├── sort.ts               # Sorting and ordering types
├── spatial.ts            # Spatial/GIS types
└── workflow.ts           # Workflow types
```

## Usage

### Importing Types

All types can be imported from the central index file:

```typescript
import type {
  QueryOptions,
  FilterObject,
  ProcessedInclude,
  AssociationType,
  AggregateMapping
} from '../types';
```

Or from specific modules:

```typescript
import type { QueryOptions, ReadResult } from '../types/services';
import type { FilterObject, PaginationMetadata } from '../types/query';
import type { AssociationType, RelationType } from '../types/relations';
```

## Type Categories

### Aggregation Types (`aggregation.ts`)
- `AggregateFunction` - Aggregate function types (count, sum, avg, etc.)
- `AggregateConfig` - Aggregate configuration
- `AggregateMapping` - Aggregate result mapping
- `AggregateContext` - Context for building aggregates
- `DatePart` - Date part extraction types
- `DateTruncPrecision` - Date truncation precision types

### Authentication Types (`auth.ts`)
- `JWTPayload` - JWT token payload
- `UserWithRolesAndPermissions` - User with roles and permissions
- `Accountability` - Accountability object for tracking user context

### Cache Types (`cache.ts`)
- `CacheConfig` - Cache configuration
- `CacheEntry` - Cache entry structure
- `CacheStrategy` - Cache strategy type
- `ICacheAdapter` - Base cache adapter interface

### Database Types (`database.ts`)
- `Transaction` - Transaction wrapper with commit/rollback
- Note: `TransactionClient` remains in `db.ts` due to circular dependency

### Field Types (`fields.ts`)
- `FieldInfo` - Field information
- `FlattenedField` - Flattened field representation
- `FieldSchema` - Field schema definition

### Import/Export Types (`import-export.ts`)
- `UploadedFile` - Uploaded file interface
- `ImportOptions` - Import operation options
- `ExportOptions` - Export operation options
- `ImportResult` - Import operation result
- `ExportResult` - Export operation result

### Query Types (`query.ts`)
- `FilterObject` - Filter object structure (Sequelize-style)
- `QueryContext` - Query building context
- `ColumnReference` - Column reference format
- `FilterValue` - Filter operator value types
- `OperatorContext` - Operator context
- `OperatorName` - Operator name type
- `PaginationOptions` - Pagination options
- `PaginationMetadata` - Pagination metadata

### Relation Types (`relations.ts`)
- `AssociationType` - Association types (HasMany, BelongsTo, etc.)
- `RelationType` - Relation types
- `AssociationDefinition` - Association definition
- `IncludeConfig` - Include configuration for loading relations
- `ProcessedInclude` - Processed include with join information
- `ExpandedFieldsResult` - Field expansion result
- `JoinDefinition` - Join definition
- `ResolvedPath` - Resolved relation path
- `RelationalResult` - Relational data processing result

### Schema Types (`schema.ts`)
- `ValidationResult` - Validation result
- `FieldValidation` - Field validation result
- `SchemaValidation` - Schema validation result

### Seed Types (`seed.ts`)
- `SeedData` - Seed data interface
- `SeedResult` - Seed operation result

### Service Types (`services.ts`)
- `QueryOptions` - Query options for read operations
- `ServiceParams` - Service construction parameters
- `OperationOptions` - Write operation options
- `ReadResult` - Read operation result
- `PermissionFilter` - Permission filter
- `HookContext` - Hook context
- `HookFunction` - Hook function type

### Sort Types (`sort.ts`)
- `SortDirection` - Sort direction (ASC/DESC)
- `SortObject` - Sort object structure
- `SortContext` - Sort query context

### Spatial Types (`spatial.ts`)
- `GeoJSONPoint` - GeoJSON point interface
- `GeoJSONGeometry` - GeoJSON geometry interface

### Workflow Types (`workflow.ts`)
- `Workflow` - Workflow interface

## Migration Notes

### Breaking Changes
- Type imports from utility files (e.g., `utils/relationLoader`) should now import from `types/`
- Some types use `any` to avoid circular dependencies (documented in comments)

### Backward Compatibility
- All original type exports remain in their source files for gradual migration
- New code should import from `types/` folder
- Legacy code will continue to work but should be migrated over time

## Best Practices

1. **Always use type imports**: Use `import type { ... }` instead of `import { ... }` for types
2. **Import from index**: Prefer importing from `types/` index for better tree-shaking
3. **Avoid circular dependencies**: If types need to reference each other, use `any` with comments
4. **Document complex types**: Add JSDoc comments for non-obvious type definitions
5. **Keep types DRY**: Reuse existing types instead of creating duplicates

## Future Improvements

- Consider splitting large type files into smaller modules
- Add utility types for common patterns
- Create type guards for runtime type checking
- Add branded types for improved type safety
- Consider generating types from JSON schemas
