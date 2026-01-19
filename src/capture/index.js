/**
 * Seedify Query Capturer
 * 
 * Monkey-patches the pg module to intercept ALL queries from ALL clients.
 * Call start() before creating any pg clients, and dump() in your afterAll hook.
 */

const capturedQueries = [];
let isCapturing = false;
let originalQuery = null;

/**
 * Start capturing queries. 
 * MUST be called before any pg.Client or pg.Pool is created.
 */
function start() {
    if (isCapturing) {
        console.warn('[seedify] Already capturing queries');
        return;
    }

    // eslint-disable-next-line global-require
    const pg = require('pg');

    // Store original query method
    originalQuery = pg.Client.prototype.query;

    // Monkey-patch the query method
    pg.Client.prototype.query = function patchedQuery(...args) {
        const queryConfig = args[0];
        let queryText;
        let queryParams;

        // Handle different query call signatures
        if (typeof queryConfig === 'string') {
            queryText = queryConfig;
            queryParams = args[1];
        } else if (queryConfig && typeof queryConfig === 'object') {
            queryText = queryConfig.text;
            queryParams = queryConfig.values;
        }

        // Capture the query
        if (queryText) {
            capturedQueries.push({
                query: queryText,
                params: queryParams || [],
                timestamp: Date.now()
            });
        }

        // Call original method
        return originalQuery.apply(this, args);
    };

    isCapturing = true;
    console.log('[seedify] Query capturing started');
}

/**
 * Stop capturing queries and restore original pg behavior.
 */
function stop() {
    if (!isCapturing) {
        return;
    }

    // eslint-disable-next-line global-require
    const pg = require('pg');

    if (originalQuery) {
        pg.Client.prototype.query = originalQuery;
        originalQuery = null;
    }

    isCapturing = false;
    console.log(`[seedify] Query capturing stopped. Captured ${capturedQueries.length} queries.`);
}

/**
 * Get all captured queries.
 */
function getQueries() {
    return [...capturedQueries];
}

/**
 * Clear all captured queries.
 */
function clear() {
    capturedQueries.length = 0;
}

/**
 * Dump captured queries to a JSONL file.
 * Each line is a JSON object with query, params, and timestamp.
 * 
 * @param {string} filePath - Path to output file
 */
async function dump(filePath) {
    const fs = require('fs').promises;
    const path = require('path');

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write as JSONL (one JSON object per line)
    const lines = capturedQueries.map(q => JSON.stringify(q));
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    console.log(`[seedify] Dumped ${capturedQueries.length} queries to ${filePath}`);
}

module.exports = {
    start,
    stop,
    getQueries,
    clear,
    dump
};
