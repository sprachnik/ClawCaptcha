# ClawCaptcha Protocol Specification

**Version:** 0.1.0
**Status:** Draft
**Authors:** ClawCaptcha Team
**URL:** https://clawcaptcha.com/protocol

## Abstract

The ClawCaptcha Protocol defines a challenge-response mechanism for verifying that an HTTP client is a legitimate automated agent (bot) rather than a human user. This is the inverse of traditional CAPTCHA systems, which verify human identity.

## 1. Introduction

### 1.1 Problem Statement

Traditional CAPTCHAs exist to block bots. However, the emerging "agent web" requires legitimate AI agents to access web services on behalf of authenticated users. There is no standard mechanism for these agents to prove their legitimacy.

### 1.2 Goals

- Define a standard protocol for bot verification
- Enable challenge-response flows that are trivial for code but impractical for humans
- Support both standalone and inline (401-based) verification flows
- Remain transport-agnostic and implementable on any HTTP stack

### 1.3 Non-Goals

- Human verification (use traditional CAPTCHA)
- Agent authorization (use OAuth 2.1)
- Agent identity attestation (use RFC 9421 HTTP Signatures)

## 2. Protocol Overview

```
┌─────────────┐                              ┌─────────────────┐
│   Client    │                              │  ClawCaptcha    │
│   (Agent)   │                              │  Server         │
└─────────────┘                              └─────────────────┘
       │                                            │
       │  1. POST /v1/challenge/issue               │
       │───────────────────────────────────────────▶│
       │                                            │
       │  2. {challengeId, challenges[], expiresAt} │
       │◀───────────────────────────────────────────│
       │                                            │
       │        [Client solves challenges]          │
       │                                            │
       │  3. POST /v1/challenge/solve               │
       │     {challengeId, solutions[]}             │
       │───────────────────────────────────────────▶│
       │                                            │
       │  4. {success, token, verifiedAs, score}    │
       │◀───────────────────────────────────────────│
```

## 3. Discovery

### 3.1 Well-Known Endpoint

Servers MUST provide a discovery document at:

```
GET /.well-known/clawcaptcha.json
```

Or within a versioned API:

```
GET /v1/.well-known/clawcaptcha.json
```

### 3.2 Discovery Document Format

```json
{
  "version": "0.1.0",
  "protocol": "https://clawcaptcha.com/protocol",
  "endpoints": {
    "issue": "/v1/challenge/issue",
    "solve": "/v1/challenge/solve",
    "verify": "/v1/verify"
  },
  "challenges": ["pow", "schema"],
  "pow": {
    "algorithm": "sha256",
    "difficulty": 18
  }
}
```

## 4. Challenge Types

### 4.1 Proof of Work (pow)

Find a nonce such that `SHA256(prefix + nonce)` has N leading zero bits.

**Parameters:**
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

**Solution:**
```json
{
  "type": "pow",
  "value": "00000000000a3f2b"
}
```

The solution is a hex-encoded nonce. The server verifies that `SHA256(prefix + nonce)` has at least `difficulty` leading zero bits.

**Rationale:** Trivial for code (~1-2s), impractical for humans to compute manually.

### 4.2 Schema Conformance (schema)

Generate a valid JSON document conforming to a given JSON Schema.

**Parameters:**
```json
{
  "type": "schema",
  "params": {
    "schema": {
      "type": "object",
      "required": ["agentName", "agentVersion"],
      "properties": {
        "agentName": { "type": "string", "minLength": 1 },
        "agentVersion": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+" }
      }
    },
    "description": "Declare your agent identity"
  }
}
```

**Solution:**
```json
{
  "type": "schema",
  "value": {
    "agentName": "MyBot",
    "agentVersion": "1.0.0"
  }
}
```

**Rationale:** Trivial for code (JSON generation), tedious for humans under time pressure.

### 4.3 Extensibility

Additional challenge types MAY be defined. Servers MUST advertise supported types in the discovery document. Clients SHOULD ignore unknown challenge types and solve only those they support.

## 5. Endpoints

### 5.1 Issue Challenge

```
POST /v1/challenge/issue
Content-Type: application/json

{}
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "challenges": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000:pow",
      "type": "pow",
      "params": { "prefix": "clawcaptcha:...", "difficulty": 18, "algorithm": "sha256" },
      "expiresAt": 1234567890000
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440000:schema",
      "type": "schema",
      "params": { "schema": {...}, "description": "..." },
      "expiresAt": 1234567890000
    }
  ],
  "expiresAt": 1234567890000,
  "issuedAt": 1234567590000
}
```

### 5.2 Solve Challenge

```
POST /v1/challenge/solve
Content-Type: application/json

{
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "solutions": [
    { "type": "pow", "value": "00000000000a3f2b" },
    { "type": "schema", "value": { "agentName": "MyBot", "agentVersion": "1.0.0" } }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "verifiedAs": "bot",
  "score": 0.95
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Invalid solution for pow challenge"
}
```

### 5.3 Verify Token

```
POST /v1/verify
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "verifiedAs": "bot",
  "score": 0.95,
  "expiresAt": 1234567890
}
```

**Response (401 Unauthorized):**
```json
{
  "valid": false,
  "error": "Token expired"
}
```

## 6. Inline Challenge Flow

For API-first integrations, servers MAY embed challenges in 401 responses.

### 6.1 Initial Request

```
POST /api/protected-endpoint
```

### 6.2 Challenge Response

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: ClawCaptcha challenge="base64-encoded-challenge"
Content-Type: application/json

{
  "error": "clawcaptcha_required",
  "challenge": {
    "id": "...",
    "challenges": [...],
    "expiresAt": 1234567890000
  }
}
```

### 6.3 Retry with Solution

```
POST /api/protected-endpoint
X-ClawCaptcha-Solution: base64-encoded-solution
```

Where the solution payload is:
```json
{
  "challengeId": "...",
  "solutions": [...]
}
```

### 6.4 Success Response

```
HTTP/1.1 200 OK
X-ClawCaptcha-Token: eyJhbGciOiJIUzI1NiIs...

{
  "success": true,
  ...
}
```

## 7. Token Format

Tokens are JSON Web Tokens (JWT) with the following claims:

| Claim | Type | Description |
|-------|------|-------------|
| `iss` | string | Issuer (e.g., "clawcaptcha.com") |
| `sub` | string | Subject (client identifier) |
| `aud` | string | Audience |
| `exp` | number | Expiration time (Unix timestamp) |
| `iat` | number | Issued at (Unix timestamp) |
| `jti` | string | JWT ID (unique identifier) |
| `clw` | object | ClawCaptcha-specific claims |

### 7.1 ClawCaptcha Claims (`clw`)

```json
{
  "clw": {
    "verified": "bot",
    "score": 0.95,
    "challenges": ["pow", "schema"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `verified` | "bot" \| "human" | Verification result |
| `score` | number | Bot probability (0-1) |
| `challenges` | string[] | Challenge types completed |

## 8. Scoring

The `score` field represents the server's confidence that the client is a bot, based on:

- Challenge completion time
- HTTP header analysis (User-Agent, Sec-Fetch-*, etc.)
- Behavioral signals (if available from widget)

| Score Range | Interpretation |
|-------------|----------------|
| 0.0 - 0.3 | Likely human |
| 0.3 - 0.7 | Uncertain |
| 0.7 - 1.0 | Likely bot |

## 9. Security Considerations

### 9.1 Challenge Expiration

Challenges MUST expire. Recommended TTL: 5 minutes.

### 9.2 One-Time Use

Challenges MUST be single-use. After verification (success or failure), the challenge MUST be invalidated.

### 9.3 Token Lifetime

Tokens SHOULD be short-lived. Recommended TTL: 5-15 minutes.

### 9.4 Difficulty Tuning

PoW difficulty SHOULD be tuned so that:
- Bots solve in 1-5 seconds
- Humans cannot solve manually within the TTL

### 9.5 Rate Limiting

Servers SHOULD implement rate limiting on challenge issuance to prevent abuse.

## 10. IANA Considerations

This document defines:

- HTTP Authentication Scheme: `ClawCaptcha`
- HTTP Header: `X-ClawCaptcha-Solution`
- HTTP Header: `X-ClawCaptcha-Token`
- Well-Known URI: `clawcaptcha.json`

## 11. References

- [RFC 9421](https://datatracker.ietf.org/doc/rfc9421/) - HTTP Message Signatures
- [RFC 7519](https://datatracker.ietf.org/doc/rfc7519/) - JSON Web Token (JWT)
- [RFC 8615](https://datatracker.ietf.org/doc/rfc8615/) - Well-Known URIs

## Appendix A: Example Flow

```bash
# 1. Issue challenge
curl -X POST https://clawcaptcha.com/v1/challenge/issue

# 2. Solve and submit
curl -X POST https://clawcaptcha.com/v1/challenge/solve \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"...","solutions":[...]}'

# 3. Use token
curl https://api.example.com/protected \
  -H "Authorization: ClawCaptcha eyJ..."
```

## Appendix B: Reference Implementations

- **Server:** `@clawcaptcha/server` (TypeScript, Cloudflare Workers)
- **Agent SDK:** `@clawcaptcha/agent-sdk` (TypeScript, Node.js)
- **CLI:** `npx clawcaptcha prove --url <server>`

---

*This specification is released under the MIT License.*
