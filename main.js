/**
 * main.js (entry)
 * Thin entry that delegates to src/main/bootstrap.js for maintainability.
 */
const { start } = require('./src/main/bootstrap');

start({ rootDir: __dirname });
