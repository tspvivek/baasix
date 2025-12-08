# Virtual/Computed Fields in Drizzle Implementation

## Overview

Virtual fields (also called computed or generated fields) are database columns whose values are automatically calculated from other columns using SQL expressions. The Drizzle implementation uses PostgreSQL's `GENERATED ALWAYS AS` feature to create these fields at the database level.

## Key Differences from Sequelize

### Sequelize Approach (JavaScript-based)
```javascript
// Sequelize uses JavaScript eval() at runtime
fullName: {
  type: DataTypes.VIRTUAL,
  get() {
    return `${this.firstName} ${this.lastName}`;
  }
}
```

**Pros:**
- Flexible JavaScript expressions
- Can access complex logic

**Cons:**
- Security risk (eval)
- Computed at application layer
- Performance overhead
- Not stored in database
- Cannot query/filter by virtual fields

### Drizzle Approach (SQL-based)
```typescript
// Drizzle uses PostgreSQL generated columns with SQL expressions
fullName: {
  type: "VIRTUAL",
  calculated: "COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')"
}
```

**Pros:**
- ✅ **Database-level computation** - More reliable
- ✅ **Better performance** - Computed once, stored
- ✅ **Type-safe** - No eval security issues
- ✅ **Queryable** - Can filter/sort by computed fields
- ✅ **Indexed** - Can create indexes on generated columns
- ✅ **Transactional** - Always consistent with source data
- ✅ **Simple** - Direct SQL expressions, no conversion needed

**Cons:**
- Limited to SQL expressions (no complex JS logic)
- Requires SQL knowledge for field definitions

## How It Works

### 1. Field Definition
Define a virtual field in your schema using SQL expressions:

```typescript
{
  fullName: {
    type: "VIRTUAL",
    calculated: "COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')",
    SystemGenerated: "true"
  }
}
```

### 2. Direct SQL Usage
The `calculated` field contains a PostgreSQL expression that's used directly:

```typescript
// In typeMapper.ts
case 'VIRTUAL':
  if (fieldSchema.calculated) {
    column = text(fieldName).generatedAlwaysAs(
      sql.raw(fieldSchema.calculated)
    );
  }
```

### 3. Database Column Creation
Drizzle creates a PostgreSQL generated column:

```sql
CREATE TABLE baasix_user (
  id UUID PRIMARY KEY,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  full_name TEXT GENERATED ALWAYS AS (
    COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')
  ) STORED
);
```

### 4. Automatic Updates
Whenever `firstName` or `lastName` changes, PostgreSQL automatically updates `fullName`:

```javascript
// Update firstName
await db.update(users)
  .set({ firstName: 'Johnny' })
  .where(eq(users.id, userId));

// fullName is automatically updated to "Johnny Doe"
```

## SQL Expression Examples

### Simple Concatenation
```typescript
{
  fullName: {
    type: "VIRTUAL",
    calculated: "COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')"
  }
}
```

### Multiple Fields with Separators
```typescript
{
  fullAddress: {
    type: "VIRTUAL",
    calculated: "COALESCE(street, '') || ', ' || COALESCE(city, '') || ' ' || COALESCE(zip_code, '')"
  }
}
```

### With String Literals
```typescript
{
  displayName: {
    type: "VIRTUAL",
    calculated: "'Name: ' || COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')"
  }
}
```

### Mathematical Calculations
```typescript
{
  discountedPrice: {
    type: "VIRTUAL",
    calculated: "price * (1 - discount / 100.0)"
  }
}
```

### Conditional Logic (CASE)
```typescript
{
  ageGroup: {
    type: "VIRTUAL",
    calculated: "CASE WHEN age < 18 THEN 'Minor' WHEN age < 65 THEN 'Adult' ELSE 'Senior' END"
  }
}
```

### Date/Time Calculations
```typescript
{
  ageInYears: {
    type: "VIRTUAL",
    calculated: "EXTRACT(YEAR FROM AGE(birth_date))"
  }
}
```

### String Functions
```typescript
{
  emailDomain: {
    type: "VIRTUAL",
    calculated: "SUBSTRING(email FROM POSITION('@' IN email) + 1)"
  },
  
  initials: {
    type: "VIRTUAL",
    calculated: "UPPER(SUBSTRING(first_name, 1, 1) || SUBSTRING(last_name, 1, 1))"
  }
}
```

### JSON Field Access
```typescript
{
  settingsLanguage: {
    type: "VIRTUAL",
    calculated: "settings->>'language'"
  }
}
```

## Benefits Over Sequelize

### 1. Performance
```javascript
// Sequelize: Computed on EVERY read
const users = await User.findAll(); // Runs eval() for each user

// Drizzle: Pre-computed in database
const users = await db.select().from(usersTable); // Already calculated
```

### 2. Queryability
```javascript
// Sequelize: Cannot filter by virtual fields directly
// (virtual fields don't exist in WHERE clauses)

// Drizzle: Can filter and sort by computed fields
const results = await db
  .select()
  .from(usersTable)
  .where(like(usersTable.fullName, '%John%'))
  .orderBy(usersTable.fullName);
```

### 3. Indexing
```sql
-- Sequelize: Cannot index virtual fields (they don't exist in DB)

-- Drizzle: Can create indexes on generated columns
CREATE INDEX idx_users_full_name ON baasix_user(full_name);
```

### 4. Security
```javascript
// Sequelize: Uses eval() - security risk
get() {
  return eval(fieldSchema.calculated); // DANGEROUS!
}

// Drizzle: Pure SQL - no code execution risk
text('full_name').generatedAlwaysAs(sql`...`) // SAFE
```

### 5. Data Integrity
```javascript
// Sequelize: Virtual field may not match actual data if model instance is modified
user.firstName = 'Jane';
console.log(user.fullName); // Still shows old firstName until save

// Drizzle: Always consistent - computed by database
// When you read the data, it's always up-to-date
```

## Limitations

### SQL-Only Expressions
Only PostgreSQL SQL expressions are supported:

```javascript
// ✅ SUPPORTED: SQL expressions
{
  ageGroup: {
    type: "VIRTUAL",
    calculated: "CASE WHEN age < 18 THEN 'Minor' ELSE 'Adult' END"
  }
}

// ❌ NOT SUPPORTED: JavaScript logic
{
  ageGroup: {
    type: "VIRTUAL",
    calculated: "this.age < 18 ? 'Minor' : 'Adult'"  // Won't work!
  }
}
```

### Column Name Format
Use snake_case column names (as they exist in the database):

```javascript
// ✅ CORRECT: Use database column names
calculated: "first_name || ' ' || last_name"

// ❌ WRONG: Don't use camelCase
calculated: "firstName || ' ' || lastName"
```

## Migration from Sequelize

For existing applications migrating from Sequelize to Drizzle:

### Before (Sequelize)
```javascript
// Virtual field with JavaScript getter
fullName: {
  type: DataTypes.VIRTUAL,
  get() {
    return `${this.firstName} ${this.lastName}`;
  }
}
```

### After (Drizzle)
```typescript
// Virtual field with SQL expression
fullName: {
  type: "VIRTUAL",
  calculated: "COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')"
}
```

**Migration Steps:**
1. Convert JavaScript expressions to SQL equivalents
2. Use snake_case for column names
3. Run migration to add generated columns
4. Existing data will have computed fields automatically calculated
5. No application code changes needed!

**Conversion Guide:**
```javascript
// JavaScript → SQL
`${this.field}`                    → field
`${this.a} ${this.b}`             → COALESCE(a, '') || ' ' || COALESCE(b, '')
this.a + this.b                    → a + b
this.a * this.b                    → a * b
this.field.toUpperCase()           → UPPER(field)
this.field.toLowerCase()           → LOWER(field)
this.field.substring(0, 5)         → SUBSTRING(field, 1, 5)
this.field ? 'yes' : 'no'         → CASE WHEN field THEN 'yes' ELSE 'no' END
```

## Advanced Usage

### Null Handling
Always use `COALESCE` to handle null values gracefully:

```sql
-- Without COALESCE: If last_name is NULL, result is NULL
first_name || ' ' || last_name

-- With COALESCE: Handles NULL values properly
COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')
```

### Performance Considerations

**STORED vs VIRTUAL:**
PostgreSQL supports both storage types. By default, Drizzle creates STORED columns:

- **STORED**: Computed value is physically stored (faster reads, uses disk space)
- **VIRTUAL**: Computed on-the-fly (saves disk space, slower reads)

Current implementation uses STORED for better read performance.

### Complex Expressions
For complex calculations, break them into multiple virtual fields:

```typescript
{
  subtotal: {
    type: "VIRTUAL",
    calculated: "quantity * unit_price"
  },
  
  taxAmount: {
    type: "VIRTUAL",
    calculated: "(quantity * unit_price) * (tax_rate / 100.0)"
  },
  
  total: {
    type: "VIRTUAL",
    calculated: "(quantity * unit_price) * (1 + tax_rate / 100.0)"
  }
}
```

## Testing

Run the virtual fields test suite:

```bash
npm test -- virtualFields.test.js
```

## Example: User fullName

The system schema includes a `fullName` computed field on the `baasix_User` table:

```typescript
firstName: { type: "String", allowNull: false },
lastName: { type: "String", allowNull: true },
fullName: {
  type: "VIRTUAL",
  calculated: "COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')",
  SystemGenerated: "true"
}
```

**Database schema:**
```sql
CREATE TABLE baasix_user (
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255),
  full_name TEXT GENERATED ALWAYS AS (
    COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')
  ) STORED
);
```

**Usage:**
```javascript
// Create user
const user = await db.insert(users).values({
  firstName: 'John',
  lastName: 'Doe'
}).returning();

console.log(user.fullName); // "John Doe"

// Query by fullName
const results = await db
  .select()
  .from(users)
  .where(like(users.fullName, '%John%'));
```

## Conclusion

The SQL-based approach for virtual fields provides:
- ✅ Better performance
- ✅ Enhanced security
- ✅ Greater reliability
- ✅ Improved queryability
- ✅ Full database features (indexes, constraints, etc.)

While it sacrifices some JavaScript flexibility, the benefits far outweigh the limitations for most use cases.
