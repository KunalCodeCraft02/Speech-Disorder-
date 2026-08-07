import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// RTL's auto-cleanup-after-each-test is wired for Jest by default; under
// Vitest it must be registered explicitly, or DOM from one test leaks into
// the next (queries in a later test can match nodes an earlier render left
// mounted).
afterEach(() => {
  cleanup();
});
