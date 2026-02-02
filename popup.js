/**
 * Job Application Auto-Fill — Popup.
 * Sends "FILL_FORM" to the active tab's content script.
 */

function setMessage(text, type) {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.className = type || '';
}

document.getElementById('fill').addEventListener('click', async () => {
  const btn = document.getElementById('fill');
  btn.disabled = true;
  setMessage('Filling…', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setMessage('No active tab.', 'error');
      btn.disabled = false;
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM' });
    setMessage('Done. Review and submit.', 'success');
  } catch (e) {
    setMessage(e.message || 'Error. Open a job form page and try again.', 'error');
  }

  btn.disabled = false;
});

document.getElementById('improve').addEventListener('click', async () => {
  const btn = document.getElementById('improve');
  const instructionsEl = document.getElementById('improveInstructions');
  const instructions = (instructionsEl && instructionsEl.value) ? instructionsEl.value.trim() : '';
  btn.disabled = true;
  setMessage('Improving…', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setMessage('No active tab.', 'error');
      btn.disabled = false;
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'IMPROVE_FOCUSED_FIELD', userInstructions: instructions });
    if (response && response.error) {
      setMessage(response.error, 'error');
    } else if (response && response.filled) {
      setMessage('Answer improved.', 'success');
    } else {
      setMessage('Done.', 'success');
    }
  } catch (e) {
    setMessage(e.message || 'Focus a form field first, then try again.', 'error');
  }

  btn.disabled = false;
});

document.getElementById('optionsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
