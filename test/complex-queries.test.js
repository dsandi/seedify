/**
 * Tests for complex query handling
 */
const assert = require('assert');
const { extractTableNames, extractIdConditions, analyzeFile, generateJailerConditions } = require('../src/analyzer');
const fs = require('fs').promises;
const path = require('path');

describe('Complex Query Handling', function () {
    const complexQuery = `
        WITH RECURSIVE category_tree AS (
            SELECT id, name, 1 as level
            FROM uc_categories
            WHERE id = 1
            UNION ALL
            SELECT c.id, c.name, ct.level + 1
            FROM uc_categories c
            JOIN category_tree ct ON c.id > ct.id
            WHERE ct.level < 2
        ),
        user_stats AS (
            SELECT 
                u.id, 
                u.username,
                COUNT(o.id) as order_count,
                COALESCE(SUM(o.total_amount), 0) as total_spent
            FROM uc_users u
            LEFT JOIN uc_orders o ON u.id = o.user_id
            GROUP BY u.id, u.username
        ),
        product_sales AS (
            SELECT 
                p.id,
                p.name,
                p.category_id,
                SUM(oi.quantity) as total_sold,
                RANK() OVER (PARTITION BY p.category_id ORDER BY SUM(oi.quantity) DESC) as rank_in_category
            FROM uc_products p
            JOIN uc_order_items oi ON p.id = oi.product_id
            GROUP BY p.id, p.name, p.category_id
        ),
        complex_union AS (
            SELECT us.id as user_id, 'user' as type, us.username as name
            FROM user_stats us
            WHERE us.total_spent > 100
            
            UNION ALL
            
            SELECT l.id as user_id, 'log' as type, l.action as name
            FROM uc_users u
            JOIN LATERAL (
                SELECT * FROM uc_logs 
                WHERE user_id = u.id 
                ORDER BY created_at DESC 
                LIMIT 5
            ) l ON true
            WHERE u.username = 'alice'
        )
        SELECT * FROM complex_union cu
        ORDER BY user_id DESC;
    `;

    describe('extractTableNames with complex CTE', function () {
        it('should extract all tables from complex CTE query', function () {
            const tables = extractTableNames(complexQuery);

            // Should find all the real tables
            assert.ok(tables.includes('uc_categories'), 'Should find uc_categories');
            assert.ok(tables.includes('uc_users'), 'Should find uc_users');
            assert.ok(tables.includes('uc_orders'), 'Should find uc_orders');
            assert.ok(tables.includes('uc_products'), 'Should find uc_products');
            assert.ok(tables.includes('uc_order_items'), 'Should find uc_order_items');
            assert.ok(tables.includes('uc_logs'), 'Should find uc_logs');

            // Note: CTE names may also be captured, which is fine - Jailer will ignore non-existent tables
            console.log('Tables found:', tables);
        });
    });

    describe('extractIdConditions with complex query', function () {
        it('should extract string literal conditions from CTE WHERE clauses', function () {
            const conditions = extractIdConditions(complexQuery, []);

            console.log('Conditions found:', JSON.stringify(conditions, null, 2));

            // Should find: WHERE u.username = 'alice' (string literal with table prefix)
            assert.ok(conditions.some(c => c.column === 'username' && c.values.includes('alice')),
                'Should find username = alice condition');
        });

        it('should extract parameterized conditions from complex queries', function () {
            // A more realistic parameterized version
            const paramQuery = `
                SELECT * FROM uc_users u
                JOIN uc_orders o ON u.id = o.user_id
                WHERE u.id = $1 AND o.status = $2
            `;
            const params = [42, 'completed'];

            const conditions = extractIdConditions(paramQuery, params);
            console.log('Parameterized conditions:', JSON.stringify(conditions, null, 2));

            assert.ok(conditions.some(c => c.column === 'id' && c.values.includes(42)));
            assert.ok(conditions.some(c => c.column === 'status' && c.values.includes('completed')));
        });
    });

    describe('queries without ID conditions', function () {
        it('should still extract tables for queries without conditions', function () {
            const simpleQuery = 'SELECT * FROM orders';

            const tables = extractTableNames(simpleQuery);
            assert.ok(tables.includes('orders'));

            const conditions = extractIdConditions(simpleQuery, []);

            // No conditions, but tables are still captured!
            // Strategy: generate Jailer conditions manually for tables without auto-detected conditions
            console.log('Query without conditions - Tables:', tables);
            console.log('Query without conditions - Conditions:', conditions);
            assert.strictEqual(conditions.length, 0, 'No conditions expected');
        });

        it('should handle date range queries with params', function () {
            const query = 'SELECT * FROM orders WHERE created_at >= $1 AND created_at < $2';
            const params = ['2024-01-01', '2024-02-01'];

            const tables = extractTableNames(query);
            const conditions = extractIdConditions(query, params);

            console.log('Date range - Tables:', tables);
            console.log('Date range - Conditions:', JSON.stringify(conditions, null, 2));

            assert.ok(tables.includes('orders'));

            // Should capture >= and < operators
            assert.ok(conditions.some(c => c.column === 'created_at' && c.operator === '>='),
                'Should find >= condition');
            assert.ok(conditions.some(c => c.column === 'created_at' && c.operator === '<'),
                'Should find < condition');
        });

        it('should handle BETWEEN queries', function () {
            const query = 'SELECT * FROM orders WHERE created_at BETWEEN $1 AND $2';
            const params = ['2024-01-01', '2024-12-31'];

            const conditions = extractIdConditions(query, params);

            console.log('BETWEEN - Conditions:', JSON.stringify(conditions, null, 2));

            assert.ok(conditions.some(c =>
                c.column === 'created_at' &&
                c.operator === 'BETWEEN' &&
                c.values.includes('2024-01-01') &&
                c.values.includes('2024-12-31')
            ), 'Should find BETWEEN condition with both values');
        });

        it('should handle != and <> operators', function () {
            const query = 'SELECT * FROM orders WHERE status != $1 AND type <> $2';
            const params = ['cancelled', 'draft'];

            const conditions = extractIdConditions(query, params);
            console.log('Not equal conditions:', JSON.stringify(conditions, null, 2));

            assert.ok(conditions.some(c => c.column === 'status' && c.operator === '!='));
            assert.ok(conditions.some(c => c.column === 'type' && c.operator === '<>'));
        });

        it('should handle LIKE and ILIKE operators', function () {
            const query = "SELECT * FROM users WHERE email LIKE $1 AND name ILIKE $2";
            const params = ['%@example.com', '%john%'];

            const conditions = extractIdConditions(query, params);
            console.log('LIKE conditions:', JSON.stringify(conditions, null, 2));

            assert.ok(conditions.some(c => c.column === 'email' && c.operator === 'LIKE'));
            assert.ok(conditions.some(c => c.column === 'name' && c.operator === 'ILIKE'));
        });

        it('should handle NOT IN operator', function () {
            const query = 'SELECT * FROM orders WHERE status NOT IN ($1, $2, $3)';
            const params = ['cancelled', 'deleted', 'archived'];

            const conditions = extractIdConditions(query, params);
            console.log('NOT IN conditions:', JSON.stringify(conditions, null, 2));

            assert.ok(conditions.some(c =>
                c.column === 'status' &&
                c.operator === 'NOT IN' &&
                c.values.length === 3
            ));
        });

        it('should handle IS NULL and IS NOT NULL', function () {
            const query = 'SELECT * FROM users WHERE deleted_at IS NULL AND verified_at IS NOT NULL';
            const params = [];

            const conditions = extractIdConditions(query, params);
            console.log('IS NULL conditions:', JSON.stringify(conditions, null, 2));

            assert.ok(conditions.some(c => c.column === 'deleted_at' && c.operator === 'IS NULL'));
            assert.ok(conditions.some(c => c.column === 'verified_at' && c.operator === 'IS NOT NULL'));
        });
    });

    describe('analyzeFile with complex queries', function () {
        const fixturesDir = path.join(__dirname, 'fixtures');
        const complexQueryFile = path.join(fixturesDir, 'complex_queries.jsonl');

        before(async function () {
            // Create a fixture with mixed queries
            const queries = [
                { query: 'BEGIN', params: [], timestamp: Date.now() },
                { query: complexQuery, params: [], timestamp: Date.now() },
                { query: 'SELECT * FROM orders WHERE status = $1', params: ['pending'], timestamp: Date.now() },
                { query: 'SELECT * FROM users WHERE id = $1', params: [123], timestamp: Date.now() },
                { query: 'COMMIT', params: [], timestamp: Date.now() }
            ];

            await fs.writeFile(
                complexQueryFile,
                queries.map(q => JSON.stringify(q)).join('\n')
            );
        });

        after(async function () {
            await fs.unlink(complexQueryFile).catch(() => { });
        });

        it('should analyze complex queries and generate useful output', async function () {
            const analysis = await analyzeFile(complexQueryFile);
            const jailerConditions = generateJailerConditions(analysis);

            console.log('\n=== Analysis Results ===');
            console.log('Tables:', analysis.tables);
            console.log('Conditions:', JSON.stringify(analysis.conditions, null, 2));
            console.log('Jailer conditions:', JSON.stringify(jailerConditions, null, 2));

            // Should find multiple tables
            assert.ok(analysis.tables.length >= 3, `Expected at least 3 tables, got ${analysis.tables.length}`);

            // Verify exact conditions are extracted from the queries:
            // Query 1: complexQuery has "WHERE u.username = 'alice'" (string literal)
            const usernameCondition = analysis.conditions.find(c => c.column === 'username');
            assert.ok(usernameCondition, 'Should extract username condition from complex CTE query');
            assert.ok(usernameCondition.values.includes('alice'),
                `Expected username values to include 'alice', got: ${usernameCondition.values}`);

            // Query 2: "SELECT * FROM orders WHERE status = $1" with params: ['pending']
            const statusCondition = analysis.conditions.find(c => c.column === 'status');
            assert.ok(statusCondition, 'Should extract status condition');
            assert.ok(statusCondition.values.includes('pending'),
                `Expected status values to include 'pending', got: ${statusCondition.values}`);

            // Query 3: "SELECT * FROM users WHERE id = $1" with params: [123]
            const idCondition = analysis.conditions.find(c => c.column === 'id');
            assert.ok(idCondition, 'Should extract id condition');
            assert.ok(idCondition.values.includes(123),
                `Expected id values to include 123, got: ${idCondition.values}`);

            // Verify Jailer conditions are generated correctly
            assert.ok(jailerConditions.length >= 3, `Expected at least 3 Jailer conditions, got ${jailerConditions.length}`);

            // Check specific Jailer condition formats
            const statusJailer = jailerConditions.find(c => c.condition.includes('status'));
            assert.ok(statusJailer, 'Should generate Jailer condition for status');
            assert.strictEqual(statusJailer.condition, "status = 'pending'",
                `Expected status condition to be "status = 'pending'", got: ${statusJailer.condition}`);

            const idJailer = jailerConditions.find(c => c.condition.includes('id ='));
            assert.ok(idJailer, 'Should generate Jailer condition for id');
            assert.strictEqual(idJailer.condition, 'id = 123',
                `Expected id condition to be "id = 123", got: ${idJailer.condition}`);
        });
    });
});
