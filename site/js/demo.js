/**
 * Live Demo for ClawCaptcha Landing Page
 * Simulates the full verification flow in-browser (no server required)
 */

(function() {
  'use strict';

  // Demo state
  let isRunning = false;

  // ==================== Challenge Solvers ====================

  /**
   * Solve Proof of Work challenge
   */
  async function solvePow(params) {
    const { prefix, difficulty } = params;
    const target = '0'.repeat(Math.ceil(difficulty / 4));

    for (let nonce = 0; nonce < 10000000; nonce++) {
      const input = prefix + nonce;
      const msgBuffer = new TextEncoder().encode(input);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (hash.startsWith(target)) {
        return { nonce, hash };
      }

      // Yield to prevent blocking
      if (nonce % 5000 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    throw new Error('Could not find valid nonce');
  }

  /**
   * Solve Schema challenge
   */
  function solveSchema(params) {
    const schema = params.schema;
    const result = {};

    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.type === 'string') {
          if (prop.pattern && prop.pattern.includes('\\d+\\.\\d+\\.\\d+')) {
            result[key] = '1.0.0';
          } else {
            result[key] = 'ClawCaptcha-Demo-Agent';
          }
        } else if (prop.type === 'array') {
          const minItems = prop.minItems || 1;
          result[key] = Array.from({ length: minItems }, (_, i) => `capability-${i + 1}`);
        } else if (prop.type === 'number' || prop.type === 'integer') {
          result[key] = prop.minimum || 0;
        } else if (prop.type === 'boolean') {
          result[key] = true;
        }
      }
    }

    return result;
  }

  // ==================== Simulated Server ====================

  function generateChallengeId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateHexPrefix() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'clawcaptcha:' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('') + ':';
  }

  function simulateIssueChallenge() {
    return {
      id: generateChallengeId(),
      challenges: [
        {
          type: 'pow',
          params: { prefix: generateHexPrefix(), difficulty: 12 }
        },
        {
          type: 'schema',
          params: {
            schema: {
              type: 'object',
              required: ['name', 'version', 'capabilities'],
              properties: {
                name: { type: 'string', minLength: 1 },
                version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
                capabilities: { type: 'array', items: { type: 'string' }, minItems: 2 }
              }
            }
          }
        }
      ],
      expiresAt: Date.now() + 300000
    };
  }

  // ==================== UI Helpers ====================

  function setStepStatus(stepId, status, output) {
    const step = document.getElementById(stepId);
    if (!step) return;

    const statusEl = step.querySelector('.step-status');
    const outputEl = step.querySelector('.step-output');

    if (statusEl) {
      const icons = {
        pending: '\u23F3',
        running: '\u23F3',
        success: '\u2705',
        error: '\u274C'
      };
      statusEl.textContent = icons[status] || '';
    }

    if (outputEl && output) {
      outputEl.textContent = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    }
  }

  function setDemoResult(success, message) {
    const resultEl = document.getElementById('demo-result');
    if (!resultEl) return;

    resultEl.innerHTML = '<p>' + message + '</p>';
    resultEl.className = 'demo-result ' + (success ? 'success' : 'failure');
  }

  function resetDemo() {
    setStepStatus('step-issue', 'pending');
    setStepStatus('step-solve', 'pending');
    setStepStatus('step-verify', 'pending');

    // Clear output pres
    document.querySelectorAll('.step-output').forEach(function(el) { el.textContent = ''; });

    var resultEl = document.getElementById('demo-result');
    if (resultEl) {
      resultEl.innerHTML = '<p>Click "Run Verification" to see ClawCaptcha in action!</p>';
      resultEl.className = 'demo-result';
    }
  }

  // ==================== Main Demo Flow ====================

  async function runDemo() {
    if (isRunning) return;
    isRunning = true;

    var runBtn = document.getElementById('run-demo');

    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Running...';
    }

    resetDemo();

    try {
      // Step 1: Issue Challenge (simulated)
      setStepStatus('step-issue', 'running', 'Requesting challenge set...');
      await new Promise(function(r) { setTimeout(r, 300); }); // simulate network delay

      var challengeSet = simulateIssueChallenge();

      setStepStatus('step-issue', 'success', JSON.stringify({
        id: challengeSet.id,
        challenges: challengeSet.challenges.map(function(c) {
          return {
            type: c.type,
            params: c.type === 'pow'
              ? { difficulty: c.params.difficulty, prefix: c.params.prefix.substring(0, 20) + '...' }
              : { schema: '(JSON Schema)' }
          };
        }),
        expiresAt: new Date(challengeSet.expiresAt).toISOString()
      }, null, 2));

      // Step 2: Solve Challenges
      setStepStatus('step-solve', 'running', 'Solving challenges...');

      var solutions = [];
      var solveDetails = [];

      for (var i = 0; i < challengeSet.challenges.length; i++) {
        var challenge = challengeSet.challenges[i];
        var startTime = performance.now();

        if (challenge.type === 'pow') {
          var powResult = await solvePow(challenge.params);
          var elapsed = performance.now() - startTime;

          solutions.push({ type: 'pow', value: powResult.nonce });
          solveDetails.push({
            type: 'pow',
            nonce: powResult.nonce,
            hash: powResult.hash.substring(0, 16) + '...',
            timeMs: Math.round(elapsed)
          });
        } else if (challenge.type === 'schema') {
          var schemaResponse = solveSchema(challenge.params);
          var schemaElapsed = performance.now() - startTime;

          solutions.push({ type: 'schema', value: schemaResponse });
          solveDetails.push({
            type: 'schema',
            response: schemaResponse,
            timeMs: Math.round(schemaElapsed)
          });
        }
      }

      setStepStatus('step-solve', 'success', JSON.stringify({
        solutions: solveDetails,
        totalTimeMs: solveDetails.reduce(function(sum, s) { return sum + s.timeMs; }, 0)
      }, null, 2));

      // Step 3: Verify (simulated)
      setStepStatus('step-verify', 'running', 'Submitting solutions...');
      await new Promise(function(r) { setTimeout(r, 200); }); // simulate network delay

      var totalMs = solveDetails.reduce(function(sum, s) { return sum + s.timeMs; }, 0);
      var score = totalMs < 5000 ? 0.92 : 0.65;

      setStepStatus('step-verify', 'success', JSON.stringify({
        success: true,
        verifiedAs: 'bot',
        score: score,
        token: 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJjbGF3Y2FwdGNoYSIs...'
      }, null, 2));

      // Show final result
      var scorePercent = Math.round(score * 100);
      setDemoResult(true,
        '<strong>Verification Complete!</strong><br><br>' +
        '<strong>Status:</strong> Verified as <code>bot</code><br>' +
        '<strong>Bot Score:</strong> ' + scorePercent + '% (Definitely a bot)<br><br>' +
        'The JWT token can now be used to access protected resources.'
      );

    } catch (error) {
      console.error('Demo error:', error);
      setDemoResult(false,
        '<strong>Error:</strong> ' + error.message + '<br><br>' +
        'Something went wrong running the simulation.'
      );

      // Mark failed step
      var steps = ['step-issue', 'step-solve', 'step-verify'];
      for (var j = 0; j < steps.length; j++) {
        var el = document.getElementById(steps[j]);
        var statusEl = el && el.querySelector('.step-status');
        if (statusEl && statusEl.textContent === '\u23F3') {
          setStepStatus(steps[j], 'error');
          break;
        }
      }
    } finally {
      isRunning = false;

      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Verification';
      }
    }
  }

  // ==================== Initialize ====================

  document.addEventListener('DOMContentLoaded', function() {
    var runBtn = document.getElementById('run-demo');
    if (runBtn) {
      runBtn.addEventListener('click', runDemo);
    }
  });
})();
