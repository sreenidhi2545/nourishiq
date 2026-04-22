require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ─── Config ────────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 8080;
const GROQ_KEY     = process.env.GROQ_API_KEY;
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const SB_URL       = process.env.SUPABASE_URL;
const SB_SVC_KEY   = process.env.SUPABASE_SERVICE_KEY;

// Supabase client — uses service_role key to bypass RLS on server
const supabase = (SB_URL && SB_SVC_KEY)
  ? createClient(SB_URL, SB_SVC_KEY)
  : null;

if (!supabase) {
  console.warn('⚠️  Supabase not configured — DB persistence disabled. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:");
  next();
});

app.use(express.static(__dirname));

// ─── Utils ───────────────────────────────────────────────────────────────────
function isValidUUID(uuid) {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}

// ─── Supabase helpers ──────────────────────────────────────────────────────────
async function saveSession({ userId, symptoms, result, source = 'symptoms' }) {
  if (!supabase || !userId || !isValidUUID(userId)) {
    console.warn(`[Supabase] Skipping saveSession: ${!supabase ? 'No client' : !userId ? 'No userId' : 'Invalid UUID: ' + userId}`);
    return null;
  }
  try {
    const { data, error } = await supabase.from('sessions').insert({
      user_id:      userId,
      symptoms:     symptoms || [],
      deficiencies: result.deficiencies,
      body_score:   result.bodyScore || null,
      tip:          result.tip || null,
      source
    }).select('id').single();
    if (error) {
      console.error('[Supabase] saveSession error:', error.message, error.details);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error('[Supabase] saveSession exception:', e.message);
    return null;
  }
}

async function saveAwarenessCards({ userId, sessionId, cards }) {
  if (!supabase || !userId || !isValidUUID(userId) || !cards?.length) return;
  try {
    const { error } = await supabase.from('awareness_cards').insert({
      user_id:    userId,
      session_id: sessionId || null,
      cards
    });
    if (error) console.error('[Supabase] saveAwarenessCards error:', error.message, error.details);
  } catch (e) {
    console.error('[Supabase] saveAwarenessCards exception:', e.message);
  }
}

// ─── Shared prompt helpers ─────────────────────────────────────────────────────
const RESPONSE_SCHEMA = `{
  "reportType": "Blood Panel",
  "condition": "Iron Deficiency Anemia",
  "deficiencies": [
    {
      "name": "Iron",
      "reason": "Brief clinical explanation based on lab values or symptoms",
      "level": 35,
      "confidence": 88,
      "severity": "Critical",
      "color": "#d4614a",
      "foods": [
        { "name": "Palak (Spinach)", "emoji": "🥬", "benefit": "High non-heme iron, pairs with Vit C", "price": "₹30" },
        { "name": "Rajma", "emoji": "🫘", "benefit": "Iron-rich legume, easy daily staple", "price": "₹55" },
        { "name": "Dates", "emoji": "🌴", "benefit": "Natural iron + quick energy", "price": "₹80" },
        { "name": "Masoor Dal", "emoji": "🪣", "benefit": "Cheap, iron-dense lentil", "price": "₹60" },
        { "name": "Pumpkin Seeds", "emoji": "🎃", "benefit": "Concentrated plant iron", "price": "₹45" }
      ]
    }
  ],
  "warnings": [
    { "name": "Tea/Coffee with meals", "reason": "Tannins inhibit iron absorption" },
    { "name": "Calcium supplements with Iron", "reason": "Competition for absorption" }
  ],
  "extractedValues": [
    { "marker": "Haemoglobin", "value": "9.2", "unit": "g/dL", "normalRange": "12-16", "status": "Low" }
  ],
  "dailyPlan": [
    { "meal": "Breakfast", "foods": ["Eggs", "Fortified milk"], "reason": "B12 + Vitamin D boost" },
    { "meal": "Lunch", "foods": ["Palak dal", "Lemon squeeze"], "reason": "Iron with Vit C for 3x absorption" },
    { "meal": "Dinner", "foods": ["Rajma rice", "Beetroot salad"], "reason": "Iron + folate to rebuild blood cells" },
    { "meal": "Snack", "foods": ["Dates", "Pumpkin seeds"], "reason": "Dense mineral snack" }
  ],
  "bodyScore": 72,
  "tip": {
    "title": "Eat spinach with lemon for 3× iron absorption",
    "body": "Vitamin C in lemon converts non-heme iron into a form your gut absorbs 3× more efficiently."
  }
}`;

const SCHEMA_RULES = `Rules:
- reportType: string (e.g. "Blood Panel", "Heart Report", "Diabetes Report", "Thyroid Panel", "Kidney/Renal Report", "Liver Function Report", "Pulmonary Report").
- condition: string (Brief primary condition detected, e.g. "Iron Deficiency", "Early Stage Diabetes", "Optimal Heart Health").
- Return exactly 3 deficiencies (or primary health focus areas).
- name: nutrient or health focus (e.g. "Iron", "Glucose Control", "Heart Health").
- level: integer 10-90 representing current status percentage.
- confidence: integer 60-99 representing AI confidence.
- severity: one of "Critical", "Moderate", "Low".
- color: use #d4614a for iron/blood, #c97d2e for sugar/vitD, #6b5ea8 for heart/B12, #4a7c6f for others.
- Each item must have exactly 5 Indian foods/recommendations.
- Each food must have: name, emoji, benefit, price (string like "₹40").
- warnings: array of objects { name, reason } listing foods or habits to avoid for this condition.
- extractedValues: array of lab markers found in the report. Each must have marker, value, unit, normalRange, status.
- dailyPlan: array of 4 meal slots (Breakfast, Lunch, Dinner, Snack). Each has meal (string), foods (array of 2-3 food names), reason (short string).
- bodyScore: integer 0-100.
- tip: object with title and body strings.
- PURE JSON ONLY. No markdown. No code fences. No explanation.`;

async function callGroq({ model, messages, temperature = 0.3 }) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 2048 })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Cache Mechanism ──────────────────────────────────────────────────────────
const responseCache = {};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── POST /api/register ─────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { id, name, age, city, gender } = req.body;
  if (!supabase) return res.json({ success: true, note: 'Supabase not configured' });
  
  if (!id || !isValidUUID(id)) {
    console.error('[/api/register] Invalid or missing UUID:', id);
    return res.status(400).json({ error: 'A valid UUID is required for registration.' });
  }

  try {
    const { error } = await supabase.from('users').upsert({
      id,
      name,
      age: parseInt(age, 10),
      city
    });
    if (error) {
      console.error('[/api/register] Supabase error:', error.message, error.details);
      throw error;
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[/api/register] Internal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/analyse ─────────────────────────────────────────────────────────
app.post('/api/analyse', async (req, res) => {
  const { symptoms, userId } = req.body;

  if (!Array.isArray(symptoms) || symptoms.length === 0) {
    return res.status(400).json({ error: 'symptoms must be a non-empty array.' });
  }

  const cacheKey = [...symptoms].sort().join('+').toLowerCase();
  const cached = responseCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[/api/analyse] Cache hit for: ${cacheKey}`);
    const result = { ...cached.data };
    // Still save the session asynchronously for user tracking even if cached
    saveSession({ userId, symptoms, result, source: 'symptoms' }).then(id => {
      if (id) result._sessionId = id;
    });
    return res.json(result);
  }

  const prompt = `You are a clinical nutritionist AI. A user in Hyderabad, India reports these symptoms: ${symptoms.join(', ')}.

Analyse and identify exactly 3 nutritional deficiencies. 
Return ONLY pure JSON matching the structure of this example, but with DYNAMIC values based on the symptoms.
DO NOT copy the hardcoded example values (like bodyScore: 72). Compute a unique bodyScore between 0-100 based on the symptoms.

EXAMPLE SCHEMA STRUCTURE:
${RESPONSE_SCHEMA}

${SCHEMA_RULES}`;

  try {
    let raw;
    try {
      raw = await callGroq({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (e) {
      console.warn('[/api/analyse] Primary model failed, trying fallback llama3-70b-8192');
      raw = await callGroq({
        model: 'llama3-70b-8192',
        messages: [{ role: 'user', content: prompt }]
      });
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: 'Model returned unexpected format.' });

    const result = JSON.parse(match[0]);

    // Persist to Supabase (non-blocking — don't fail the request if DB is down)
    const sessionId = await saveSession({ userId, symptoms, result, source: 'symptoms' });
    if (sessionId) result._sessionId = sessionId;

    responseCache[cacheKey] = { data: result, timestamp: Date.now() };

    return res.json(result);
  } catch (err) {
    console.error('[/api/analyse]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/blood-report ─────────────────────────────────────────────────────
app.post('/api/blood-report', async (req, res) => {
  const { image, userId } = req.body;

  if (!image) return res.status(400).json({ error: 'image (base64 data URL) is required.' });

  const textPrompt = `You are a clinical nutritionist and medical lab report analyst AI. Analyse this medical report image.
  
Step 1 — Detect the Report Type:
- Blood/CBC/Mineral: Handle as nutrition deficiency analysis.
- Heart/Echo/ECG: Detect heart health markers. Recommend low sodium, omega-3 (flaxseed, walnuts, fish), oats, methi, garlic, amla. Avoid ghee, high sodium.
- Diabetes/Glucose/HbA1c: Detect glucose/HbA1c. Recommend low glycemic Indian foods (karela, methi, brown rice, whole wheat roti). Avoid high sugar.
- Thyroid (TSH/T3/T4): Recommend iodine/selenium foods (seafish, dairy, eggs) for hypo. Adjust for hyper.
- Kidney/Renal (Creatinine, Urea): Recommend low potassium/phosphorus. Avoid bananas, potatoes, dairy excess. Recommend apple, cabbage, cauliflower.
- Liver/LFT (SGOT, SGPT, Bilirubin): Recommend turmeric, amla, beetroot, green leafy veg. Avoid fried foods, alcohol.
- Pulmonary/PFT/Lung: Recommend anti-inflammatory (turmeric milk, ginger, tulsi, omega-3). Avoid cold/processed foods.
- Unknown: Report type 'Unknown'. Give 5 general Indian health tips.

Step 2 — Extract Lab Values: Marker, value, unit, status.
Step 3 — Nutrition/Guidance Analysis: Identify deficiencies or focus areas.
Step 4 — Meal Plan & Warnings: Create practical Indian daily plan and 'Avoid' list.

Return ONLY pure JSON matching this example structure. Compute unique bodyScore (0-100).

EXAMPLE SCHEMA STRUCTURE:
${RESPONSE_SCHEMA}

${SCHEMA_RULES}`;

  try {
    const raw = await callGroq({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          { 
            type: 'image_url', 
            image_url: { 
              url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}` 
            } 
          }
        ]
      }]
    });

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: 'Model returned unexpected format.' });

    const result = JSON.parse(match[0]);

    const sessionId = await saveSession({ userId, symptoms: [], result, source: 'blood_report' });
    if (sessionId) result._sessionId = sessionId;

    return res.json(result);
  } catch (err) {
    console.error('[/api/blood-report] Internal error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/chat ───────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history, deficiencies } = req.body;

  const systemPrompt = `You are the NourishIQ Health Assistant. A friendly, clinical nutrition AI.
The user has these current deficiencies: ${deficiencies?.join(', ') || 'None identified yet'}.
Your goal is to provide science-backed advice on Indian foods, recipes, and nutritional gaps.
Keep responses concise (max 2-3 short paragraphs). Use emojis. Focus on foods available in India.
If the user asks for a recipe, provide a simple one.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []),
    { role: 'user', content: message }
  ];

  try {
    let response;
    try {
      response = await callGroq({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7
      });
    } catch (e) {
      console.warn('[/api/chat] Primary model failed, trying fallback llama3-70b-8192');
      response = await callGroq({
        model: 'llama3-70b-8192',
        messages,
        temperature: 0.7
      });
    }
    return res.json({ response });
  } catch (err) {
    console.error('[/api/chat]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/meal-analysis ──────────────────────────────────────────────────
app.post('/api/meal-analysis', async (req, res) => {
  const { image, deficiencies } = req.body;
  if (!image) return res.status(400).json({ error: 'image is required.' });

  const prompt = `Analyse this meal photo.
User's current deficiencies: ${deficiencies?.join(', ') || 'None identified yet'}.
Identify:
1. What nutrients this meal provides.
2. What's missing based on the user's specific deficiencies.
3. What to add or pair with this meal to maximize absorption or fill gaps.

Return a clean JSON object:
{
  "analysis": "2-3 sentences on what the meal is and its benefits",
  "nutrients": ["List", "of", "key", "nutrients"],
  "missing": "What is missing to fix their deficiencies",
  "recommendation": "1-2 sentences on what to add/pair"
}
PURE JSON ONLY.`;

  try {
    const raw = await callGroq({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { 
            type: 'image_url', 
            image_url: { 
              url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}` 
            } 
          }
        ]
      }]
    });

    console.log('[/api/meal-analysis] Raw AI response:', raw);

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('[/api/meal-analysis] No JSON found in response');
      return res.status(502).json({ error: 'Model returned unexpected format.' });
    }
    
    const parsed = JSON.parse(match[0]);
    console.log('[/api/meal-analysis] Parsed response:', parsed);
    return res.json(parsed);
  } catch (err) {
    console.error('[/api/meal-analysis] Internal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/awareness ───────────────────────────────────────────────────────
app.post('/api/awareness', async (req, res) => {
  const { deficiencies, userId, sessionId } = req.body;

  if (!Array.isArray(deficiencies) || deficiencies.length === 0) {
    return res.status(400).json({ error: 'deficiencies array is required.' });
  }

  const cacheKey = 'awareness_' + [...deficiencies].sort().join('+').toLowerCase();
  const cached = responseCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[/api/awareness] Cache hit for: ${cacheKey}`);
    saveAwarenessCards({ userId, sessionId, cards: cached.data });
    return res.json(cached.data);
  }

  const prompt = `You are a nutrition science communicator. The user has these deficiencies: ${deficiencies.join(', ')}.

Generate exactly 3 science-backed awareness cards. Return ONLY this JSON array:
[
  {
    "emoji": "☀️",
    "category": "Absorption",
    "title": "Short punchy title (max 8 words)",
    "body": "2-3 sentences of actionable, science-backed advice specific to the deficiency.",
    "actionLabel": "View recommended foods"
  }
]

Rules:
- category must be one of: "Absorption", "Timing", "Food Combo", "Lifestyle".
- One card per aspect: absorption, timing, food combination.
- Make advice specific to Indian diet and Hyderabad context.
- Pure JSON array only. No markdown.`;

  try {
    let raw;
    try {
      raw = await callGroq({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.5,
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (e) {
      console.warn('[/api/awareness] Primary model failed, trying fallback llama3-70b-8192');
      raw = await callGroq({
        model: 'llama3-70b-8192',
        temperature: 0.5,
        messages: [{ role: 'user', content: prompt }]
      });
    }

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return res.status(502).json({ error: 'Model returned unexpected format.' });

    const cards = JSON.parse(match[0]);

    // Persist awareness cards (non-blocking)
    saveAwarenessCards({ userId, sessionId, cards });

    responseCache[cacheKey] = { data: cards, timestamp: Date.now() };

    return res.json(cards);
  } catch (err) {
    console.error('[/api/awareness]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/cart/sync ───────────────────────────────────────────────────────
// Upserts the full cart to Supabase. Called from frontend on cart change.
// Falls back gracefully if Supabase not configured.
app.post('/api/cart/sync', async (req, res) => {
  const { userId, sessionId, items } = req.body;

  if (!supabase) return res.json({ ok: true, note: 'Supabase not configured, using localStorage only.' });
  if (!userId || !Array.isArray(items)) return res.status(400).json({ error: 'userId and items required.' });

  try {
    // Delete existing items for this user then re-insert (simple full sync)
    await supabase.from('cart_items').delete().eq('user_id', userId);

    if (items.length > 0) {
      const rows = items.map(item => ({
        user_id:    userId,
        session_id: sessionId || null,
        food_name:  item.name,
        emoji:      item.emoji,
        price:      item.price,
        qty:        item.qty,
        deficiency: item.forDeficiency
      }));
      const { error } = await supabase.from('cart_items').insert(rows);
      if (error) throw new Error(error.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[/api/cart/sync]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/cart/:userId ─────────────────────────────────────────────────────
// Loads cart from Supabase. Frontend uses this to hydrate on login.
app.get('/api/cart/:userId', async (req, res) => {
  if (!supabase) return res.json([]);

  try {
    const { data, error } = await supabase
      .from('cart_items')
      .select('food_name, emoji, price, qty, deficiency')
      .eq('user_id', req.params.userId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    const items = (data || []).map(row => ({
      name:          row.food_name,
      emoji:         row.emoji,
      price:         Number(row.price),
      qty:           row.qty,
      forDeficiency: row.deficiency
    }));

    return res.json(items);
  } catch (err) {
    console.error('[/api/cart/:userId]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  NourishIQ running → http://localhost:${PORT}`);
  console.log(`    GROQ_API_KEY:  ${GROQ_KEY  ? '✓ loaded' : '✗ MISSING'}`);
  console.log(`    Supabase:      ${supabase  ? '✓ connected' : '✗ not configured (offline mode)'}`);
});
