const express = require('express');
const cors = require('cors');

const app = express();

// ─── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const GROQ_KEY = process.env.GROQ_API_KEY; // Requires GROQ_API_KEY in environment
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// CSP — allow fonts, inline styles, and external API calls
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"
  );
  next();
});

// Serve the frontend from the same port
app.use(express.static(__dirname));

// ─── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(symptoms) {
  return `You are a clinical nutritionist AI. A user in Hyderabad, India reports these symptoms: ${symptoms.join(', ')}.

Return ONLY a valid JSON object with this exact structure (no markdown, no code fences, no explanation):
{
  "deficiencies": [
    {
      "name": "Nutrient name",
      "level": 25,
      "confidence": 87,
      "severity": "Low",
      "reason": "One sentence explanation linking these symptoms to the deficiency.",
      "color": "#d4614a",
      "foods": [
        { "name": "Indian food name", "emoji": "🥬", "benefit": "Short benefit in 6 words", "nutrientAmount": "3mg" },
        { "name": "Indian food name", "emoji": "🫘", "benefit": "Short benefit in 6 words", "nutrientAmount": "2mg" },
        { "name": "Indian food name", "emoji": "🥚", "benefit": "Short benefit in 6 words", "nutrientAmount": "1mg" },
        { "name": "Indian food name", "emoji": "🌰", "benefit": "Short benefit in 6 words", "nutrientAmount": "0.5mg" },
        { "name": "Indian food name", "emoji": "🍊", "benefit": "Short benefit in 6 words", "nutrientAmount": "0.3mg" }
      ]
    }
  ],
  "bodyScore": 68,
  "scoreSubtitle": "Short motivating sentence about their health status"
}

Rules:
- Return exactly 3 deficiencies.
- level: integer 10–90 representing current nutrient level percentage.
- confidence: integer 60–99 representing AI confidence that this deficiency is present based on the symptoms.
- severity: one of Critical, Low, Moderate.
- color: use #d4614a for iron/critical, #c97d2e for vitamin D/amber, #6b5ea8 for B12/purple, #4a7c6f for others.
- All 5 foods per deficiency must be available at D-Mart or local markets in Hyderabad.
- bodyScore: integer 40–85.
- Pure JSON only. Absolutely no markdown or extra text.`;
}

// ─── POST /api/analyse ─────────────────────────────────────────────────────────
app.post('/api/analyse', async (req, res) => {
  const { symptoms } = req.body;

  if (!Array.isArray(symptoms) || symptoms.length === 0) {
    return res.status(400).json({ error: 'symptoms must be a non-empty array.' });
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: buildPrompt(symptoms) }],
        temperature: 0.4,
        max_tokens: 2048
      })
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.json().catch(() => ({}));
      return res.status(groqRes.status).json({
        error: errBody?.error?.message || `Groq returned HTTP ${groqRes.status}`
      });
    }

    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content || '';

    // Extract JSON robustly even if the model adds any stray text
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({ error: 'Model returned an unexpected format.' });
    }

    const result = JSON.parse(match[0]);
    return res.json(result);

  } catch (err) {
    console.error('[/api/analyse]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Blood report prompt builder ───────────────────────────────────────────────
function buildBloodReportPrompt(text) {
  return `This is raw extracted text from a blood test report. Extract all test values and identify deficiencies. Return JSON: { deficiencies: [{name, reason, confidence, foods: [{name, emoji, benefit, price}]}], bodyScore: number, tip: {title, body} }.

Raw text:
${text}`;
}

// ─── POST /api/blood-report ─────────────────────────────────────────────────────
app.post('/api/blood-report', express.json({ limit: '20mb' }), async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required.' });
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: buildBloodReportPrompt(text) }],
        temperature: 0.3,
        max_tokens: 2048
      })
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.json().catch(() => ({}));
      return res.status(groqRes.status).json({
        error: errBody?.error?.message || `Groq returned HTTP ${groqRes.status}`
      });
    }

    const data = await groqRes.json();
    const raw  = data.choices?.[0]?.message?.content || '';

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({ error: 'Model returned an unexpected format.' });
    }

    const result = JSON.parse(match[0]);
    return res.json(result);

  } catch (err) {
    console.error('[/api/blood-report]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/awareness ───────────────────────────────────────────────────────
app.post('/api/awareness', express.json(), async (req, res) => {
  const { deficiencies } = req.body;

  if (!Array.isArray(deficiencies)) {
    return res.status(400).json({ error: 'deficiencies array is required.' });
  }

  const prompt = `Based on these deficiencies: ${deficiencies.join(', ')}, generate 3 awareness cards.
Return ONLY a valid JSON array of exactly 3 objects with this structure (no markdown, no code fences):
[
  {
    "emoji": "☀️",
    "category": "Lifestyle",
    "title": "Short title",
    "body": "Brief actionable advice.",
    "actionLabel": "Short action"
  }
]`;

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 1024
      })
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.json().catch(() => ({}));
      return res.status(groqRes.status).json({
        error: errBody?.error?.message || `Groq returned HTTP ${groqRes.status}`
      });
    }

    const data = await groqRes.json();
    const raw  = data.choices?.[0]?.message?.content || '';

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      return res.status(502).json({ error: 'Model returned an unexpected format.' });
    }

    const result = JSON.parse(match[0]);
    return res.json(result);

  } catch (err) {
    console.error('[/api/awareness]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  NourishIQ running → http://localhost:${PORT}`);
  console.log(`    Frontend:  http://localhost:${PORT}/`);
  console.log(`    API:       POST http://localhost:${PORT}/api/analyse`);
  console.log(`    API:       POST http://localhost:${PORT}/api/blood-report`);
  console.log(`    API:       POST http://localhost:${PORT}/api/awareness`);
});
