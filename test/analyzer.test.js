/**
 * Tests for the query analyzer
 */
const assert = require('assert');
const { extractTableNames, extractIdConditions } = require('../src/analyzer');

describe('Query Analyzer', function () {
    describe('extractTableNames', function () {
        it('should extract table from simple SELECT', function () {
            const query = 'SELECT * FROM users WHERE id = $1';
            const tables = extractTableNames(query);
            assert.deepStrictEqual(tables, ['users']);
        });

        it('should extract table from SELECT with schema', function () {
            const query = 'SELECT * FROM public.users WHERE id = $1';
            const tables = extractTableNames(query);
            assert.deepStrictEqual(tables, ['public.users']);
        });

        it('should extract multiple tables from JOIN', function () {
            const query = 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id';
            const tables = extractTableNames(query);
            assert.ok(tables.includes('users'));
            assert.ok(tables.includes('orders'));
        });

        it('should extract tables from complex CTE query', function () {
            const query = `
                WITH RECURSIVE category_tree AS (
                    SELECT id, name FROM uc_categories WHERE id = 1
                    UNION ALL
                    SELECT c.id, c.name FROM uc_categories c
                    JOIN category_tree ct ON c.id > ct.id
                )
                SELECT * FROM uc_users u
                LEFT JOIN uc_orders o ON u.id = o.user_id
            `;
            const tables = extractTableNames(query);
            assert.ok(tables.includes('uc_categories'));
            assert.ok(tables.includes('uc_users'));
            assert.ok(tables.includes('uc_orders'));
        });

        it('should extract table from INSERT', function () {
            const query = 'INSERT INTO users (name, email) VALUES ($1, $2)';
            const tables = extractTableNames(query);
            assert.deepStrictEqual(tables, ['users']);
        });

        it('should extract table from UPDATE', function () {
            const query = 'UPDATE users SET name = $1 WHERE id = $2';
            const tables = extractTableNames(query);
            assert.deepStrictEqual(tables, ['users']);
        });

        it('should extract table from DELETE', function () {
            const query = 'DELETE FROM users WHERE id = $1';
            const tables = extractTableNames(query);
            assert.deepStrictEqual(tables, ['users']);
        });
    });

    describe('extractIdConditions', function () {
        it('should extract simple id = $1 condition', function () {
            const query = 'SELECT * FROM users WHERE id = $1';
            const params = [42];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.column === 'id' &&
                c.values.includes(42)
            ));
        });

        it('should extract table.id = $1 condition', function () {
            const query = 'SELECT * FROM users WHERE users.id = $1';
            const params = [42];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.table === 'users' &&
                c.column === 'id' &&
                c.values.includes(42)
            ));
        });

        it('should extract IN clause conditions', function () {
            const query = 'SELECT * FROM users WHERE id IN ($1, $2, $3)';
            const params = [1, 2, 3];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.column === 'id' &&
                c.values.includes(1) &&
                c.values.includes(2) &&
                c.values.includes(3)
            ));
        });

        it('should extract user_id foreign key conditions', function () {
            const query = 'SELECT * FROM orders WHERE user_id = $1';
            const params = [42];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.column === 'user_id' &&
                c.values.includes(42)
            ));
        });

        it('should extract literal numeric conditions', function () {
            const query = 'SELECT * FROM categories WHERE categories.id = 1';
            const params = [];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.table === 'categories' &&
                c.column === 'id' &&
                c.values.includes(1)
            ));
        });

        it('should extract string literal conditions', function () {
            const query = "SELECT * FROM users WHERE users.username = 'alice'";
            const params = [];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.table === 'users' &&
                c.column === 'username' &&
                c.values.includes('alice')
            ));
        });

        it('should extract simple = ANY($1) condition with array param', function () {
            const query = 'SELECT * FROM users WHERE id = ANY($1)';
            const params = [[1, 2, 3]];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.column === 'id' &&
                c.values.includes(1) &&
                c.values.includes(2) &&
                c.values.includes(3)
            ));
        });

        it('should extract table.column = ANY($1) condition', function () {
            const query = 'SELECT * FROM orders WHERE orders.user_id = ANY($1)';
            const params = [[10, 20, 30]];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.table === 'orders' &&
                c.column === 'user_id' &&
                c.values.includes(10) &&
                c.values.includes(20)
            ));
        });

        it('should extract non-ID column conditions like inv_receipt', function () {
            // Regression test: columns that don't end with "id" should still be captured
            const query = 'SELECT inv_pk FROM invoices WHERE inv_receipt = $1;';
            const params = [123];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.column === 'inv_receipt' &&
                c.values.includes(123)
            ), 'Should extract inv_receipt condition even though it does not look like an ID column');
        });

        it('should extract arbitrary column names', function () {
            const query = 'SELECT * FROM products WHERE sku = $1 AND category_code = $2';
            const params = ['ABC123', 'ELEC'];
            const conditions = extractIdConditions(query, params);

            assert.ok(conditions.some(c =>
                c.column === 'sku' &&
                c.values.includes('ABC123')
            ));
            assert.ok(conditions.some(c =>
                c.column === 'category_code' &&
                c.values.includes('ELEC')
            ));
        });
    });
});
