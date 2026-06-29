// ═══════════════════════════════════════════════════════════════
//  Job Prep Intelligence — Secure Node.js Backend
//  Keeps your Anthropic API key server-side at all times
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const nodemailer = require('nodemailer');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Validate env on startup ─────────────────────────────────────
const provider = process.env.LLM_PROVIDER || 'anthropic';
if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  console.error('❌  ANTHROPIC_API_KEY is missing. Copy .env.example → .env and fill it in.');
  process.exit(1);
} else if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
  console.error('❌  GEMINI_API_KEY is missing. Copy .env.example → .env and fill it in.');
  process.exit(1);
} else if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
  console.error('❌  OPENAI_API_KEY is missing. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

// ── Helper: Unified LLM Call ────────────────────────────────────
async function callLLM({ prompt, system = '', useWebSearch = false }) {
  const activeProvider = process.env.LLM_PROVIDER || 'anthropic';

  if (activeProvider === 'anthropic') {
    const body = {
      model:      'claude-sonnet-4-6',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    };
    if (system)       body.system = system;
    if (useWebSearch) body.tools  = [{ type: 'web_search_20250305', name: 'web_search' }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }

  if (activeProvider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

    const tools = [];
    if (useWebSearch) {
      tools.push({ googleSearch: {} });
    }

    const body = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      tools: tools.length ? tools : undefined
    };

    if (system) {
      body.systemInstruction = {
        parts: [{ text: system }]
      };
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.[0];
    if (!part || !part.text) {
      throw new Error('Invalid or empty response from Gemini API');
    }
    return part.text;
  }

  if (activeProvider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is missing.');

    let finalPrompt = prompt;
    if (useWebSearch && process.env.SERPER_API_KEY) {
      try {
        const serperRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': process.env.SERPER_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ q: prompt, num: 5 })
        });
        if (serperRes.ok) {
          const searchData = await serperRes.json();
          const results = (searchData.organic || []).map(item => `Title: ${item.title}\nSnippet: ${item.snippet}\nLink: ${item.link}`).join('\n\n');
          finalPrompt = `Here are some current search results matching the query:\n${results}\n\nBased on these search results, complete the request:\n${prompt}`;
        }
      } catch (searchErr) {
        console.error('Serper search failed:', searchErr.message);
      }
    }

    const messages = [];
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: finalPrompt });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 1200
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Invalid or empty response from OpenAI API');
    }
    return content;
  }

  throw new Error(`Unsupported active provider: ${activeProvider}`);
}

// ── Helper: parse JSON safely ───────────────────────────────────
function parseJSON(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.warn('⚠️ JSON.parse failed on clean string, attempting substring extraction. Raw response was:');
    console.warn(raw);
    console.warn('Error was:', e.message);

    const arr = clean.match(/\[[\s\S]*\]/);
    if (arr) {
      try { 
        return JSON.parse(arr[0]); 
      } catch (innerErr) {
        console.error('Failed to parse extracted JSON array:', innerErr.message);
      }
    }
    const obj = clean.match(/\{[\s\S]*\}/);
    if (obj) {
      try { 
        return JSON.parse(obj[0]); 
      } catch (innerErr) {
        console.error('Failed to parse extracted JSON object:', innerErr.message);
      }
    }
    
    // If it looks like a conversational "no results/jobs found" response, return an empty array to prevent crash
    const lowerClean = clean.toLowerCase();
    if (lowerClean.includes('no job') || lowerClean.includes('not find') || lowerClean.includes('cannot find') || lowerClean.includes('could not find') || lowerClean.includes('unable to find') || lowerClean.includes('no postings')) {
      console.log('🔍 Detected "no jobs found" conversational response, returning empty array.');
      return [];
    }
    
    throw e;
  }
}

// ════════════════════════════════════════════════════════════════
//  ROUTE 1 — Health check
// ════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: process.env.LLM_PROVIDER || 'anthropic', timestamp: new Date().toISOString() });
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 2 — Step 1: Fetch job postings
// ════════════════════════════════════════════════════════════════
app.post('/api/job', async (req, res) => {
  const { jobRole, country, city, duration } = req.body;
  if (!jobRole) return res.status(400).json({ error: 'jobRole is required' });

  const locationParts = [];
  if (city) locationParts.push(city);
  if (country) locationParts.push(country);

  const locationQuery = locationParts.length ? `in ${locationParts.join(', ')}` : '';
  const durationQuery = duration ? `posted in the ${duration}` : '';

  try {
    const raw = await callLLM({
      useWebSearch: true,
      system: 'You are a strict JSON generator. You must return only a valid JSON array. Never include any conversational preamble, explanation, or markdown formatting (do not wrap in ```json). If no jobs are found, return an empty array: []',
      prompt: `Search for all current real job postings for "${jobRole}" ${locationQuery} ${durationQuery} from LinkedIn, Indeed, Naukri, or any top job portal. Do not limit the results; list all matching postings found.
Return a JSON array of objects ONLY (no explanations, no markdown fences), formatted exactly like this:
[
  {
    "id": 1,
    "title": "exact job title",
    "company": "company name",
    "portal": "portal name",
    "location": "city, country",
    "experience": "years required",
    "salary": "salary range",
    "description": "full job description (200-300 words)",
    "requirements": ["req1","req2","...up to 8"]
  },
  ...
]

If no matching jobs are found, return exactly: []`,
    });

    const jobs = parseJSON(raw);
    res.json({ success: true, data: jobs });
  } catch (err) {
    console.error('[/api/job]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 3 — Step 2: Extract skills
// ════════════════════════════════════════════════════════════════
app.post('/api/skills', async (req, res) => {
  const { jobData } = req.body;
  if (!jobData) return res.status(400).json({ error: 'jobData is required' });

  const job = Array.isArray(jobData) ? jobData[0] : jobData;

  try {
    const raw = await callLLM({
      system: 'Return only a valid JSON array of skill strings. No markdown.',
      prompt: `From this job description and requirements for "${job.title}", extract the most important technical and soft skills.
Job Description: ${job.description}
Requirements: ${(job.requirements || []).join(', ')}
Return ONLY a JSON array of 8–12 skill keyword strings. Example: ["React","TypeScript","Jest"]`,
    });

    const skills = parseJSON(raw);
    res.json({ success: true, data: skills });
  } catch (err) {
    console.error('[/api/skills]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 4 — Step 3: Find YouTube resources
// ════════════════════════════════════════════════════════════════
app.post('/api/youtube', async (req, res) => {
  const { skills } = req.body;
  if (!skills?.length) return res.status(400).json({ error: 'skills array is required' });

  try {
    const raw = await callLLM({
      system: 'Return only a valid JSON array. No markdown, no preamble.',
      prompt: `For each of these skills: ${skills.slice(0, 8).join(', ')}
Find ONE highly-rated YouTube tutorial per skill that is ≤10 minutes, from a credible channel, for interview prep.
Return ONLY a JSON array. Each object:
{
  "skill": "skill name",
  "title": "video title",
  "channel": "channel name",
  "duration": "X:XX",
  "views": "approx views like 250K",
  "url": "https://youtube.com/watch?v=...",
  "videoId": "11-char YouTube ID",
  "reason": "one sentence why this is useful"
}`,
    });

    const videos = parseJSON(raw);
    res.json({ success: true, data: videos });
  } catch (err) {
    console.error('[/api/youtube]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 5 — Step 4: Generate 2-day prep plan
// ════════════════════════════════════════════════════════════════
app.post('/api/plan', async (req, res) => {
  const { jobData, skills, ytResources } = req.body;
  if (!jobData || !skills) return res.status(400).json({ error: 'jobData and skills are required' });

  const job = Array.isArray(jobData) ? jobData[0] : jobData;

  try {
    const raw = await callLLM({
      system: 'Return only valid JSON. No markdown, no extra text.',
      prompt: `Create a detailed 2-day interview preparation plan for "${job.title}" at ${job.company}.
Skills to cover: ${skills.join(', ')}
${ytResources && ytResources.length ? `Here are some curated YouTube learning resources for these skills:
${ytResources.map(r => `- ${r.skill}: "${r.title}" (${r.url})`).join('\n')}
Incorporate these specific YouTube tutorial URLs directly into the block descriptions where they match best, or add a "resource" field with the URL to the block.` : ''}
Return JSON:
{
  "day1": { "theme": "string", "blocks": [{ "time":"9-10 AM","title":"string","desc":"string","skills":[],"resource":"optional resource name or url" }] },
  "day2": { "theme": "string", "blocks": [{ "time":"9-10 AM","title":"string","desc":"string","skills":[],"resource":"optional resource name or url" }] },
  "tips": ["tip1","tip2","tip3","tip4"]
}
Day 1 = core technical skills. Day 2 = advanced + mock interview. 5-6 blocks per day.`,
    });

    const plan = parseJSON(raw);
    res.json({ success: true, data: plan });
  } catch (err) {
    console.error('[/api/plan]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 6 — Step 5: Generate email + send via Nodemailer
// ════════════════════════════════════════════════════════════════
app.post('/api/email', async (req, res) => {
  const { userName, userEmail, jobData, skills, ytResources, plan } = req.body;
  if (!userEmail || !jobData) return res.status(400).json({ error: 'userEmail and jobData are required' });

  const job = Array.isArray(jobData) ? jobData[0] : jobData;

  // 1. Generate email content with LLM
  const ytList     = (ytResources || []).map(r => `• ${r.skill}: "${r.title}" by ${r.channel} (${r.duration}) — ${r.url}`).join('\n');
  const day1Blocks = (plan?.day1?.blocks || []).map(b => `  ${b.time}: ${b.title} — ${b.desc}`).join('\n');
  const day2Blocks = (plan?.day2?.blocks || []).map(b => `  ${b.time}: ${b.title} — ${b.desc}`).join('\n');

  let emailData;
  try {
    const raw = await callLLM({
      system: 'Return only valid JSON with subject and html fields. No markdown.',
      prompt: `Write a detailed, professional, motivating preparation plan email for ${userName || 'the candidate'} 
preparing for ${job.title} at ${job.company}.
Include: warm opening, job overview, key skills (${skills.join(', ')}),
YouTube resources:\n${ytList}
Day 1 plan (${plan?.day1?.theme}):\n${day1Blocks}
Day 2 plan (${plan?.day2?.theme}):\n${day2Blocks}
Encouragement closing.
Return JSON: { "subject": "...", "html": "...full HTML email..." }`,
    });
    emailData = parseJSON(raw);
  } catch (err) {
    console.error('[/api/email] LLM generation failed:', err.message);
    return res.status(500).json({ error: 'Failed to generate email content: ' + err.message });
  }

  // 2. Send email via Nodemailer (only if SMTP is configured)
  let emailSent = false;
  let sendError = null;

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
        port:   parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from:    `"Job Prep Intelligence" <${process.env.EMAIL_USER}>`,
        to:      userEmail,
        subject: emailData.subject,
        html:    emailData.html,
      });

      emailSent = true;
      console.log(`✅ Email sent to ${userEmail}`);
    } catch (err) {
      sendError = err.message;
      console.error('[/api/email] SMTP send failed:', err.message);
    }
  } else {
    sendError = 'SMTP not configured — email drafted but not sent. Add EMAIL_USER and EMAIL_PASS to .env to enable sending.';
    console.warn('⚠️  ' + sendError);
  }

  res.json({
    success: true,
    emailSent,
    sendError,
    data: emailData,
  });
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 7 — ATS Resume Tailoring (Optional)
// ════════════════════════════════════════════════════════════════
app.post('/api/resume', async (req, res) => {
  const { resumeText, jobData, skills } = req.body;
  if (!resumeText || !jobData || !skills) {
    return res.status(400).json({ error: 'resumeText, jobData, and skills are required' });
  }

  const job = Array.isArray(jobData) ? jobData[0] : jobData;

  try {
    const raw = await callLLM({
      system: 'Return only valid JSON with modifiedResume and improvements fields. No markdown fences.',
      prompt: `Analyze this resume and integrate the key skills for the target role to pass ATS screening.
Target Job: "${job.title}" at ${job.company}
Skills to naturally integrate: ${skills.join(', ')}

Resume:
${resumeText}

Return a JSON object only:
{
  "modifiedResume": "The complete modified resume in markdown format, with the new skills highlighted or integrated seamlessly",
  "improvements": [
    "A list of specific suggestions or gap analysis (3-5 points)"
  ]
}`,
    });

    const result = parseJSON(raw);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[/api/resume]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  ROUTES 8 & 9 — Chrome Extension Job Scraper Storage
// ════════════════════════════════════════════════════════════════
const scrapedJobs = new Map();

app.post('/api/scrape', (req, res) => {
  const id = Math.random().toString(36).substring(2, 11);
  scrapedJobs.set(id, req.body);
  res.json({ success: true, id });
});

app.get('/api/scrape/:id', (req, res) => {
  const job = scrapedJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Scraped job details not found' });
  res.json({ success: true, data: job });
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 10 — Step 4 Extension: Generate Mock Interview Questions
// ════════════════════════════════════════════════════════════════
app.post('/api/interview/start', async (req, res) => {
  const { jobData, skills } = req.body;
  if (!jobData || !skills) {
    return res.status(400).json({ error: 'jobData and skills are required' });
  }

  const job = Array.isArray(jobData) ? jobData[0] : jobData;

  try {
    const raw = await callLLM({
      system: 'You are a strict JSON generator. Return only a JSON array of strings containing exactly 5 interview questions. No markdown fences, no conversational text.',
      prompt: `Create 5 highly relevant technical and behavioral interview questions for the position of "${job.title}" at ${job.company}.
The questions should test the candidate on the following key skills: ${skills.join(', ')}.
Job description: ${job.description}

Return a JSON array of strings ONLY. For example:
[
  "Question 1 text...",
  "Question 2 text...",
  "Question 3 text...",
  "Question 4 text...",
  "Question 5 text..."
]`,
    });

    const questions = parseJSON(raw);
    res.json({ success: true, data: questions });
  } catch (err) {
    console.error('[/api/interview/start]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  ROUTE 11 — Step 4 Extension: Evaluate Mock Interview
// ════════════════════════════════════════════════════════════════
app.post('/api/interview/evaluate', async (req, res) => {
  const { jobData, qaList } = req.body;
  if (!jobData || !qaList) {
    return res.status(400).json({ error: 'jobData and qaList are required' });
  }

  const job = Array.isArray(jobData) ? jobData[0] : jobData;

  try {
    const raw = await callLLM({
      system: 'You are a strict JSON generator. Return only a valid JSON object matching the requested schema. No markdown fences.',
      prompt: `Evaluate this mock interview for the role of "${job.title}" at ${job.company}.
Questions and Answers:
${qaList.map((qa, i) => `${i+1}. Q: ${qa.question}\n   A: ${qa.answer}`).join('\n\n')}

Compare their responses to what an ideal candidate would answer. Grade their performance.
Return a JSON object ONLY with this exact structure:
{
  "overallScore": 85,
  "feedback": "Overall high-level feedback summarizing their performance, presence, and skill gaps...",
  "strengths": ["Strength point 1", "Strength point 2", "Strength point 3"],
  "weaknesses": ["Weakness/Gap point 1", "Weakness/Gap point 2", "Weakness/Gap point 3"],
  "questionFeedback": [
    {
      "question": "The original question",
      "score": 80,
      "idealAnswer": "What key concepts, details, or technologies the ideal answer should have mentioned...",
      "critique": "A constructive evaluation of the candidate's answer..."
    }
  ]
}

Ensure the output is valid, parsable JSON.`,
    });

    const evaluation = parseJSON(raw);
    res.json({ success: true, data: evaluation });
  } catch (err) {
    console.error('[/api/interview/evaluate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  Start server
// ════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🚀 Job Prep Intelligence Server running`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   API:     http://localhost:${PORT}/api/health`);
  console.log(`   UI:      http://localhost:${PORT}\n`);
});
