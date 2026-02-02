/**
 * Job Application Auto-Fill — Options page.
 * Saves profile, resume, API provider (OpenAI / Groq), and API keys to chrome.storage.local.
 */

const PROFILE_IDS = [
  'firstName', 'lastName', 'email', 'phone',
  'yearsExperience', 'linkedin', 'currentCompany', 'currentRole', 'currentSalary',
  'currentCGPA', 'tenthPercentage', 'tenthBoard', 'tenthStream',
  'twelfthPercentage', 'twelfthBoard', 'twelfthStream', 'rollNumber',
  'age', 'gender', 'institute', 'degree', 'branch'
];

function getProfile() {
  const profile = {};
  for (const id of PROFILE_IDS) {
    const el = document.getElementById(id);
    profile[id] = el ? (el.value || '').trim() : '';
  }
  return profile;
}

function setProfile(profile) {
  for (const id of PROFILE_IDS) {
    const el = document.getElementById(id);
    if (el && profile[id] !== undefined) el.value = profile[id];
  }
}

function showStatus(message, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'error' : '';
}

document.getElementById('save').addEventListener('click', async () => {
  const profile = getProfile();
  const resume = (document.getElementById('resume').value || '').trim();
  const apiProvider = (document.getElementById('apiProvider').value || 'openai').toLowerCase();
  const apiKeyOpenai = (document.getElementById('apiKeyOpenai').value || '').trim();
  const apiKeyGroq = (document.getElementById('apiKeyGroq').value || '').trim();

  try {
    await chrome.storage.local.set({
      profile,
      resume,
      apiProvider: apiProvider === 'groq' ? 'groq' : 'openai',
      apiKeyOpenai,
      apiKeyGroq
    });
    showStatus('Saved.');
    setTimeout(() => { showStatus(''); }, 2000);
  } catch (e) {
    showStatus('Failed to save: ' + (e.message || String(e)), true);
  }
});

// Load saved data on open
chrome.storage.local.get(['profile', 'resume', 'apiProvider', 'apiKeyOpenai', 'apiKeyGroq'], (data) => {
  if (data.profile) setProfile(data.profile);
  if (data.resume !== undefined) {
    const el = document.getElementById('resume');
    if (el) el.value = data.resume;
  }
  const providerEl = document.getElementById('apiProvider');
  if (providerEl && data.apiProvider) providerEl.value = data.apiProvider === 'groq' ? 'groq' : 'openai';
  const openaiEl = document.getElementById('apiKeyOpenai');
  if (openaiEl && data.apiKeyOpenai !== undefined) openaiEl.value = data.apiKeyOpenai;
  const groqEl = document.getElementById('apiKeyGroq');
  if (groqEl && data.apiKeyGroq !== undefined) groqEl.value = data.apiKeyGroq;
});
