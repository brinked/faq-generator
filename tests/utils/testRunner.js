const { spawn } = require('child_process');
const path = require('path');

class TestRunner {
  constructor() {
    this.testResults = {
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: 0,
      coverage: null
    };
  }

  async runAllTests() {
    console.log('🧪 Starting comprehensive test suite...\n');
    
    try {
      // Run unit tests
      console.log('📋 Running unit tests...');
      await this.runTestSuite('tests/services/*.test.js', 'Unit Tests');
      
      // Run integration tests
      console.log('🔗 Running integration tests...');
      await this.runTestSuite('tests/integration/*.test.js', 'Integration Tests');
      
      // Run API tests
      console.log('🌐 Running API tests...');
      await this.runTestSuite('tests/routes/*.test.js', 'API Tests');
      
      // Run coverage report
      console.log('📊 Generating coverage report...');
      await this.runCoverage();
      
      this.printSummary();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    }
  }

  async runTestSuite(pattern, suiteName) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const mocha = spawn('npx', ['mocha', pattern, '--reporter', 'json'], {
        cwd: path.join(__dirname, '../..'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      mocha.stdout.on('data', (data) => {
        output += data.toString();
      });

      mocha.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      mocha.on('close', (code) => {
        const duration = Date.now() - startTime;
        
        try {
          if (output.trim()) {
            const results = JSON.parse(output);
            this.processTestResults(results, suiteName, duration);
          }
          
          if (code === 0) {
            console.log(`✅ ${suiteName} completed successfully (${duration}ms)\n`);
            resolve();
          } else {
            console.log(`❌ ${suiteName} failed with exit code ${code}`);
            if (errorOutput) {
              console.log('Error output:', errorOutput);
            }
            resolve(); // Continue with other tests
          }
        } catch (parseError) {
          console.log(`⚠️  ${suiteName} completed but couldn't parse results`);
          resolve();
        }
      });

      mocha.on('error', (error) => {
        console.log(`❌ Failed to run ${suiteName}:`, error.message);
        resolve();
      });
    });
  }

  async runCoverage() {
    return new Promise((resolve, reject) => {
      const nyc = spawn('npx', ['nyc', '--reporter=text', '--reporter=html', 'mocha', 'tests/**/*.test.js'], {
        cwd: path.join(__dirname, '../..'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';

      nyc.stdout.on('data', (data) => {
        output += data.toString();
      });

      nyc.on('close', (code) => {
        if (code === 0) {
          this.parseCoverageOutput(output);
          console.log('✅ Coverage report generated\n');
        } else {
          console.log('⚠️  Coverage report generation failed\n');
        }
        resolve();
      });

      nyc.on('error', (error) => {
        console.log('⚠️  Coverage tool not available:', error.message);
        resolve();
      });
    });
  }

  processTestResults(results, suiteName, duration) {
    const stats = results.stats || {};
    
    this.testResults.passed += stats.passes || 0;
    this.testResults.failed += stats.failures || 0;
    this.testResults.skipped += stats.pending || 0;
    this.testResults.total += stats.tests || 0;
    this.testResults.duration += duration;

    console.log(`  📊 ${suiteName} Results:`);
    console.log(`     ✅ Passed: ${stats.passes || 0}`);
    console.log(`     ❌ Failed: ${stats.failures || 0}`);
    console.log(`     ⏭️  Skipped: ${stats.pending || 0}`);
    console.log(`     ⏱️  Duration: ${duration}ms`);

    if (results.failures && results.failures.length > 0) {
      console.log(`     🔍 Failures:`);
      results.failures.forEach((failure, index) => {
        console.log(`        ${index + 1}. ${failure.fullTitle}`);
        console.log(`           ${failure.err.message}`);
      });
    }
  }

  parseCoverageOutput(output) {
    const lines = output.split('\n');
    const coverageLine = lines.find(line => line.includes('All files'));
    
    if (coverageLine) {
      const match = coverageLine.match(/(\d+\.?\d*)\s*%/);
      if (match) {
        this.testResults.coverage = parseFloat(match[1]);
      }
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 TEST SUITE SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`📊 Total Tests: ${this.testResults.total}`);
    console.log(`✅ Passed: ${this.testResults.passed}`);
    console.log(`❌ Failed: ${this.testResults.failed}`);
    console.log(`⏭️  Skipped: ${this.testResults.skipped}`);
    console.log(`⏱️  Total Duration: ${this.testResults.duration}ms`);
    
    if (this.testResults.coverage !== null) {
      console.log(`📈 Code Coverage: ${this.testResults.coverage}%`);
    }

    const successRate = this.testResults.total > 0 
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : 0;
    
    console.log(`🎯 Success Rate: ${successRate}%`);

    if (this.testResults.failed === 0) {
      console.log('\n🎉 All tests passed! Ready for deployment.');
    } else {
      console.log(`\n⚠️  ${this.testResults.failed} test(s) failed. Please review and fix.`);
    }

    console.log('='.repeat(60));
  }

  async runSpecificTest(testFile) {
    console.log(`🧪 Running specific test: ${testFile}\n`);
    
    return new Promise((resolve, reject) => {
      const mocha = spawn('npx', ['mocha', testFile, '--reporter', 'spec'], {
        cwd: path.join(__dirname, '../..'),
        stdio: 'inherit'
      });

      mocha.on('close', (code) => {
        if (code === 0) {
          console.log('\n✅ Test completed successfully');
          resolve();
        } else {
          console.log(`\n❌ Test failed with exit code ${code}`);
          reject(new Error(`Test failed with exit code ${code}`));
        }
      });

      mocha.on('error', (error) => {
        console.log('\n❌ Failed to run test:', error.message);
        reject(error);
      });
    });
  }

  async runTestsWithWatch() {
    console.log('👀 Starting test watcher...\n');
    
    const mocha = spawn('npx', ['mocha', 'tests/**/*.test.js', '--watch', '--reporter', 'spec'], {
      cwd: path.join(__dirname, '../..'),
      stdio: 'inherit'
    });

    mocha.on('error', (error) => {
      console.log('❌ Failed to start test watcher:', error.message);
    });

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n👋 Stopping test watcher...');
      mocha.kill();
      process.exit(0);
    });
  }
}

// CLI interface
if (require.main === module) {
  const runner = new TestRunner();
  const command = process.argv[2];

  switch (command) {
    case 'all':
      runner.runAllTests();
      break;
    case 'watch':
      runner.runTestsWithWatch();
      break;
    case 'file':
      const testFile = process.argv[3];
      if (!testFile) {
        console.log('❌ Please specify a test file');
        process.exit(1);
      }
      runner.runSpecificTest(testFile);
      break;
    default:
      console.log('Usage:');
      console.log('  node testRunner.js all     - Run all tests');
      console.log('  node testRunner.js watch   - Run tests in watch mode');
      console.log('  node testRunner.js file <path> - Run specific test file');
      break;
  }
}

module.exports = TestRunner;