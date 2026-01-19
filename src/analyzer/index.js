/**
 * Seedify Query Analyzer
 * 
 * Parses captured queries and extracts table names + ID conditions
 * for feeding into Jailer.
 */

const fs = require('fs').promises;

/**
 * Extracts table names from a SQL query.
 * Handles FROM, JOIN, INTO, UPDATE, DELETE FROM clauses.
 * 
 * @param {string} query - SQL query string
 * @returns {string[]} - Array of table names
 */
function extractTableNames(query) {
    const tables = new Set();

    // Normalize whitespace
    const normalized = query.replace(/\s+/g, ' ').trim();

    // Patterns to match table names
    const patterns = [
        // FROM table_name or FROM schema.table_name
        /\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi,
        // JOIN table_name
        /\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi,
        // INTO table_name
        /\bINTO\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi,
        // UPDATE table_name
        /\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi,
        // DELETE FROM table_name
        /\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(normalized)) !== null) {
            const tableName = match[1].toLowerCase();
            // Skip common SQL keywords that might be captured
            if (!isKeyword(tableName)) {
                tables.add(tableName);
            }
        }
    }

    return Array.from(tables);
}

/**
 * Check if a string is a SQL keyword (to filter out false positives)
 */
function isKeyword(word) {
    const keywords = new Set([
        'select', 'where', 'and', 'or', 'not', 'null', 'true', 'false',
        'order', 'group', 'having', 'limit', 'offset', 'union', 'intersect',
        'except', 'case', 'when', 'then', 'else', 'end', 'as', 'on',
        'lateral', 'recursive', 'with', 'values', 'returning', 'set'
    ]);
    return keywords.has(word.toLowerCase());
}

/**
 * Extracts ID conditions from a query with its params.
 * Looks for patterns like: WHERE id = $1, WHERE table.id IN ($1, $2)
 * 
 * @param {string} query - SQL query string
 * @param {any[]} params - Query parameters
 * @returns {Array<{table: string, column: string, values: any[]}>}
 */
function extractIdConditions(query, params) {
    const conditions = [];
    const normalized = query.replace(/\s+/g, ' ').trim();

    // Pattern 1: Simple column = $N (e.g., "id = $1", "user_id = $2")
    const simpleEqualPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\$(\d+)/gi;

    // Pattern 2: table.column = $N (e.g., "users.id = $1")
    const tableEqualPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\$(\d+)/gi;

    // Pattern 3: Simple column IN ($1, $2, ...) 
    const simpleInPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\s*\(([^)]+)\)/gi;

    // Pattern 4: table.column IN ($1, $2, ...)
    const tableInPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\s*\(([^)]+)\)/gi;

    // Extract simple column = $N conditions
    let match;
    while ((match = simpleEqualPattern.exec(normalized)) !== null) {
        const column = match[1];
        const paramIndex = parseInt(match[2], 10) - 1;

        if (isIdColumn(column) && params[paramIndex] !== undefined) {
            conditions.push({
                table: null,
                column: column.toLowerCase(),
                values: [params[paramIndex]]
            });
        }
    }

    // Extract table.column = $N conditions
    while ((match = tableEqualPattern.exec(normalized)) !== null) {
        const table = match[1].toLowerCase();
        const column = match[2];
        const paramIndex = parseInt(match[3], 10) - 1;

        if (isIdColumn(column) && params[paramIndex] !== undefined) {
            conditions.push({
                table,
                column: column.toLowerCase(),
                values: [params[paramIndex]]
            });
        }
    }

    // Extract simple column IN (...) conditions
    while ((match = simpleInPattern.exec(normalized)) !== null) {
        const column = match[1];
        const paramsStr = match[2];

        const paramMatches = paramsStr.match(/\$(\d+)/g);
        if (paramMatches && isIdColumn(column)) {
            const values = paramMatches.map(p => {
                const idx = parseInt(p.slice(1), 10) - 1;
                return params[idx];
            }).filter(v => v !== undefined);

            if (values.length > 0) {
                conditions.push({
                    table: null,
                    column: column.toLowerCase(),
                    values
                });
            }
        }
    }

    // Extract table.column IN (...) conditions
    while ((match = tableInPattern.exec(normalized)) !== null) {
        const table = match[1].toLowerCase();
        const column = match[2];
        const paramsStr = match[3];

        const paramMatches = paramsStr.match(/\$(\d+)/g);
        if (paramMatches && isIdColumn(column)) {
            const values = paramMatches.map(p => {
                const idx = parseInt(p.slice(1), 10) - 1;
                return params[idx];
            }).filter(v => v !== undefined);

            if (values.length > 0) {
                conditions.push({
                    table,
                    column: column.toLowerCase(),
                    values
                });
            }
        }
    }

    // Pattern 5: column = ANY($1) - PostgreSQL array parameter syntax
    const simpleAnyPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*ANY\s*\(\s*\$(\d+)\s*\)/gi;

    // Pattern 6: table.column = ANY($1)
    const tableAnyPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*ANY\s*\(\s*\$(\d+)\s*\)/gi;

    // Extract simple column = ANY($N) conditions
    while ((match = simpleAnyPattern.exec(normalized)) !== null) {
        const column = match[1];
        const paramIndex = parseInt(match[2], 10) - 1;
        const paramValue = params[paramIndex];

        if (isIdColumn(column) && paramValue !== undefined) {
            // ANY takes an array parameter, so flatten it
            const values = Array.isArray(paramValue) ? paramValue : [paramValue];
            conditions.push({
                table: null,
                column: column.toLowerCase(),
                values
            });
        }
    }

    // Extract table.column = ANY($N) conditions
    while ((match = tableAnyPattern.exec(normalized)) !== null) {
        const table = match[1].toLowerCase();
        const column = match[2];
        const paramIndex = parseInt(match[3], 10) - 1;
        const paramValue = params[paramIndex];

        if (isIdColumn(column) && paramValue !== undefined) {
            const values = Array.isArray(paramValue) ? paramValue : [paramValue];
            conditions.push({
                table,
                column: column.toLowerCase(),
                values
            });
        }
    }


    // Also extract literal ID values (e.g., WHERE id = 1)
    const literalPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\d+)\b/gi;
    while ((match = literalPattern.exec(normalized)) !== null) {
        const table = match[1].toLowerCase();
        const column = match[2].toLowerCase();
        const value = parseInt(match[3], 10);

        if (isIdColumn(column)) {
            conditions.push({
                table,
                column,
                values: [value]
            });
        }
    }

    // Extract string literals (e.g., WHERE username = 'alice')
    const stringLiteralPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*'([^']+)'/gi;
    while ((match = stringLiteralPattern.exec(normalized)) !== null) {
        const table = match[1].toLowerCase();
        const column = match[2].toLowerCase();
        const value = match[3];

        conditions.push({
            table,
            column,
            values: [value]
        });
    }

    return conditions;
}

/**
 * Check if a column name looks like an ID column
 */
function isIdColumn(column) {
    const col = column.toLowerCase();
    return col === 'id' || col.endsWith('_id') || col.endsWith('id');
}

/**
 * Analyze a captured queries file and extract Jailer conditions.
 * 
 * @param {string} inputPath - Path to captured_queries.jsonl
 * @returns {Object} - { tables: string[], conditions: {table, column, values}[] }
 */
async function analyzeFile(inputPath) {
    const content = await fs.readFile(inputPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const allTables = new Set();
    const allConditions = [];
    const conditionMap = new Map(); // Dedupe conditions by table.column

    for (const line of lines) {
        const { query, params } = JSON.parse(line);

        // Extract tables
        const tables = extractTableNames(query);
        tables.forEach(t => allTables.add(t));

        // Extract conditions
        const conditions = extractIdConditions(query, params);
        for (const cond of conditions) {
            const key = `${cond.table || '_'}.${cond.column}`;
            if (!conditionMap.has(key)) {
                conditionMap.set(key, { table: cond.table, column: cond.column, values: new Set() });
            }
            cond.values.forEach(v => conditionMap.get(key).values.add(v));
        }
    }

    // Convert Sets to arrays and sort
    const conditions = Array.from(conditionMap.values()).map(c => ({
        table: c.table,
        column: c.column,
        values: Array.from(c.values).sort()
    }));

    return {
        tables: Array.from(allTables).sort(),
        conditions,
        queryCount: lines.length
    };
}

/**
 * Generate Jailer subject conditions from analysis results.
 * 
 * @param {Object} analysis - Result from analyzeFile
 * @returns {Array<{table: string, condition: string}>}
 */
function generateJailerConditions(analysis) {
    const jailerConditions = [];

    for (const cond of analysis.conditions) {
        if (!cond.table) continue; // Skip conditions without table reference

        const values = cond.values;
        let conditionStr;

        if (values.length === 1) {
            const val = typeof values[0] === 'string' ? `'${values[0]}'` : values[0];
            conditionStr = `${cond.column} = ${val}`;
        } else {
            const valStr = values.map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
            conditionStr = `${cond.column} IN (${valStr})`;
        }

        jailerConditions.push({
            table: cond.table,
            condition: conditionStr
        });
    }

    return jailerConditions;
}

module.exports = {
    extractTableNames,
    extractIdConditions,
    analyzeFile,
    generateJailerConditions
};
