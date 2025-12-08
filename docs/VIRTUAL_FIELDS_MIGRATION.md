# Virtual Fields Migration Guide

## Current Status

✅ **Implementation Complete** - The code for SQL-based virtual fields is fully implemented in `typeMapper.ts`  
⚠️ **Migration Required** - Existing database tables need to be updated to include generated columns

## What Works

The virtual fields implementation is ready and will work for:
- ✅ **New tables** created after this implementation
- ✅ **New schemas** added to the system
- ✅ **Fresh database** installations

## What Needs Migration

Existing tables like `baasix_User` need database migration to add the `fullName` generated column:

```sql
-- Current state: fullName column doesn't exist in database
SELECT column_name, is_generated
FROM information_schema.columns 
WHERE table_name = 'baasix_User';

-- Need to add: 
ALTER TABLE "baasix_User" 
ADD COLUMN fullName TEXT 
GENERATED ALWAYS AS (
  COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')
) STORED;
```

## Migration Options

### Option 1: Manual SQL Migration (Recommended for Production)

Create a migration file to add generated columns:

```sql
-- Migration: add_virtual_fields.sql
ALTER TABLE "baasix_User" 
ADD COLUMN IF NOT EXISTS fullName TEXT 
GENERATED ALWAYS AS (
  COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')
) STORED;

-- Add indexes if needed
CREATE INDEX IF NOT EXISTS idx_users_fullName ON "baasix_User"(fullName);
```

### Option 2: Recreate Tables (Development Only)

**⚠️ WARNING: This will delete all data!**

```bash
# Drop and recreate all tables
npm run db:reset
```

### Option 3: Schema Sync (If Implemented)

If you have a schema sync command:

```bash
npm run db:sync
```

## How to Migrate

### Step 1: Backup Your Database

```bash
pg_dump your_database > backup_before_virtual_fields.sql
```

### Step 2: Create Migration Script

Create `migrations/add_virtual_fields.sql`:

```sql
-- Add fullName to baasix_User
ALTER TABLE "baasix_User" 
ADD COLUMN IF NOT EXISTS fullName TEXT 
GENERATED ALWAYS AS (
  COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')
) STORED;

-- Add other virtual fields as needed
-- ALTER TABLE "your_table"
-- ADD COLUMN computed_field TYPE
-- GENERATED ALWAYS AS (expression) STORED;
```

### Step 3: Run Migration

```bash
psql your_database < migrations/add_virtual_fields.sql
```

### Step 4: Verify

```sql
-- Check if column was added
SELECT column_name, is_generated, generation_expression
FROM information_schema.columns 
WHERE table_name = 'baasix_User' AND column_name = 'fullName';

-- Test the computed field
SELECT first_name, last_name, fullName 
FROM "baasix_User" 
LIMIT 5;
```

## Testing After Migration

Once migrated, enable the skipped tests in `test/virtualFields.test.js`:

```javascript
// Change test.skip to test
test('should handle null lastName in fullName', async () => {
  // ...
});

test('should query by fullName', async () => {
  // ...
});

// etc.
```

Then run:

```bash
npm test -- virtualFields.test.js
```

All tests should pass after migration.

## For New Tables

New tables created after this implementation will automatically include virtual fields. No migration needed!

Example:

```typescript
// In your schema definition
{
  collectionName: 'products',
  schema: {
    fields: {
      price: { type: 'Decimal' },
      quantity: { type: 'Integer' },
      
      // This will automatically be created as a generated column
      total: {
        type: 'VIRTUAL',
        calculated: 'price * quantity'
      }
    }
  }
}
```

## Troubleshooting

### Column Already Exists

If you get "column already exists" error:

```sql
-- Drop the old column first
ALTER TABLE "baasix_User" DROP COLUMN IF EXISTS fullName;

-- Then add as generated column
ALTER TABLE "baasix_User" 
ADD COLUMN fullName TEXT 
GENERATED ALWAYS AS (
  COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')
) STORED;
```

### Expression Syntax Error

PostgreSQL is strict about SQL syntax. Verify your expression:

```sql
-- Test the expression first
SELECT 
  first_name,
  last_name,
  COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') as computed
FROM "baasix_User"
LIMIT 5;
```

### Can't Modify Generated Column

Generated columns are read-only. If you try to update them:

```sql
-- ❌ This will fail
UPDATE "baasix_User" SET fullName = 'New Name';

-- ✅ Update source columns instead
UPDATE "baasix_User" SET first_name = 'New', last_name = 'Name';
-- fullName is automatically updated
```

## Next Steps

1. ✅ **Code is ready** - No code changes needed
2. ⚠️ **Plan migration** - Schedule database migration
3. ⚠️ **Test in dev** - Test migration in development first
4. ⚠️ **Backup prod** - Backup production before migrating
5. ✅ **Run migration** - Execute migration script
6. ✅ **Enable tests** - Un-skip tests after migration
7. ✅ **Monitor** - Watch for any issues

## Benefits After Migration

Once migrated, you'll get:
- ✅ Computed fields automatically maintained by PostgreSQL
- ✅ Ability to filter and sort by computed fields
- ✅ Can create indexes on computed fields
- ✅ Always accurate, never stale data
- ✅ Better performance than application-level computation

## Questions?

See documentation:
- `/docs/VIRTUAL_FIELDS.md` - Full guide
- `/docs/VIRTUAL_FIELDS_QUICK_REF.md` - Quick reference
- `/examples/virtual-fields-usage.js` - Code examples
