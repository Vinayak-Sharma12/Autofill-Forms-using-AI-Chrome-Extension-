/**
 * Job Application Auto-Fill — Content script.
 * Runs on the page: finds form fields, fills from profile or AI.
 */

(function () {
  if (typeof JobAutoFillFieldMapping === 'undefined') return;

  const { getProfileKeyForLabel } = JobAutoFillFieldMapping;

  function getFieldLabel(el) {
    if (!el) return '';
    const parts = [];

    // 1. Explicit label via for= or aria-labelledby
    const id = el.id;
    if (id) {
      try {
        const label = document.querySelector('label[for="' + id.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
        if (label) {
          const t = (label.textContent || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 400) parts.push(t);
        }
      } catch (_) {}
    }
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const ref = document.getElementById(ariaLabelledBy.split(/\s+/)[0]);
      if (ref) {
        const t = (ref.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length < 400) parts.push(t);
      }
    }

    // 2. aria-label
    const ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (ariaLabel) parts.push(ariaLabel);

    // 3. placeholder
    const placeholder = (el.getAttribute('placeholder') || '').trim();
    if (placeholder) parts.push(placeholder);

    // 4. name / id (often camelCase like "firstName")
    const name = (el.getAttribute('name') || '').trim();
    const nameId = (el.getAttribute('id') || '').trim();
    if (name) parts.push(name.replace(/[._]/g, ' '));
    if (nameId && nameId !== name) parts.push(nameId.replace(/[._]/g, ' '));

    // 5. Parent container text (label, .field, .form-group, etc.)
    const parent = el.closest('label, [role="group"], .field, .form-group, .form-field, .input-group, [class*="field"], [class*="form"]');
    if (parent) {
      const labelEl = parent.querySelector('label');
      const container = labelEl || parent;
      const raw = (container && container.textContent != null) ? String(container.textContent) : '';
      let text = raw.trim().replace(/\s+/g, ' ');
      if (el.value != null && el.value !== '') {
        const val = String(el.value).trim();
        if (val) text = text.replace(val, '').trim();
      }
      if (text.length > 0 && text.length < 400) parts.push(text);
    }

    // 6. Previous sibling (e.g. <span>Label</span><input>)
    let prev = el.previousElementSibling;
    if (prev && !prev.querySelector('input, select, textarea')) {
      const t = (prev.textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 200) parts.push(t);
    }

    // Prefer field-specific parts (placeholder, name, id, aria-label, label[for], prev sibling) over parent text
    const directParts = [];
    if (placeholder) directParts.push(placeholder);
    if (name) directParts.push(name.replace(/[._]/g, ' '));
    if (nameId && nameId !== name) directParts.push(nameId.replace(/[._]/g, ' '));
    if (ariaLabel) directParts.push(ariaLabel);
    if (id) {
      try {
        const label = document.querySelector('label[for="' + id.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
        if (label) directParts.push((label.textContent || '').trim().replace(/\s+/g, ' '));
      } catch (_) {}
    }
    if (prev && !prev.querySelector('input, select, textarea')) {
      const t = (prev.textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 200) directParts.push(t);
    }
    const direct = [...new Set(directParts)].filter(p => p.length >= 2 && p.length <= 350);
    if (direct.length > 0) {
      const chosen = direct.reduce((a, b) => a.length <= b.length ? a : b);
      const genericPlaceholders = ['your answer', 'other response', 'enter your answer'];
      if (genericPlaceholders.includes(chosen.toLowerCase().trim()) && parts.length > 0) {
        const questionLike = [...new Set(parts)].filter(p => p && p.length > 15 && p.length <= 350);
        if (questionLike.length > 0) return questionLike.reduce((a, b) => a.length <= b.length ? a : b);
      }
      return chosen;
    }

    // Fallback: shortest of all parts (including parent text)
    const unique = [...new Set(parts)].filter(Boolean);
    if (unique.length === 0) return '';
    const short = unique.filter(p => p.length >= 2 && p.length <= 350);
    if (short.length > 0) return short.reduce((a, b) => a.length <= b.length ? a : b);
    return unique[0];
  }

  function gatherFields() {
    const fields = [];
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select'
    );
    for (const el of inputs) {
      if (el.disabled || el.readOnly) continue;
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && (type === 'checkbox' || type === 'radio')) continue;
      const label = getFieldLabel(el);
      const placeholder = (el.getAttribute('placeholder') || '').trim();
      fields.push({ el, label, placeholder, tag, type });
    }
    return fields;
  }

  const BADGE_CLASS = 'job-autofill-badge';

  function addFillLabel(el, source) {
    if (!el || !el.parentNode) return;
    let badge = el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains(BADGE_CLASS) ? el.nextElementSibling : null;
    if (badge) badge.remove();
    badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.textContent = source === 'Prefilled' ? 'Prefilled' : 'AI';
    badge.setAttribute('data-autofill-source', source);
    badge.style.cssText = 'display:inline-block;margin-left:6px;padding:2px 6px;font-size:10px;font-weight:600;border-radius:4px;vertical-align:middle;' +
      (source === 'Prefilled' ? 'background:#dcfce7;color:#166534;' : 'background:#dbeafe;color:#1e40af;');
    el.insertAdjacentElement('afterend', badge);
  }

  function setInputValue(el, value) {
    if (!el || value == null) return;
    let v = String(value).trim();
    const tag = (el.tagName || '').toLowerCase();
    // Use el.type (reflected) so we catch number inputs even when type is set by script
    const type = (el.type || el.getAttribute('type') || '').toLowerCase();
    if (tag === 'select') {
      const opts = Array.from(el.options);
      const opt = opts.find(o => (o.value || o.text).trim().toLowerCase() === v.toLowerCase())
        || opts.find(o => (o.text || o.value).trim().toLowerCase().includes(v.toLowerCase()));
      if (opt) {
        el.value = opt.value;
      } else if (opts.length) {
        el.selectedIndex = 0;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // type="number" only accepts valid numbers; "+91 9463938771" throws "cannot be parsed"
    if (tag === 'input' && type === 'number') {
      v = v.replace(/\D/g, '') || ''; // digits only (phone/numeric id)
      if (v === '') return;
    }
    try {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
      // "The specified value ... cannot be parsed, or is out of range"
    }
  }

  function getProfileValue(profile, key) {
    if (key === 'fullName') {
      const first = (profile.firstName || '').trim();
      const last = (profile.lastName || '').trim();
      if (first || last) return (first + ' ' + last).trim();
      return (profile.fullName || '').trim() || null;
    }
    if (key === 'currentCompanyAndRole') {
      const company = (profile.currentCompany || '').trim();
      const role = (profile.currentRole || '').trim();
      if (company && role) return company + ', ' + role;
      return company || role || null;
    }
    if (!profile[key]) return null;
    return profile[key].trim();
  }

  async function fillForm() {
    const data = await new Promise(resolve => {
      chrome.storage.local.get(['profile', 'resume', 'apiProvider', 'apiKeyOpenai', 'apiKeyGroq', 'apiKey'], resolve);
    });
    const profile = data.profile || {};
    const resume = data.resume || '';
    const apiProvider = (data.apiProvider || 'openai').toLowerCase() === 'groq' ? 'groq' : 'openai';
    const apiKey = apiProvider === 'groq'
      ? (data.apiKeyGroq || '').trim()
      : (data.apiKeyOpenai || data.apiKey || '').trim();

    const fields = gatherFields();
    const labels = fields.map(f => (f.label || f.placeholder || '').trim() || '(no label)');
    let classifications = []; // "PREFILLED" | "AI_ANSWER" per index

    // ——— Step 1: LLM classifies each question as PREFILLED (from profile) or AI_ANSWER (generate from resume) ———
    if (apiKey && labels.length > 0) {
      try {
        const resp = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'CLASSIFY_FIELDS', labels, apiKey, apiProvider }, resolve);
        });
        if (resp && !resp.error && Array.isArray(resp.classifications) && resp.classifications.length === labels.length) {
          classifications = resp.classifications;
        }
      } catch (_) {}
    }
    if (classifications.length !== labels.length) {
      classifications = labels.map((l, i) => {
        const effectiveLabel = (fields[i].label || fields[i].placeholder || '').trim();
        return getProfileKeyForLabel(effectiveLabel) ? 'PREFILLED' : 'AI_ANSWER';
      });
    }

    // ——— Step 2: Route each field to PREFILLED path or AI path ———
    const skipForAI = ['other response', 'other', 'specify', 'please specify', 'your answer'];
    let filled = 0;
    const errors = [];

    for (let i = 0; i < fields.length; i++) {
      const { el, label, placeholder, tag, type } = fields[i];
      const effectiveLabel = (label || placeholder || '').trim();
      const effLower = effectiveLabel.toLowerCase();
      const isTextLike = tag === 'textarea' || (tag === 'input' && (type === 'text' || type === 'email' || type === 'url' || type === ''));

      if (classifications[i] === 'PREFILLED') {
        const profileKey = getProfileKeyForLabel(effectiveLabel);
        const profileValue = profileKey ? getProfileValue(profile, profileKey) : null;
        if (profileValue) {
          setInputValue(el, profileValue);
          addFillLabel(el, 'Prefilled');
          filled++;
        }
        continue;
      }

      if (classifications[i] === 'AI_ANSWER' && isTextLike && resume && apiKey) {
        if (effectiveLabel.length < 15 && skipForAI.some(s => effLower === s || effLower.startsWith(s + ' '))) continue;
        const question = effectiveLabel || 'Please provide a brief professional response for this form field.';
        try {
          const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'GENERATE_ANSWER', question, resume, apiKey, apiProvider }, resolve);
          });
          if (response && response.text) {
            setInputValue(el, response.text);
            addFillLabel(el, 'AI');
            filled++;
          } else if (response && response.error) {
            errors.push((effectiveLabel || 'Field') + ': ' + response.error);
          }
        } catch (e) {
          errors.push((effectiveLabel || 'Field') + ': ' + (e.message || String(e)));
        }
      }
    }

    // ——— Step 3: Any PREFILLED field still empty → answer with AI ———
    for (let i = 0; i < fields.length; i++) {
      const { el, label, placeholder, tag, type } = fields[i];
      const currentVal = (el.value || '').trim();
      if (currentVal) continue;
      const effectiveLabel = (label || placeholder || '').trim();
      const effLower = effectiveLabel.toLowerCase();
      const isTextLike = tag === 'textarea' || (tag === 'input' && (type === 'text' || type === 'email' || type === 'url' || type === ''));
      if (!isTextLike || !resume || !apiKey) continue;
      if (effectiveLabel.length < 15 && skipForAI.some(s => effLower === s || effLower.startsWith(s + ' '))) continue;
      const question = effectiveLabel || 'Please provide a brief professional response for this form field.';
      try {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'GENERATE_ANSWER', question, resume, apiKey, apiProvider }, resolve);
        });
        if (response && response.text) {
          setInputValue(el, response.text);
          addFillLabel(el, 'AI');
          filled++;
        } else if (response && response.error) {
          errors.push((effectiveLabel || 'Field') + ': ' + response.error);
        }
      } catch (e) {
        errors.push((effectiveLabel || 'Field') + ': ' + (e.message || String(e)));
      }
    }

    return { filled, total: fields.length, errors };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'FILL_FORM') {
      fillForm().then(sendResponse).catch(e => sendResponse({ filled: 0, errors: [e.message || String(e)] }));
      return true;
    }
  });
})();
