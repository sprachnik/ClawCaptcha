/**
 * Interactive Bot Tests for ClawCaptcha Landing Page
 * These challenges are easy for bots but hard for humans
 */

(function() {
  'use strict';

  // Test state
  const testResults = {
    math: null,
    hash: null,
    schema: null
  };

  // ==================== Speed Math Test ====================

  let mathStartTime = null;
  let currentMathAnswer = null;
  const MATH_TIME_LIMIT = 500; // ms - bots should solve in ~2ms

  function generateMathProblem() {
    // Generate a moderately complex math problem
    const operations = [
      () => {
        const a = Math.floor(Math.random() * 100) + 50;
        const b = Math.floor(Math.random() * 100) + 50;
        const c = Math.floor(Math.random() * 50) + 10;
        return { problem: `${a} + ${b} - ${c}`, answer: a + b - c };
      },
      () => {
        const a = Math.floor(Math.random() * 50) + 20;
        const b = Math.floor(Math.random() * 20) + 5;
        const c = Math.floor(Math.random() * 100) + 50;
        return { problem: `${a} * ${b} + ${c}`, answer: a * b + c };
      },
      () => {
        const a = Math.floor(Math.random() * 30) + 10;
        const b = Math.floor(Math.random() * 30) + 10;
        const c = Math.floor(Math.random() * 30) + 10;
        return { problem: `${a} + ${b} + ${c}`, answer: a + b + c };
      },
      () => {
        const a = Math.floor(Math.random() * 20) + 10;
        const b = Math.floor(Math.random() * 10) + 2;
        return { problem: `${a * b} / ${b}`, answer: a };
      }
    ];

    const op = operations[Math.floor(Math.random() * operations.length)];
    return op();
  }

  function initMathTest() {
    const problemEl = document.getElementById('math-problem');
    const answerEl = document.getElementById('math-answer');
    const submitBtn = document.getElementById('math-submit');
    const resultEl = document.getElementById('math-result');

    if (!problemEl || !answerEl || !submitBtn || !resultEl) return;

    // Generate initial problem
    const { problem, answer } = generateMathProblem();
    currentMathAnswer = answer;
    problemEl.textContent = `${problem} = ?`;
    answerEl.disabled = false;
    submitBtn.disabled = false;

    // Start timer when user focuses on input
    answerEl.addEventListener('focus', function() {
      if (mathStartTime === null) {
        mathStartTime = performance.now();
      }
    });

    // Handle submission
    function submitMath() {
      if (mathStartTime === null) {
        mathStartTime = performance.now();
      }

      const elapsed = performance.now() - mathStartTime;
      const userAnswer = parseInt(answerEl.value, 10);

      if (isNaN(userAnswer)) {
        resultEl.textContent = 'Please enter a number!';
        resultEl.className = 'result failure';
        return;
      }

      const isCorrect = userAnswer === currentMathAnswer;
      const isFast = elapsed < MATH_TIME_LIMIT;

      if (isCorrect && isFast) {
        resultEl.innerHTML = `Correct in ${elapsed.toFixed(0)}ms! Are you secretly a bot?`;
        resultEl.className = 'result success';
        testResults.math = true;
      } else if (isCorrect) {
        resultEl.innerHTML = `Correct, but ${elapsed.toFixed(0)}ms is too slow for a bot. Bots solve this in <10ms!`;
        resultEl.className = 'result info';
        testResults.math = false;
      } else {
        resultEl.innerHTML = `Wrong! The answer was ${currentMathAnswer}. Time: ${elapsed.toFixed(0)}ms`;
        resultEl.className = 'result failure';
        testResults.math = false;
      }

      updateScore();

      // Disable for this session
      answerEl.disabled = true;
      submitBtn.disabled = true;
    }

    submitBtn.addEventListener('click', submitMath);
    answerEl.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') submitMath();
    });
  }

  // ==================== Hash/Nonce Finding Test ====================

  const HASH_PREFIX = 'clawcaptcha:';
  const REQUIRED_ZEROS = '000';

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function initHashTest() {
    const prefixEl = document.getElementById('hash-prefix');
    const answerEl = document.getElementById('hash-answer');
    const submitBtn = document.getElementById('hash-submit');
    const resultEl = document.getElementById('hash-result');

    if (!prefixEl || !answerEl || !submitBtn || !resultEl) return;

    prefixEl.textContent = HASH_PREFIX;

    async function checkHash() {
      const nonce = answerEl.value.trim();

      if (!nonce) {
        resultEl.textContent = 'Please enter a nonce!';
        resultEl.className = 'result failure';
        return;
      }

      const input = HASH_PREFIX + nonce;
      const hash = await sha256(input);

      if (hash.startsWith(REQUIRED_ZEROS)) {
        resultEl.innerHTML = `
          <strong>Nonce found!</strong><br>
          SHA256(${input}) = <code>${hash.substring(0, 16)}...</code><br>
          Wait, did you actually compute this manually? Impressive!
        `;
        resultEl.className = 'result success';
        testResults.hash = true;
      } else {
        resultEl.innerHTML = `
          Hash: <code>${hash.substring(0, 16)}...</code><br>
          Doesn't start with "${REQUIRED_ZEROS}". Keep trying!<br>
          <small>Hint: A bot would try thousands of values per second...</small>
        `;
        resultEl.className = 'result failure';
        testResults.hash = false;
      }

      updateScore();
    }

    submitBtn.addEventListener('click', checkHash);
    answerEl.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') checkHash();
    });

    // Add a "cheat" button for humans
    const footer = document.querySelector('#test-hash footer');
    if (footer) {
      const cheatBtn = document.createElement('button');
      cheatBtn.className = 'outline secondary';
      cheatBtn.style.marginTop = '0.5rem';
      cheatBtn.style.fontSize = '0.8rem';
      cheatBtn.textContent = 'Let a bot solve it';
      cheatBtn.addEventListener('click', async function() {
        cheatBtn.disabled = true;
        cheatBtn.textContent = 'Computing...';
        resultEl.textContent = 'Searching for valid nonce...';
        resultEl.className = 'result info';

        // Find a valid nonce (brute force)
        const startTime = performance.now();
        for (let i = 0; i < 1000000; i++) {
          const hash = await sha256(HASH_PREFIX + i);
          if (hash.startsWith(REQUIRED_ZEROS)) {
            const elapsed = performance.now() - startTime;
            answerEl.value = i;
            resultEl.innerHTML = `
              Found nonce <strong>${i}</strong> in ${elapsed.toFixed(0)}ms!<br>
              Hash: <code>${hash.substring(0, 16)}...</code><br>
              <em>See? Easy for a bot!</em>
            `;
            resultEl.className = 'result success';
            testResults.hash = true;
            updateScore();
            cheatBtn.textContent = 'Done!';
            return;
          }

          // Update progress every 10000 iterations
          if (i % 10000 === 0) {
            resultEl.textContent = `Tried ${i.toLocaleString()} values...`;
            await new Promise(r => setTimeout(r, 0)); // Let UI update
          }
        }

        cheatBtn.textContent = 'Try again';
        cheatBtn.disabled = false;
      });
      footer.appendChild(cheatBtn);
    }
  }

  // ==================== Schema Conformance Test ====================

  const SCHEMA = {
    type: 'object',
    required: ['name', 'version', 'capabilities'],
    properties: {
      name: { type: 'string', minLength: 1 },
      version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
      capabilities: { type: 'array', items: { type: 'string' }, minItems: 2 }
    }
  };

  function validateAgainstSchema(obj) {
    const errors = [];

    if (typeof obj !== 'object' || obj === null) {
      return ['Must be an object'];
    }

    // Check required fields
    for (const field of SCHEMA.required) {
      if (!(field in obj)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate name
    if ('name' in obj) {
      if (typeof obj.name !== 'string') {
        errors.push('name must be a string');
      } else if (obj.name.length < 1) {
        errors.push('name must have at least 1 character');
      }
    }

    // Validate version
    if ('version' in obj) {
      if (typeof obj.version !== 'string') {
        errors.push('version must be a string');
      } else if (!/^\d+\.\d+\.\d+$/.test(obj.version)) {
        errors.push('version must match pattern X.Y.Z (e.g., "1.0.0")');
      }
    }

    // Validate capabilities
    if ('capabilities' in obj) {
      if (!Array.isArray(obj.capabilities)) {
        errors.push('capabilities must be an array');
      } else {
        if (obj.capabilities.length < 2) {
          errors.push('capabilities must have at least 2 items');
        }
        for (let i = 0; i < obj.capabilities.length; i++) {
          if (typeof obj.capabilities[i] !== 'string') {
            errors.push(`capabilities[${i}] must be a string`);
          }
        }
      }
    }

    return errors;
  }

  function initSchemaTest() {
    const answerEl = document.getElementById('schema-answer');
    const submitBtn = document.getElementById('schema-submit');
    const resultEl = document.getElementById('schema-result');

    if (!answerEl || !submitBtn || !resultEl) return;

    function validateSchema() {
      const input = answerEl.value.trim();

      if (!input) {
        resultEl.textContent = 'Please enter some JSON!';
        resultEl.className = 'result failure';
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(input);
      } catch (e) {
        resultEl.innerHTML = `<strong>Invalid JSON:</strong> ${e.message}`;
        resultEl.className = 'result failure';
        testResults.schema = false;
        updateScore();
        return;
      }

      const errors = validateAgainstSchema(parsed);

      if (errors.length === 0) {
        resultEl.innerHTML = `
          <strong>Valid JSON!</strong><br>
          You generated conformant JSON. Are you sure you're not a bot?
        `;
        resultEl.className = 'result success';
        testResults.schema = true;
      } else {
        resultEl.innerHTML = `
          <strong>Schema validation failed:</strong><br>
          ${errors.map(e => `- ${e}`).join('<br>')}
        `;
        resultEl.className = 'result failure';
        testResults.schema = false;
      }

      updateScore();
    }

    submitBtn.addEventListener('click', validateSchema);
    answerEl.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && e.ctrlKey) validateSchema();
    });

    // Pre-fill with a hint
    answerEl.placeholder = '{"name": "MyBot", "version": "1.0.0", "capabilities": ["read", "write"]}';
  }

  // ==================== Score Calculation ====================

  function updateScore() {
    const scoreEl = document.getElementById('bot-score');
    const verdictEl = document.getElementById('score-verdict');
    const breakdownEl = document.getElementById('score-breakdown');

    if (!scoreEl || !verdictEl) return;

    // Calculate score
    let passed = 0;
    let total = 0;

    for (const [test, result] of Object.entries(testResults)) {
      if (result !== null) {
        total++;
        if (result) passed++;
      }

      // Update breakdown
      if (breakdownEl) {
        const item = breakdownEl.querySelector(`[data-test="${test}"]`);
        if (item) {
          const status = item.querySelector('.test-status');
          if (result === null) {
            status.textContent = '\u23F3';
          } else if (result) {
            status.textContent = '\u2705';
          } else {
            status.textContent = '\u274C';
          }
        }
      }
    }

    const percentage = total > 0 ? Math.round((passed / total) * 100) : 0;
    scoreEl.textContent = percentage;

    // Update verdict
    if (total === 0) {
      verdictEl.textContent = 'Complete the tests above!';
    } else if (percentage >= 100) {
      verdictEl.textContent = 'Perfect score! You might actually be a bot.';
    } else if (percentage >= 66) {
      verdictEl.textContent = 'Impressive! Bot-like performance.';
    } else if (percentage >= 33) {
      verdictEl.textContent = 'Halfway there. Keep trying!';
    } else {
      verdictEl.textContent = 'Definitely human. Too slow, too error-prone.';
    }
  }

  // ==================== Initialize ====================

  document.addEventListener('DOMContentLoaded', function() {
    initMathTest();
    initHashTest();
    initSchemaTest();
    updateScore();
  });
})();
