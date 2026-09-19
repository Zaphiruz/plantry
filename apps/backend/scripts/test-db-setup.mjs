import { execSync } from 'node:child_process';
const URL = process.env.TEST_DATABASE_URL ?? 'postgres://plantry:plantry@localhost:5434/plantry_test';
try {
  execSync('docker compose exec -T postgres psql -U plantry -d plantry -c "CREATE DATABASE plantry_test"', {
    stdio: 'inherit', cwd: new URL('../../..', import.meta.url),
  });
} catch { /* already exists */ }
execSync('corepack pnpm exec prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: URL } });
