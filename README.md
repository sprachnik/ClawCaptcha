# ClawCaptcha

> If you find this useful, you can [buy me a coffee ☕](https://buymeacoffee.com/jamesstalleymoores) — entirely optional, but deeply appreciated.

**Prove you're a bot.** ClawCaptcha is the inverse CAPTCHA for the agent web — a small open protocol that lets AI agents prove they're legitimate bots acting on behalf of authenticated users. Where traditional CAPTCHAs block bots, ClawCaptcha rewards high bot-confidence with a PASS. It's built around tiny challenges that are trivial for code (~1–2s) and impossible for humans: proof-of-work, JSON schema conformance, and passive signal analysis, all wrapped in a verifiable JWT. The whole stack runs cheaply on Cloudflare Workers (or anywhere Node can run), and the agent SDK speaks both standalone and inline-401 flows so you can drop it into existing APIs without rewriting them.

## Quick Start

### For API Developers (Protecting Your API)

```bash
# Install
npm install @clawcaptcha/server

# Or deploy to Cloudflare Workers
cd packages/server
npx wrangler deploy
```

```typescript
import { Hono } from 'hono';
import clawcaptcha from '@clawcaptcha/server';

const app = new Hono();

// Mount ClawCaptcha
app.route('/captcha', clawcaptcha);

// Your protected endpoint checks the token
app.post('/api/register', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('ClawCaptcha ')) {
    return c.json({ error: 'Token required' }, 401);
  }

  // Verify token
  const verify = await fetch('http://localhost:8787/captcha/v1/verify', {
    method: 'POST',
    body: JSON.stringify({ token: auth.slice(12) }),
  });

  const result = await verify.json();
  if (!result.valid || result.verifiedAs !== 'bot') {
    return c.json({ error: 'Bot verification required' }, 403);
  }

  // Process request...
});
```

### For Agent Developers (Proving Bot Identity)

```bash
npm install @clawcaptcha/agent-sdk
```

```typescript
import { ClawCaptchaAgent } from '@clawcaptcha/agent-sdk';

const agent = new ClawCaptchaAgent({
  serverUrl: 'https://your-clawcaptcha-deployment.example.com',
  agentName: 'MyBot',
  agentVersion: '1.0.0',
  capabilities: ['web-crawling', 'content-indexing'],
});

// Get a verification token
const result = await agent.solve();
console.log(result.token);      // "eyJ..."
console.log(result.verifiedAs); // "bot"
console.log(result.score);      // 0.95

// Use token in requests
await fetch('https://api.example.com/register', {
  headers: {
    'Authorization': `ClawCaptcha ${result.token}`,
  },
});
```

### CLI

```bash
# Prove bot identity
npx clawcaptcha prove --url http://localhost:8787

# Verify a token
npx clawcaptcha verify --url http://localhost:8787 --token "eyJ..."
```

## Inline Challenge Flow

For API-first integrations, ClawCaptcha supports inline challenges in 401 responses:

```
1. Agent: POST /api/register
2. Server: 401 { error: "clawcaptcha_required", challenge: {...} }
3. Agent: [solves challenge locally]
4. Agent: POST /api/register + X-ClawCaptcha-Solution header
5. Server: 200 OK + X-ClawCaptcha-Token header
```

The SDK handles this automatically:

```typescript
const response = await agent.solveInline('https://api.example.com/register', {
  method: 'POST',
  body: JSON.stringify({ name: 'MyBot' }),
});
```

## Protocol

See [PROTOCOL.md](PROTOCOL.md) for the full specification.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/challenge/issue` | POST | Issue a new challenge |
| `/v1/challenge/solve` | POST | Submit solution, get token |
| `/v1/verify` | POST | Verify a token |
| `/v1/health` | GET | Health check |
| `/v1/.well-known/clawcaptcha.json` | GET | Discovery |

### Challenge Types

**Proof of Work:**
```json
{
  "type": "pow",
  "params": {
    "prefix": "clawcaptcha:abc123:",
    "difficulty": 18,
    "algorithm": "sha256"
  }
}
```
Find nonce where `SHA256(prefix + nonce)` has 18 leading zero bits.

**Schema Conformance:**
```json
{
  "type": "schema",
  "params": {
    "schema": { "type": "object", "required": ["agentName"] },
    "description": "Declare your agent identity"
  }
}
```
Generate valid JSON matching the schema.

## Development

```bash
# Clone
git clone https://github.com/sprachnik/ClawCaptcha.git
cd ClawCaptcha

# Install dependencies
pnpm install

# Start local server (no Cloudflare account needed!)
cd packages/server
pnpm dev

# In another terminal, test with CLI
cd packages/agent-sdk
pnpm build
node dist/cli.js prove --url http://localhost:8787
```

## Packages

| Package | Description |
|---------|-------------|
| [@clawcaptcha/server](packages/server) | Hono server for Cloudflare Workers |
| [@clawcaptcha/agent-sdk](packages/agent-sdk) | SDK + CLI for agents |

## Hosting

ClawCaptcha is designed to be cheap to host:

| Platform | Free Tier | Notes |
|----------|-----------|-------|
| **Cloudflare Workers** | 100k req/day | Recommended |
| Vercel Edge | 100k req/mo | More expensive |
| Fly.io | 3 shared VMs | Scales to zero |
| Self-hosted | — | Any Node.js host |

Verification is computationally cheap (one hash check + JWT verify), so you can handle millions of requests on the free tier.

## Roadmap

- [x] Core protocol
- [x] PoW + Schema challenges
- [x] Agent SDK + CLI
- [x] Cloudflare Workers deployment
- [ ] Browser widget
- [ ] Plugin system
- [ ] Dashboard + analytics
- [ ] Additional challenge types (WASM, matrix)

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free to use, study, modify, and share for noncommercial purposes. For commercial use, please get in touch.
