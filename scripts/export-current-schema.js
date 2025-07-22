#!/usr/bin/env node

/**
 * Export Current Database Schema
 * 
 * This script connects to the production database and exports the complete
 * current schema including all tables, constraints, indexes, functions, etc.
 * This gives us the TRUE state of the database after all migrations and patches.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection (uses environment variables from Render.com)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function exportCurrentSchema() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Connecting to database...');
    
    // Get current timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputFile = path.join(__dirname, '..', 'database', `current-schema-${timestamp}.sql`);
    
    let schemaSQL = `-- CURRENT DATABASE SCHEMA EXPORT
-- Generated: ${new Date().toISOString()}
-- This represents the TRUE state of the database after all migrations
-- Use this as the authoritative reference for database structure

`;

    console.log('📋 Exporting table structures...');
    
    // Get all tables with their complete definitions
    const tablesResult = await client.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    for (const table of tablesResult.rows) {
      console.log(`  📄 Exporting table: ${table.tablename}`);
      
      // Get CREATE TABLE statement
      const createTableResult = await client.query(`
        SELECT 
          'CREATE TABLE ' || schemaname || '.' || tablename || ' (' || 
          array_to_string(
            array_agg(
              column_name || ' ' || 
              CASE 
                WHEN data_type = 'character varying' THEN 'VARCHAR(' || character_maximum_length || ')'
                WHEN data_type = 'character' THEN 'CHAR(' || character_maximum_length || ')'
                WHEN data_type = 'numeric' THEN 'NUMERIC(' || numeric_precision || ',' || numeric_scale || ')'
                WHEN data_type = 'USER-DEFINED' THEN udt_name
                ELSE UPPER(data_type)
              END ||
              CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
              CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END
              ORDER BY ordinal_position
            ), 
            ', '
          ) || ');' as create_statement
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        GROUP BY schemaname, tablename
      `, [table.tablename]);
      
      if (createTableResult.rows.length > 0) {
        schemaSQL += `\n-- Table: ${table.tablename}\n`;
        schemaSQL += createTableResult.rows[0].create_statement + '\n';
      }
    }

    console.log('🔗 Exporting constraints...');
    
    // Get all constraints
    const constraintsResult = await client.query(`
      SELECT 
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        CASE 
          WHEN tc.constraint_type = 'PRIMARY KEY' THEN
            'ALTER TABLE ' || tc.table_name || ' ADD CONSTRAINT ' || tc.constraint_name || 
            ' PRIMARY KEY (' || string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) || ');'
          WHEN tc.constraint_type = 'UNIQUE' THEN
            'ALTER TABLE ' || tc.table_name || ' ADD CONSTRAINT ' || tc.constraint_name || 
            ' UNIQUE (' || string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) || ');'
          WHEN tc.constraint_type = 'FOREIGN KEY' THEN
            'ALTER TABLE ' || tc.table_name || ' ADD CONSTRAINT ' || tc.constraint_name || 
            ' FOREIGN KEY (' || string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) || 
            ') REFERENCES ' || ccu.table_name || ' (' || string_agg(ccu.column_name, ', ') || ');'
        END as constraint_sql
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name 
        AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu 
        ON tc.constraint_name = ccu.constraint_name 
        AND tc.table_schema = ccu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type, ccu.table_name
      ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
    `);
    
    schemaSQL += '\n-- CONSTRAINTS\n';
    for (const constraint of constraintsResult.rows) {
      if (constraint.constraint_sql) {
        schemaSQL += constraint.constraint_sql + '\n';
      }
    }

    console.log('📊 Exporting indexes...');
    
    // Get all indexes
    const indexesResult = await client.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'  -- Exclude primary key indexes
      ORDER BY tablename, indexname
    `);
    
    schemaSQL += '\n-- INDEXES\n';
    for (const index of indexesResult.rows) {
      schemaSQL += index.indexdef + ';\n';
    }

    console.log('⚙️ Exporting functions and triggers...');
    
    // Get all functions
    const functionsResult = await client.query(`
      SELECT 
        p.proname as function_name,
        pg_get_functiondef(p.oid) as function_definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
      ORDER BY p.proname
    `);
    
    schemaSQL += '\n-- FUNCTIONS\n';
    for (const func of functionsResult.rows) {
      schemaSQL += func.function_definition + '\n\n';
    }

    // Get all triggers
    const triggersResult = await client.query(`
      SELECT 
        t.tgname as trigger_name,
        c.relname as table_name,
        pg_get_triggerdef(t.oid) as trigger_definition
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname
    `);
    
    schemaSQL += '\n-- TRIGGERS\n';
    for (const trigger of triggersResult.rows) {
      schemaSQL += trigger.trigger_definition + ';\n';
    }

    console.log('🔢 Exporting enums and types...');
    
    // Get all custom types (enums, etc.)
    const typesResult = await client.query(`
      SELECT 
        t.typname,
        t.typtype,
        CASE 
          WHEN t.typtype = 'e' THEN
            'CREATE TYPE ' || t.typname || ' AS ENUM (' ||
            array_to_string(array_agg('''' || e.enumlabel || '''' ORDER BY e.enumsortorder), ', ') ||
            ');'
        END as type_definition
      FROM pg_type t
      LEFT JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public'
        AND t.typtype = 'e'
      GROUP BY t.typname, t.typtype
      ORDER BY t.typname
    `);
    
    if (typesResult.rows.length > 0) {
      schemaSQL = '-- CUSTOM TYPES\n' + 
        typesResult.rows.map(row => row.type_definition).join('\n') + 
        '\n\n' + schemaSQL;
    }

    // Write to file
    fs.writeFileSync(outputFile, schemaSQL);
    
    console.log(`✅ Schema exported successfully!`);
    console.log(`📁 File: ${outputFile}`);
    console.log(`📏 Size: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);
    
    // Also create a summary report
    const summaryFile = path.join(__dirname, '..', 'database', `schema-summary-${timestamp}.md`);
    
    const summary = `# Database Schema Summary
Generated: ${new Date().toISOString()}

## Tables
${tablesResult.rows.map(t => `- ${t.tablename}`).join('\n')}

## Constraints
${constraintsResult.rows.map(c => `- ${c.table_name}.${c.constraint_name} (${c.constraint_type})`).join('\n')}

## Indexes
${indexesResult.rows.map(i => `- ${i.tablename}.${i.indexname}`).join('\n')}

## Functions
${functionsResult.rows.map(f => `- ${f.function_name}()`).join('\n')}

## Custom Types
${typesResult.rows.map(t => `- ${t.typname} (${t.typtype === 'e' ? 'ENUM' : t.typtype})`).join('\n')}

## Files Generated
- Complete Schema: \`${path.basename(outputFile)}\`
- Summary Report: \`${path.basename(summaryFile)}\`

This represents the TRUE current state of your database after all migrations and patches.
Use this as the authoritative reference for future development and troubleshooting.
`;
    
    fs.writeFileSync(summaryFile, summary);
    console.log(`📋 Summary report: ${summaryFile}`);
    
  } catch (error) {
    console.error('❌ Error exporting schema:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the export
if (require.main === module) {
  exportCurrentSchema()
    .then(() => {
      console.log('🎉 Database schema export completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Export failed:', error);
      process.exit(1);
    });
}

module.exports = { exportCurrentSchema };