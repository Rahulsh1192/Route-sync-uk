/**
 * Jest was already a dependency but had no configuration and no tests, so `npm test`
 * exited non-zero on "no tests found". This wires ts-jest up so the suites added from
 * Phase 27 onwards can run.
 *
 * `roots` covers both src and scripts: some logic worth testing (the test-centre importer's
 * CSV parsing and its town-mismatch check) lives in scripts/, not src/.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // The DTO/controller decorators need this, and ts-jest otherwise warns on every file.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  clearMocks: true,
};
