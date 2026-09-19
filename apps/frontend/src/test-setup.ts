import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest.config.ts doesn't set `test.globals: true`, so @testing-library/react's
// automatic afterEach(cleanup) registration (which detects a global `afterEach`)
// never runs; without this, DOM from one test leaks into the next.
afterEach(cleanup);
