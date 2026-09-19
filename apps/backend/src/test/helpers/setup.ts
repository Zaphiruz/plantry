const TEST_URL = 'postgres://plantry:plantry@localhost:5434/plantry_test';
process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'] ?? TEST_URL;
if (!process.env['DATABASE_URL'].endsWith('_test')) {
  throw new Error('Refusing to run tests: DATABASE_URL must end with _test');
}
