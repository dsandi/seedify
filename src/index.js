/**
 * Seedify - PostgreSQL Test Data Seeder Generator
 * 
 * Capture queries from your tests and generate minimal seeders using Jailer.
 */

const capturer = require('./capture');
const analyzer = require('./analyzer');

module.exports = {
    // Query capturing
    capturer,

    // Query analysis
    analyzer,

    // Convenience re-exports
    start: capturer.start,
    stop: capturer.stop,
    dump: capturer.dump,
    getQueries: capturer.getQueries,
    clear: capturer.clear,
    analyzeFile: analyzer.analyzeFile
};
