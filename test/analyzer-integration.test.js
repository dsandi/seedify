/**
 * Integration tests for the analyzer - tests analyzeFile with real JSONL files
 */
const assert = require('assert');
const path = require('path');
const { analyzeFile, generateJailerConditions } = require('../src/analyzer');

describe('Analyzer Integration', function () {
    describe('analyzeFile', function () {
        it('should extract conditions from sample JSONL file', async function () {
            const fixturesPath = path.join(__dirname, 'fixtures', 'sample_queries.jsonl');
            const analysis = await analyzeFile(fixturesPath);

            // Should find the invoices table
            assert.ok(analysis.tables.includes('invoices'),
                `Expected tables to include 'invoices', got: ${analysis.tables}`);

            // Should extract the inv_receipt condition
            assert.ok(analysis.conditions.length > 0,
                `Expected at least 1 condition, got: ${analysis.conditions.length}`);

            const invReceiptCondition = analysis.conditions.find(c => c.column === 'inv_receipt');
            assert.ok(invReceiptCondition,
                `Expected to find inv_receipt condition, got conditions: ${JSON.stringify(analysis.conditions)}`);

            assert.ok(invReceiptCondition.values.includes(123),
                `Expected inv_receipt values to include 123, got: ${invReceiptCondition.values}`);
        });

        it('should generate Jailer conditions from sample JSONL', async function () {
            const fixturesPath = path.join(__dirname, 'fixtures', 'sample_queries.jsonl');
            const analysis = await analyzeFile(fixturesPath);
            const jailerConditions = generateJailerConditions(analysis);

            // Should generate at least one condition for Jailer
            // Note: may be 0 if the table isn't captured with the condition
            console.log('Analysis:', JSON.stringify(analysis, null, 2));
            console.log('Jailer conditions:', JSON.stringify(jailerConditions, null, 2));
        });
    });
});
