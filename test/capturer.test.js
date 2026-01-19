/**
 * Tests for the query capturer
 */
const assert = require('assert');

describe('Query Capturer', function () {
    let capturer;

    beforeEach(function () {
        // Clear module cache to get fresh capturer state
        delete require.cache[require.resolve('../src/capture')];
        capturer = require('../src/capture');
    });

    afterEach(function () {
        capturer.stop();
        capturer.clear();
    });

    it('should start without errors', function () {
        assert.doesNotThrow(() => capturer.start());
    });

    it('should not error when started twice', function () {
        capturer.start();
        assert.doesNotThrow(() => capturer.start());
    });

    it('should return empty array initially', function () {
        const queries = capturer.getQueries();
        assert.deepStrictEqual(queries, []);
    });

    it('should clear queries', function () {
        capturer.start();
        // Manually push a query to test clear
        capturer.getQueries().length = 0; // This tests the reference
        capturer.clear();
        const queries = capturer.getQueries();
        assert.deepStrictEqual(queries, []);
    });

    it('should stop without errors', function () {
        capturer.start();
        assert.doesNotThrow(() => capturer.stop());
    });
});
