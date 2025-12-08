/**
 * Virtual Fields Usage Examples
 * 
 * This file demonstrates how to use virtual/computed fields in BaaSix with Drizzle.
 * Virtual fields are automatically computed by PostgreSQL using SQL expressions.
 */

// Example 1: Simple String Concatenation
const userSchema = {
  collectionName: 'users',
  schema: {
    fields: {
      firstName: { type: 'String', allowNull: false },
      lastName: { type: 'String', allowNull: true },
      
      // Virtual field: Full name
      fullName: {
        type: 'VIRTUAL',
        calculated: "COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')"
      }
    }
  }
};

// Example 2: Mathematical Calculations
const orderSchema = {
  collectionName: 'orders',
  schema: {
    fields: {
      price: { type: 'Decimal', allowNull: false },
      quantity: { type: 'Integer', allowNull: false },
      discount: { type: 'Integer', defaultValue: 0 }, // Percentage
      
      // Virtual fields for calculations
      subtotal: {
        type: 'VIRTUAL',
        calculated: 'price * quantity'
      },
      
      discountAmount: {
        type: 'VIRTUAL',
        calculated: '(price * quantity) * (discount / 100.0)'
      },
      
      total: {
        type: 'VIRTUAL',
        calculated: '(price * quantity) * (1 - discount / 100.0)'
      }
    }
  }
};

// Example 3: Conditional Logic with CASE
const employeeSchema = {
  collectionName: 'employees',
  schema: {
    fields: {
      age: { type: 'Integer', allowNull: false },
      salary: { type: 'Decimal', allowNull: false },
      
      // Age group classification
      ageGroup: {
        type: 'VIRTUAL',
        calculated: `CASE 
          WHEN age < 25 THEN 'Junior'
          WHEN age < 40 THEN 'Mid-Level'
          WHEN age < 60 THEN 'Senior'
          ELSE 'Veteran'
        END`
      },
      
      // Salary tier
      salaryTier: {
        type: 'VIRTUAL',
        calculated: `CASE
          WHEN salary < 30000 THEN 'Entry Level'
          WHEN salary < 60000 THEN 'Mid Level'
          WHEN salary < 100000 THEN 'Senior Level'
          ELSE 'Executive Level'
        END`
      }
    }
  }
};

// Example 4: Date/Time Calculations
const memberSchema = {
  collectionName: 'members',
  schema: {
    fields: {
      birthDate: { type: 'Date', allowNull: false },
      joinDate: { type: 'DateTime', allowNull: false },
      
      // Calculate age in years
      ageInYears: {
        type: 'VIRTUAL',
        calculated: 'EXTRACT(YEAR FROM AGE(birth_date))'
      },
      
      // Calculate membership duration in days
      membershipDays: {
        type: 'VIRTUAL',
        calculated: 'EXTRACT(DAY FROM (CURRENT_DATE - join_date))'
      },
      
      // Birth year
      birthYear: {
        type: 'VIRTUAL',
        calculated: 'EXTRACT(YEAR FROM birth_date)'
      }
    }
  }
};

// Example 5: String Manipulation
const emailSchema = {
  collectionName: 'contacts',
  schema: {
    fields: {
      email: { type: 'String', allowNull: false },
      firstName: { type: 'String', allowNull: false },
      lastName: { type: 'String', allowNull: false },
      
      // Extract domain from email
      emailDomain: {
        type: 'VIRTUAL',
        calculated: "SUBSTRING(email FROM POSITION('@' IN email) + 1)"
      },
      
      // Username part of email
      emailUsername: {
        type: 'VIRTUAL',
        calculated: "SUBSTRING(email FROM 1 FOR POSITION('@' IN email) - 1)"
      },
      
      // Initials (uppercase)
      initials: {
        type: 'VIRTUAL',
        calculated: "UPPER(SUBSTRING(first_name, 1, 1) || SUBSTRING(last_name, 1, 1))"
      },
      
      // Display name (title case)
      displayName: {
        type: 'VIRTUAL',
        calculated: "INITCAP(first_name || ' ' || last_name)"
      }
    }
  }
};

// Example 6: JSON Field Access
const settingsSchema = {
  collectionName: 'user_settings',
  schema: {
    fields: {
      settings: { type: 'JSON', allowNull: false },
      
      // Extract specific JSON fields as virtual columns
      preferredLanguage: {
        type: 'VIRTUAL',
        calculated: "settings->>'language'"
      },
      
      emailNotifications: {
        type: 'VIRTUAL',
        calculated: "(settings->>'emailNotifications')::boolean"
      },
      
      theme: {
        type: 'VIRTUAL',
        calculated: "COALESCE(settings->>'theme', 'light')"
      }
    }
  }
};

// Example 7: Complex Business Logic
const invoiceSchema = {
  collectionName: 'invoices',
  schema: {
    fields: {
      amount: { type: 'Decimal', allowNull: false },
      paidAmount: { type: 'Decimal', defaultValue: 0 },
      dueDate: { type: 'Date', allowNull: false },
      
      // Remaining balance
      balance: {
        type: 'VIRTUAL',
        calculated: 'amount - paid_amount'
      },
      
      // Payment status
      paymentStatus: {
        type: 'VIRTUAL',
        calculated: `CASE
          WHEN paid_amount >= amount THEN 'Paid'
          WHEN paid_amount > 0 THEN 'Partial'
          ELSE 'Unpaid'
        END`
      },
      
      // Overdue status
      isOverdue: {
        type: 'VIRTUAL',
        calculated: 'due_date < CURRENT_DATE AND paid_amount < amount'
      },
      
      // Days overdue (negative if not yet due)
      daysOverdue: {
        type: 'VIRTUAL',
        calculated: 'EXTRACT(DAY FROM (CURRENT_DATE - due_date))'
      }
    }
  }
};

// Example 8: Geographic Calculations (if using PostGIS)
const locationSchema = {
  collectionName: 'locations',
  schema: {
    fields: {
      latitude: { type: 'Double', allowNull: false },
      longitude: { type: 'Double', allowNull: false },
      
      // Create a point from lat/long
      coordinates: {
        type: 'VIRTUAL',
        calculated: "CONCAT(latitude, ',', longitude)"
      },
      
      // Quadrant classification
      quadrant: {
        type: 'VIRTUAL',
        calculated: `CASE
          WHEN latitude >= 0 AND longitude >= 0 THEN 'NE'
          WHEN latitude >= 0 AND longitude < 0 THEN 'NW'
          WHEN latitude < 0 AND longitude >= 0 THEN 'SE'
          ELSE 'SW'
        END`
      }
    }
  }
};

// API Usage Examples:

// 1. Query users with full names
// GET /items/users?fields=firstName,lastName,fullName

// 2. Filter by computed field
// GET /items/orders?filter={"total":{"gt":100}}&fields=price,quantity,total

// 3. Sort by computed field
// GET /items/employees?sort={"ageGroup":"ASC","salary":"DESC"}

// 4. Computed fields in aggregations
// GET /items/orders?aggregate={"sum":"total","avg":"discountAmount"}

// 5. Create index on computed field (via migration)
// CREATE INDEX idx_users_full_name ON users(full_name);
// CREATE INDEX idx_orders_total ON orders(total);

module.exports = {
  userSchema,
  orderSchema,
  employeeSchema,
  memberSchema,
  emailSchema,
  settingsSchema,
  invoiceSchema,
  locationSchema
};
