# Add to package.json scripts section:

```json
{
  "scripts": {
    "export-schema": "node scripts/export-current-schema.js",
    "export-schema:prod": "NODE_ENV=production node scripts/export-current-schema.js"
  }
}
```

# Usage:

## Local Development:
```bash
npm run export-schema
```

## Production (on Render.com):
```bash
npm run export-schema:prod
```

## Manual execution:
```bash
node scripts/export-current-schema.js
```

This will generate two files in the `database/` directory:
- `current-schema-YYYY-MM-DDTHH-MM-SS.sql` - Complete database schema
- `schema-summary-YYYY-MM-DDTHH-MM-SS.md` - Human-readable summary

Use these files as the authoritative reference for your database structure when troubleshooting future issues.