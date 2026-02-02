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

  // Visible label for a single radio option (e.g. "Electrical Engineering")
  function getRadioOptionText(radio) {
    const id = radio.id;
    if (id) {
      try {
        const label = document.querySelector('label[for="' + id.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
        if (label) {
          const t = (label.textContent || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 200) return t;
        }
      } catch (_) {}
    }
    const parent = radio.parentElement;
    if (parent) {
      // Parent might be <label> wrapping only this option
      const tag = (parent.tagName || '').toLowerCase();
      if (tag === 'label') {
        const raw = (parent.textContent || '').trim().replace(/\s+/g, ' ');
        const v = (radio.value || '').trim();
        const text = v ? raw.replace(v, '').trim() : raw;
        if (text && text.length < 200) return text;
      }
      // Sibling often holds the option text (e.g. <input><span>Electrical Engineering</span>)
      let sibling = radio.nextElementSibling;
      if (sibling) {
        const t = (sibling.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length > 0 && t.length < 200) return t;
      }
      sibling = radio.previousElementSibling;
      if (sibling && !sibling.matches('input, select, textarea')) {
        const t = (sibling.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length > 0 && t.length < 200) return t;
      }
      // Fallback: parent text with value stripped
      const raw = (parent.textContent || '').trim().replace(/\s+/g, ' ');
      const v = (radio.value || '').trim();
      const text = v ? raw.replace(v, '').trim() : raw;
      if (text && text.length < 200) return text;
    }
    return (radio.value || '').trim();
  }

  // One field per radio group (same name). Label from first radio; options from each radio.
  function gatherRadioGroups() {
    const seen = new Set();
    const out = [];
    const radios = document.querySelectorAll('input[type="radio"]:not([disabled])');
    for (const r of radios) {
      const name = (r.getAttribute('name') || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const selector = 'input[type="radio"][name="' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]:not([disabled])';
      const group = document.querySelectorAll(selector);
      const options = Array.from(group).map(function (o) {
        const v = (o.value || '').trim();
        const text = getRadioOptionText(o);
        return { value: v || text, text: (text || v).substring(0, 200) };
      });
      const first = group[0];
      const label = getFieldLabel(first);
      out.push({ el: first, label, placeholder: '', tag: 'input', type: 'radio', radios: Array.from(group), options });
    }
    return out;
  }

  // Google Forms–style: [role="radiogroup"] with [role="radio"] children, or [role="radio"] under a common parent.
  // Only elements that are NOT native input[type="radio"] (to avoid duplicating gatherRadioGroups).
  function getRoleRadioOptionText(roleEl) {
    const ariaLabel = (roleEl.getAttribute('aria-label') || '').trim();
    if (ariaLabel && ariaLabel.length < 200) return ariaLabel;
    const raw = (roleEl.textContent || '').trim().replace(/\s+/g, ' ');
    if (raw.length > 0 && raw.length < 200) return raw;
    return (roleEl.getAttribute('aria-describedby') && document.getElementById(roleEl.getAttribute('aria-describedby')))
      ? (document.getElementById(roleEl.getAttribute('aria-describedby')).textContent || '').trim().replace(/\s+/g, ' ').substring(0, 200)
      : '';
  }

  function gatherRoleRadioGroups() {
    const out = [];
    const used = new Set(); // DOM elements already in a group, so we don't double-count

    // 1) Prefer [role="radiogroup"]: one field per radiogroup, [role="radio"] children
    const radiogroups = document.querySelectorAll('[role="radiogroup"]');
    for (const rg of radiogroups) {
      const radios = Array.from(rg.querySelectorAll('[role="radio"]')).filter(function (el) {
        return el.matches && !el.matches('input[type="radio"]');
      });
      if (radios.length === 0) continue;
      const options = radios.map(function (r) {
        const text = getRoleRadioOptionText(r);
        return { value: text, text: text.substring(0, 200) };
      });
      const labelledById = rg.getAttribute('aria-labelledby');
      const labelRef = labelledById ? document.getElementById(labelledById.split(/\s+/)[0]) : null;
      const label = (rg.getAttribute('aria-label') || '').trim()
        || (labelRef ? (labelRef.textContent || '').trim().replace(/\s+/g, ' ') : '')
        || getFieldLabel(radios[0]);
      radios.forEach(function (r) { used.add(r); });
      out.push({ el: radios[0], label, placeholder: '', tag: 'div', type: 'radio', roleRadio: true, radios, options });
    }

    // 2) [role="radio"] not inside any [role="radiogroup"]: group by common parent (e.g. question container)
    const roleRadios = document.querySelectorAll('[role="radio"]');
    const notInGroup = Array.from(roleRadios).filter(function (el) {
      if (el.matches && el.matches('input[type="radio"]')) return false;
      if (used.has(el)) return false;
      return !el.closest('[role="radiogroup"]');
    });
    if (notInGroup.length > 0) {
      // Group by closest [role="group"] or direct parent (one group per question container)
      const byKey = new Map();
      for (const r of notInGroup) {
        const key = r.closest('[role="group"]') || r.parentElement;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(r);
      }
      for (const [, radios] of byKey) {
        if (radios.length === 0) continue;
        const options = radios.map(function (r) {
          const text = getRoleRadioOptionText(r);
          return { value: text, text: text.substring(0, 200) };
        });
        const label = getFieldLabel(radios[0]);
        out.push({ el: radios[0], label, placeholder: '', tag: 'div', type: 'radio', roleRadio: true, radios, options });
      }
    }
    return out;
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
      const field = { el, label, placeholder, tag, type };
      if (tag === 'select' && el.options && el.options.length) {
        field.options = Array.from(el.options).map(function (o) {
          const v = (o.value || '').trim();
          const t = (o.text || '').trim();
          return { value: v || t, text: t || v };
        }).filter(function (o) { return o.value || o.text; });
      }
      fields.push(field);
    }
    fields.push.apply(fields, gatherRadioGroups());
    fields.push.apply(fields, gatherRoleRadioGroups());
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

  // Normalize text for better matching: remove punctuation, handle abbreviations, etc.
  function normalizeForMatching(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/[()]/g, ' ')  // Remove parentheses but keep space
      .replace(/[^\w\s]/g, '')  // Remove other punctuation
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Extract abbreviation from text like "Computer Engineering (COE)" -> "coe"
  function extractAbbreviation(text) {
    const match = text.match(/\(([^)]+)\)/);
    return match ? normalizeForMatching(match[1]) : '';
  }

  // Score how well input matches option (higher = better match)
  function scoreMatch(input, optionText, optionValue) {
    const normInput = normalizeForMatching(input);
    const normText = normalizeForMatching(optionText || '');
    const normValue = normalizeForMatching(optionValue || '');
    
    if (!normInput || (!normText && !normValue)) return 0;
    
    // Exact match (highest score)
    if (normText === normInput || normValue === normInput) return 100;
    
    // Check abbreviation match (e.g., "COE" matches "Computer Engineering (COE)")
    const abbrev = extractAbbreviation(optionText || optionValue || '');
    if (abbrev && abbrev === normInput) return 90;
    if (normInput === abbrev || abbrev === normInput) return 90;
    
    // One contains the other (good match)
    if (normText.includes(normInput) || normInput.includes(normText)) return 80;
    if (normValue.includes(normInput) || normInput.includes(normValue)) return 80;
    
    // Word-by-word matching (e.g., "electronics computer" matches "Electronics and Computer")
    const inputWords = normInput.split(/\s+/).filter(w => w.length > 2);
    const textWords = normText.split(/\s+/).filter(w => w.length > 2);
    if (inputWords.length > 0 && textWords.length > 0) {
      const matchingWords = inputWords.filter(w => textWords.some(tw => tw.includes(w) || w.includes(tw)));
      if (matchingWords.length === inputWords.length) return 70; // All words match
      if (matchingWords.length > 0) return 50; // Some words match
    }
    
    // Partial word match
    const inputFirstWord = inputWords[0] || '';
    const textFirstWord = textWords[0] || '';
    if (inputFirstWord && textFirstWord && (inputFirstWord.includes(textFirstWord) || textFirstWord.includes(inputFirstWord))) {
      return 40;
    }
    
    return 0;
  }

  // field: { el, tag, type, radios?, options? }. value: string (profile or AI answer).
  function setInputValue(field, value) {
    if (!field || value == null) return;
    const el = field.el;
    if (!el) return;
    let v = String(value).trim();
    const tag = (el.tagName || '').toLowerCase();
    const type = (field.type || el.type || el.getAttribute('type') || '').toLowerCase();

    // Role-based [role="radio"] (e.g. Google Forms): scoreMatch → aria-checked, focus, click, mouse events
    if (field.roleRadio && field.radios && field.radios.length) {
      const options = field.options || [];
      let bestMatch = null;
      let bestScore = 0;
      field.radios.forEach(function (r, i) {
        const opt = options[i];
        const optText = (opt && opt.text) ? opt.text.trim() : '';
        const optValue = (opt && (opt.value || opt.text)) ? String(opt.value || opt.text).trim() : getRoleRadioOptionText(r);
        const displayText = optText || optValue || getRoleRadioOptionText(r);
        const score = scoreMatch(v, displayText, optValue);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = r;
        }
      });
      const minScore = 30;
      if (bestMatch && bestScore >= minScore) {
        const radiogroup = bestMatch.closest('[role="radiogroup"]');
        if (radiogroup) {
          radiogroup.querySelectorAll('[role="radio"]').forEach(function (r) {
            r.setAttribute('aria-checked', r === bestMatch ? 'true' : 'false');
          });
        } else {
          field.radios.forEach(function (r) {
            r.setAttribute('aria-checked', r === bestMatch ? 'true' : 'false');
          });
        }
        bestMatch.focus();
        bestMatch.click();
        bestMatch.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
        bestMatch.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
        bestMatch.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
      }
      return;
    }

    // Native input type="radio": match value or option text with improved fuzzy matching
    if (field.radios && field.radios.length) {
      const options = field.options || [];
      let bestMatch = null;
      let bestScore = 0;

      // Try to find the best matching radio option
      field.radios.forEach(function (r, i) {
        const rv = (r.value || '').trim();
        const opt = options[i];
        const optText = (opt && opt.text) ? opt.text.trim() : '';
        const optValue = (opt && (opt.value || opt.text)) ? String(opt.value || opt.text).trim() : rv;
        const displayText = optText || optValue || rv;

        const score = scoreMatch(v, displayText, optValue);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = r;
        }
      });

      // If we found a good match (score >= 40), select it
      if (bestMatch && bestScore >= 40) {
        bestMatch.checked = true;
        bestMatch.dispatchEvent(new Event('change', { bubbles: true }));
        bestMatch.dispatchEvent(new Event('input', { bubbles: true }));
        var labelFor = bestMatch.id && document.querySelector('label[for="' + bestMatch.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
        if (labelFor) {
          labelFor.click();
        } else {
          bestMatch.click();
        }
      }
      return;
    }

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
    // type="number" only accepts valid numbers
    if (tag === 'input' && type === 'number') {
      v = v.replace(/\D/g, '') || '';
      if (v === '') return;
    }
    try {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
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
      const field = fields[i];
      const { el, label, placeholder, tag, type, options } = field;
      const effectiveLabel = (label || placeholder || '').trim();
      const effLower = effectiveLabel.toLowerCase();
      const isTextLike = tag === 'textarea' || (tag === 'input' && (type === 'text' || type === 'email' || type === 'url' || type === ''));
      const isMultipleChoice = (tag === 'select') || (type === 'radio' && field.radios);

      if (classifications[i] === 'PREFILLED') {
        const profileKey = getProfileKeyForLabel(effectiveLabel);
        const profileValue = profileKey ? getProfileValue(profile, profileKey) : null;
        if (profileValue) {
          setInputValue(field, profileValue);
          addFillLabel(el, 'Prefilled');
          filled++;
        }
        continue;
      }

      // AI path: text/textarea or multiple choice (pick one from options)
      if (classifications[i] === 'AI_ANSWER' && resume && apiKey) {
        if (effectiveLabel.length < 15 && skipForAI.some(s => effLower === s || effLower.startsWith(s + ' '))) continue;
        let question = effectiveLabel || 'Please provide a brief professional response for this form field.';
        if (isMultipleChoice && options && options.length) {
          const optList = options.map(function (o) { return o.text || o.value; }).filter(Boolean).join(', ');
          question = question + ' Choose exactly one from: ' + optList + '. Reply with only that option.';
        } else if (!isTextLike) continue;
        try {
          const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'GENERATE_ANSWER', question, resume, apiKey, apiProvider }, resolve);
          });
          if (response && response.text) {
            setInputValue(field, response.text);
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
      const field = fields[i];
      const { el, label, placeholder, tag, type, radios, options } = field;
      const currentVal = (radios && radios.length)
        ? (field.roleRadio
            ? (radios.some(function (r) { return r.getAttribute('aria-checked') === 'true'; }) ? 'selected' : '')
            : ((radios.find(function (r) { return r.checked; }) || {}).value || '').trim())
        : (el.value || '').trim();
      if (currentVal) continue;
      const effectiveLabel = (label || placeholder || '').trim();
      const effLower = effectiveLabel.toLowerCase();
      const isTextLike = tag === 'textarea' || (tag === 'input' && (type === 'text' || type === 'email' || type === 'url' || type === ''));
      const isMultipleChoice = (tag === 'select') || (type === 'radio' && radios);
      if ((!isTextLike && !isMultipleChoice) || !resume || !apiKey) continue;
      if (effectiveLabel.length < 15 && skipForAI.some(s => effLower === s || effLower.startsWith(s + ' '))) continue;
      let question = effectiveLabel || 'Please provide a brief professional response for this form field.';
      if (isMultipleChoice && options && options.length) {
        const optList = options.map(function (o) { return o.text || o.value; }).filter(Boolean).join(', ');
        question = question + ' Choose exactly one from: ' + optList + '. Reply with only that option.';
      }
      try {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'GENERATE_ANSWER', question, resume, apiKey, apiProvider }, resolve);
        });
        if (response && response.text) {
          setInputValue(field, response.text);
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
