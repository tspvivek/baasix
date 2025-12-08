# Virtual Fields Quick Reference

## Basic Syntax

```typescript
{
  fieldName: {
    type: "VIRTUAL",
    calculated: "SQL_EXPRESSION_HERE"
  }
}
```

## Common Patterns

### String Concatenation
```sql
-- Concat with space
"first_name || ' ' || last_name"

-- Concat with NULL handling
"COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')"

-- Concat with separator
"street || ', ' || city || ' ' || zip_code"
```

### Math Operations
```sql
-- Basic arithmetic
"price * quantity"
"(price * quantity) * (1 - discount / 100.0)"

-- Rounding
"ROUND(price * 1.08, 2)"  -- Round to 2 decimals

-- Percentage
"(completed / total) * 100"
```

### Conditional (CASE)
```sql
-- Simple condition
"CASE WHEN age >= 18 THEN 'Adult' ELSE 'Minor' END"

-- Multiple conditions
"CASE 
  WHEN score >= 90 THEN 'A'
  WHEN score >= 80 THEN 'B'
  WHEN score >= 70 THEN 'C'
  ELSE 'F'
END"

-- Boolean to text
"CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END"
```

### Date/Time
```sql
-- Age in years
"EXTRACT(YEAR FROM AGE(birth_date))"

-- Days since
"EXTRACT(DAY FROM (CURRENT_DATE - created_at))"

-- Year
"EXTRACT(YEAR FROM created_at)"

-- Month name
"TO_CHAR(created_at, 'Month')"

-- Format date
"TO_CHAR(created_at, 'YYYY-MM-DD')"
```

### String Functions
```sql
-- Uppercase
"UPPER(name)"

-- Lowercase  
"LOWER(email)"

-- Title case
"INITCAP(name)"

-- Substring
"SUBSTRING(text, 1, 10)"  -- First 10 chars

-- Length
"LENGTH(description)"

-- Extract email domain
"SUBSTRING(email FROM POSITION('@' IN email) + 1)"
```

### NULL Handling
```sql
-- Provide default for NULL
"COALESCE(middle_name, '')"
"COALESCE(discount, 0)"

-- NULL if condition
"NULLIF(value, 0)"  -- Returns NULL if value is 0
```

### JSON Operations
```sql
-- Get JSON text value
"settings->>'language'"

-- Get JSON numeric value
"(settings->>'age')::integer"

-- Get nested JSON
"data->'user'->>'name'"

-- With default
"COALESCE(settings->>'theme', 'light')"
```

### Numeric Functions
```sql
-- Absolute value
"ABS(balance)"

-- Ceiling/Floor
"CEIL(price)"
"FLOOR(price)"

-- Min/Max of columns
"GREATEST(price1, price2, price3)"
"LEAST(price1, price2, price3)"
```

### Boolean Logic
```sql
-- AND condition
"quantity > 0 AND price > 0"

-- OR condition  
"is_member OR has_discount"

-- NOT
"NOT is_deleted"
```

## Column Name Format

❌ **Wrong:** Use camelCase
```sql
"firstName || ' ' || lastName"  -- Won't work!
```

✅ **Correct:** Use snake_case (database column names)
```sql
"first_name || ' ' || last_name"  -- Works!
```

## Common Mistakes

### 1. String Concatenation with NULL
```sql
-- ❌ Returns NULL if last_name is NULL
"first_name || ' ' || last_name"

-- ✅ Handles NULL properly
"COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')"
```

### 2. Integer Division
```sql
-- ❌ Integer division (5 / 2 = 2)
"total / count"

-- ✅ Decimal division
"total / count::decimal"
"total / CAST(count AS DECIMAL)"
```

### 3. Date Arithmetic
```sql
-- ❌ Wrong
"CURRENT_DATE - 30"  -- Subtracts 30 days directly

-- ✅ Correct
"CURRENT_DATE - INTERVAL '30 days'"
```

## PostgreSQL Resources

- **Data Types:** text, integer, decimal, boolean, date, timestamp, json
- **String Functions:** https://www.postgresql.org/docs/current/functions-string.html
- **Math Functions:** https://www.postgresql.org/docs/current/functions-math.html
- **Date Functions:** https://www.postgresql.org/docs/current/functions-datetime.html
- **Conditional:** https://www.postgresql.org/docs/current/functions-conditional.html

## Testing SQL Expressions

Test in PostgreSQL before adding to schema:
```sql
-- Test the expression directly
SELECT 
  first_name,
  last_name,
  COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') as full_name
FROM baasix_user
LIMIT 5;
```

## Performance Tips

1. **Keep it simple** - Complex expressions can slow queries
2. **Use STORED** - Default behavior, faster for reads
3. **Add indexes** - Index computed columns used in WHERE/ORDER BY
4. **Test with data** - Verify expressions work with real data
5. **Handle NULLs** - Always use COALESCE for concatenation

## Example Schemas

See `/examples/virtual-fields-usage.js` for complete examples.
