#!/usr/bin/env node

/**
 * Test script to validate database migration syntax
 * This script tests the migration without actually running it against a database
 */

const fs = require('fs');
const path = require('path');

function testMigrationSyntax() {
  console.log('🔍 Testing Database Migration Syntax...\n');

  try {
    // Read the schema file
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('✅ Schema file read successfully');
    console.log(`📄 Schema file size: ${schema.length} characters`);
    
    // Split the schema into individual statements, handling functions properly
    const statements = [];
    let currentStatement = '';
    let inFunction = false;
    
    const lines = schema.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip comments and empty lines
      if (trimmedLine.startsWith('--') || trimmedLine === '') {
        continue;
      }
      
      currentStatement += line + '\n';
      
      // Check if we're entering a function
      if (trimmedLine.includes('CREATE OR REPLACE FUNCTION') ||
          trimmedLine.includes('CREATE FUNCTION')) {
        inFunction = true;
      }
      
      // Check if we're ending a function
      if (inFunction && trimmedLine.includes('$$ LANGUAGE')) {
        inFunction = false;
        statements.push(currentStatement.trim());
        currentStatement = '';
        continue;
      }
      
      // For non-function statements, split on semicolon
      if (!inFunction && trimmedLine.endsWith(';')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }
    
    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    // Filter out empty statements
    const validStatements = statements.filter(stmt => stmt.length > 0);
    
    console.log(`✅ Successfully parsed ${validStatements.length} SQL statements`);
    
    // Check for common syntax issues
    let issuesFound = 0;
    
    validStatements.forEach((statement, index) => {
      const statementNumber = index + 1;
      
      // Check for trailing commas before closing parentheses
      if (statement.match(/,\s*\)/)) {
        console.log(`❌ Statement ${statementNumber}: Found trailing comma before closing parenthesis`);
        issuesFound++;
      }
      
      // Check for missing semicolons (except for DO blocks)
      if (!statement.includes('DO $$') && !statement.trim().endsWith(';') && !statement.includes('$$ LANGUAGE')) {
        console.log(`⚠️  Statement ${statementNumber}: Missing semicolon at end`);
      }
      
      // Check for unmatched parentheses
      const openParens = (statement.match(/\(/g) || []).length;
      const closeParens = (statement.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        console.log(`❌ Statement ${statementNumber}: Unmatched parentheses (${openParens} open, ${closeParens} close)`);
        issuesFound++;
      }
    });
    
    // Show statement types
    const statementTypes = {};
    validStatements.forEach(statement => {
      const firstLine = statement.split('\n')[0].trim();
      const type = firstLine.split(' ').slice(0, 3).join(' ');
      statementTypes[type] = (statementTypes[type] || 0) + 1;
    });
    
    console.log('\n📊 Statement types found:');
    Object.entries(statementTypes).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
    
    if (issuesFound === 0) {
      console.log('\n🎉 No syntax issues found in migration script!');
      console.log('\n✅ Migration script appears to be valid');
      return true;
    } else {
      console.log(`\n❌ Found ${issuesFound} syntax issues that need to be fixed`);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error testing migration syntax:', error.message);
    return false;
  }
}

// Run the test
const success = testMigrationSyntax();
process.exit(success ? 0 : 1);