/**
 * Job Application Auto-Fill — Background service worker.
 * Calls OpenAI or Groq API to generate answers for open-ended form questions.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4.1';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function getApiConfig(apiProvider) {
  const useGroq = (apiProvider || '').toLowerCase() === 'groq';
  return {
    url: useGroq ? GROQ_API_URL : OPENAI_API_URL,
    model: useGroq ? GROQ_MODEL : OPENAI_MODEL
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GENERATE_ANSWER') {
    generateAnswer(message.question, message.resume, message.apiKey, message.apiProvider)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }
  if (message.type === 'CLASSIFY_FIELDS') {
    classifyFields(message.labels, message.apiKey, message.apiProvider)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message || String(err) }));
    return true;
  }
  // Relay content script debug logs so they appear in Service Worker console
  if (message.type === 'CONTENT_DEBUG') {
    const prefix = message.inIframe ? '[Content/iframe]' : '[Content/top]';
    if (message.level === 'warn') {
      console.warn(prefix, ...(message.args || []));
    } else if (message.level === 'error') {
      console.error(prefix, ...(message.args || []));
    } else {
      console.log(prefix, ...(message.args || []));
    }
    return false;
  }
});

async function generateAnswer(question, resume, apiKey, apiProvider) {
  if (!apiKey || !apiKey.trim()) {
    return { error: 'API key not set. Add it in extension Options (OpenAI or Groq).' };
  }
  if (!resume || !resume.trim()) {
    return { error: 'Resume not set. Add it in extension Options.' };
  }

  const { url, model } = getApiConfig(apiProvider);

  const systemPrompt = `You are helping fill a job application form. Output ONLY the direct answer: a short value, number, or 1–3 sentence response based on the candidate's resume. Use first person ("I"). Do not make up facts. Never output meta-commentary like "It seems like you want...", "I will help you...", or "Here is...". Output only the requested data (e.g. a percentage, a name, or a brief answer).`;

  const userContent = `Resume:\n${resume}\n\nForm question to answer:\n${question}`;

  console.log('[Job Auto-Fill] Question (full):', question);

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.3,
    max_tokens: 500
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = `API error ${res.status}`;
    try {
      const j = JSON.parse(errText);
      if (j.error && j.error.message) msg = j.error.message;
    } catch (_) {}
    return { error: msg };
  }

  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';

  if (!text || !text.trim()) {
    return { error: 'Empty response from API.' };
  }

  return { text: text.trim() };
}

const CLASSIFY_SYSTEM = `You classify job application form questions into two categories.

PREFILLED: Can be answered from  prefiled knowledge given.The following are the knowledge exaclty available: Name/FullName/First Name/Last Name,email,Phone Number,Gender,Roll Number,College/University Name,Branch/Stream in College,Years of Experience,CGPA,Age,Company Name,Current Role/Designation in the Company,Current Salary (CTC),LinkedIn Profile(url),1Oth:Board,Percentage,School,12th:Board,Percentage,School

AI_ANSWER: Needs generated text from the resume (paragraph or multiple sentences). Examples: "Tell about experience in your current company and project and tech stack", "Describe a challenge", "Why do you want to join", "Cover letter", "Tell us about yourself", "Project you worked on", "Explain your role", motivations, accomplishments.

Output ONLY a JSON array of the same length as the input, with each element either "PREFILLED" or "AI_ANSWER". No other text. Example: ["PREFILLED","AI_ANSWER","PREFILLED"]`;

async function classifyFields(labels, apiKey, apiProvider) {
  if (!apiKey || !apiKey.trim()) {
    return { error: 'API key not set. Add it in extension Options (OpenAI or Groq).' };
  }
  if (!Array.isArray(labels) || labels.length === 0) {
    return { classifications: [] };
  }

  const { url, model } = getApiConfig(apiProvider);

  const userContent = 'Classify each of these form field questions (one per line, index in brackets):\n\n' +
    labels.map((l, i) => `[${i}] ${(l || '').trim() || '(no label)'}`).join('\n');

  const body = {
    model,
    messages: [
      { role: 'system', content: CLASSIFY_SYSTEM },
      { role: 'user', content: userContent }
    ],
    temperature: 0.2,
    max_tokens: 500
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    let msg = `API error ${res.status}`;
    try {
      const j = JSON.parse(errText);
      if (j.error && j.error.message) msg = j.error.message;
    } catch (_) {}
    return { error: msg };
  }

  const data = await res.json();
  const raw = data.choices && data.choices[0] && data.choices[0].message
    ? (data.choices[0].message.content || '').trim()
    : '';

  let classifications = [];
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    const jsonStr = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      classifications = parsed.map(c => String(c).toUpperCase() === 'AI_ANSWER' ? 'AI_ANSWER' : 'PREFILLED');
    }
  } catch (_) {}
  // Fallback if parse failed or wrong length: per-line "0: PREFILLED" or default PREFILLED
  if (classifications.length !== labels.length) {
    const lines = raw.split(/\n/).filter(Boolean);
    classifications = labels.map((_, i) => {
      const line = (lines[i] || '').toUpperCase();
      return line.includes('AI_ANSWER') ? 'AI_ANSWER' : 'PREFILLED';
    });
  }

  return { classifications };
}
