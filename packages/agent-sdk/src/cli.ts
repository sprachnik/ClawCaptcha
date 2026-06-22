#!/usr/bin/env node
/**
 * ClawCaptcha CLI
 *
 * Usage: npx clawcaptcha prove --url https://example.com/captcha
 */

import { ClawCaptchaAgent } from './index';

const VERSION = '0.1.0';

const HELP = `
ClawCaptcha CLI v${VERSION}
Prove you're a bot. The inverse CAPTCHA for the agent web.

Usage:
  clawcaptcha prove --url <server-url> [options]
  clawcaptcha verify --url <server-url> --token <token>

Commands:
  prove     Solve a ClawCaptcha challenge and get a verification token
  verify    Verify an existing token

Options:
  --url        ClawCaptcha server URL (required)
  --name       Agent name (default: ClawCaptchaCLI)
  --version    Agent version (default: 1.0.0)
  --token      Token to verify (for verify command)
  --json       Output result as JSON
  --help, -h   Show this help message

Examples:
  clawcaptcha prove --url http://localhost:8787
  clawcaptcha prove --url https://clawcaptcha.com --name "MyBot" --json
  clawcaptcha verify --url http://localhost:8787 --token "eyJ..."

Learn more: https://clawcaptcha.com
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];
  const urlIndex = args.indexOf('--url');
  const nameIndex = args.indexOf('--name');
  const versionIndex = args.indexOf('--version');
  const tokenIndex = args.indexOf('--token');
  const jsonOutput = args.includes('--json');

  if (urlIndex === -1 || !args[urlIndex + 1]) {
    console.error('Error: --url is required\n');
    console.log(HELP);
    process.exit(1);
  }

  const serverUrl = args[urlIndex + 1];
  const agentName = nameIndex !== -1 && args[nameIndex + 1] ? args[nameIndex + 1] : 'ClawCaptchaCLI';
  const agentVersion = versionIndex !== -1 && args[versionIndex + 1] ? args[versionIndex + 1] : '1.0.0';

  if (command === 'prove') {
    await runProve(serverUrl, agentName, agentVersion, jsonOutput);
  } else if (command === 'verify') {
    const token = tokenIndex !== -1 ? args[tokenIndex + 1] : null;
    if (!token) {
      console.error('Error: --token is required for verify command\n');
      process.exit(1);
    }
    await runVerify(serverUrl, token, jsonOutput);
  } else {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exit(1);
  }
}

async function runProve(serverUrl: string, agentName: string, agentVersion: string, jsonOutput: boolean) {
  if (!jsonOutput) {
    console.log(`\n🦞 ClawCaptcha - Proving bot identity...\n`);
    console.log(`   Server:  ${serverUrl}`);
    console.log(`   Agent:   ${agentName}/${agentVersion}\n`);
  }

  const agent = new ClawCaptchaAgent({
    serverUrl,
    agentName,
    agentVersion,
    capabilities: ['cli'],
    purpose: 'testing',
  });

  const result = await agent.solve();

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      console.log(`✓ Verification successful!\n`);
      console.log(`   Verified as: ${result.verifiedAs}`);
      console.log(`   Score:       ${result.score?.toFixed(3)}`);
      console.log(`   Duration:    ${result.durationMs}ms\n`);
      console.log(`Token:\n${result.token}\n`);
    } else {
      console.log(`✗ Verification failed\n`);
      console.log(`   Error: ${result.error}\n`);
    }
  }

  process.exit(result.success ? 0 : 1);
}

async function runVerify(serverUrl: string, token: string, jsonOutput: boolean) {
  if (!jsonOutput) {
    console.log(`\n🦞 ClawCaptcha - Verifying token...\n`);
  }

  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  const result = await response.json() as {
    valid: boolean;
    verifiedAs?: string;
    score?: number;
    expiresAt?: number;
    error?: string;
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.valid) {
      console.log(`✓ Token is valid\n`);
      console.log(`   Verified as: ${result.verifiedAs}`);
      console.log(`   Score:       ${result.score?.toFixed(3)}`);
      console.log(`   Expires:     ${new Date((result.expiresAt ?? 0) * 1000).toISOString()}\n`);
    } else {
      console.log(`✗ Token is invalid\n`);
      console.log(`   Error: ${result.error}\n`);
    }
  }

  process.exit(result.valid ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
