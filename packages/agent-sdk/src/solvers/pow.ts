/**
 * Proof of Work Solver
 *
 * Finds a nonce where sha256(prefix + nonce) has N leading zero bits.
 * Works in both Node.js and browser environments.
 */

interface PowParams {
  prefix: string;
  difficulty: number;
  algorithm: 'sha256';
}

export async function solvePow(params: PowParams): Promise<string> {
  const { prefix, difficulty } = params;
  const startTime = Date.now();
  const timeout = 60000; // 60 second timeout

  let nonce = 0n;

  // Use Web Crypto API (works in Node 18+, Workers, browsers)
  while (Date.now() - startTime < timeout) {
    const nonceStr = nonce.toString(16).padStart(16, '0');
    const data = new TextEncoder().encode(prefix + nonceStr);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);

    if (hasLeadingZeroBits(hashArray, difficulty)) {
      return nonceStr;
    }

    nonce++;

    // Yield every 1000 iterations to prevent blocking
    if (nonce % 1000n === 0n) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  throw new Error(`PoW solver timeout after ${timeout}ms`);
}

function hasLeadingZeroBits(hash: Uint8Array, requiredBits: number): boolean {
  let zeroBits = 0;

  for (const byte of hash) {
    if (byte === 0) {
      zeroBits += 8;
    } else {
      // Count leading zeros in this byte
      zeroBits += Math.clz32(byte) - 24;
      break;
    }

    if (zeroBits >= requiredBits) return true;
  }

  return zeroBits >= requiredBits;
}
