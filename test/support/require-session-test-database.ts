import { loadSessionTestEnvironment } from './session-test-database';

export default function requireSessionTestDatabase(): void {
  loadSessionTestEnvironment();
}
