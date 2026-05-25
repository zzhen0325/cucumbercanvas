import { FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  // No authentication required for this project
  console.log('🚀 Global setup complete (no authentication required).');
}

export default globalSetup;
