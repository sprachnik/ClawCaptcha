#!/usr/bin/env npx tsx
/**
 * ClawCaptcha Demo Script
 *
 * This script demonstrates the full flow:
 * 1. Issue a challenge
 * 2. Solve it using the agent SDK
 * 3. Verify the token
 *
 * Usage: npx tsx scripts/demo.ts [server-url]
 */

import { ClawCaptchaAgent } from '../packages/agent-sdk/src/index';

const SERVER_URL = process.argv[2] || 'http://localhost:8787';

async function main() {
  console.log('\n🦞 ClawCaptcha Demo\n');
  console.log(`Server: ${SERVER_URL}\n`);

  // Check if server is running
  try {
    const health = await fetch(`${SERVER_URL}/v1/health`);
    if (!health.ok) {
      console.error('❌ Server not responding. Start it with: cd packages/server && pnpm dev');
      process.exit(1);
    }
    console.log('✓ Server is running\n');
  } catch {
    console.error('❌ Cannot connect to server. Start it with: cd packages/server && pnpm dev');
    process.exit(1);
  }

  // Create agent
  const agent = new ClawCaptchaAgent({
    serverUrl: SERVER_URL,
    agentName: 'DemoBot',
    agentVersion: '1.0.0',
    capabilities: ['demo', 'testing'],
    purpose: 'testing',
  });

  console.log('📋 Requesting challenge...');
  const startTime = Date.now();

  // Solve challenge
  const result = await agent.solve();
  const duration = Date.now() - startTime;

  console.log(`\n⏱️  Completed in ${duration}ms\n`);

  if (result.success) {
    console.log('✓ Verification successful!\n');
    console.log(`   Verified as: ${result.verifiedAs}`);
    console.log(`   Score:       ${result.score?.toFixed(3)}`);
    console.log(`\n📝 Token (first 80 chars):`);
    console.log(`   ${result.token?.substring(0, 80)}...`);

    // Verify the token
    console.log('\n🔍 Verifying token...');
    const verifyResponse = await fetch(`${SERVER_URL}/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: result.token }),
    });

    const verification = await verifyResponse.json();
    console.log(`\n✓ Token verified: ${verification.valid}`);
    console.log(`   Expires: ${new Date(verification.expiresAt * 1000).toISOString()}`);
  } else {
    console.log('✗ Verification failed\n');
    console.log(`   Error: ${result.error}`);
    process.exit(1);
  }

  console.log('\n✨ Demo complete!\n');
}

main().catch(console.error);
