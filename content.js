/**
 * Job Application Auto-Fill — Content script.
 * Finds form fields, fills from profile or AI.
 */

(function () {
  if (typeof JobAutoFillFieldMapping === 'undefined') return;

  const { getProfileKeyForLabel } = JobAutoFillFieldMapping;

  const MIN_MATCH_SCORE = 30;
  const DROPDOWN_OPEN_MS = 320;
  const GENERIC_PLACEHOLDERS = ['your answer', 'other response', 'enter your answer', 'choose', 'select'];
  const SKIP_FOR_AI = ['other response', 'other', 'specify', 'please specify', 'your answer'];

  function trimText(s) {
    return (s == null ? '' : String(s)).trim().replace(/\s+/g, ' ');
  }

  function safeIdSelector(id) {
    if (!id) return null;
    try {
      return id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    } catch (_) {
      return null;
    }
  }

  function getFieldLabel(el) {
    if (!el) return '';
    const parts = [];

    // 1. Explicit label via for= or aria-labelledby
    const id = el.id;
    const idSel = safeIdSelector(id);
    if (idSel) {
      try {
        const label = document.querySelector('label[for="' + idSel + '"]');
        if (label) {
          const t = trimText(label.textContent);
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
    if (idSel) {
      try {
        const label = document.querySelector('label[for="' + idSel + '"]');
        if (label) directParts.push(trimText(label.textContent));
      } catch (_) {}
    }
    if (prev && !prev.querySelector('input, select, textarea')) {
      const t = (prev.textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 200) directParts.push(t);
    }
    const direct = [...new Set(directParts)].filter(p => p.length >= 2 && p.length <= 350);
    if (direct.length > 0) {
      const chosen = direct.reduce((a, b) => a.length <= b.length ? a : b);
      if (GENERIC_PLACEHOLDERS.includes(chosen.toLowerCase().trim()) && parts.length > 0) {
        const questionLike = [...new Set(parts)].filter(p => p && p.length > 2 && p.length <= 350 && !GENERIC_PLACEHOLDERS.includes((p || '').toLowerCase().trim()));
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
    const idSel = safeIdSelector(radio.id);
    if (idSel) {
      try {
        const label = document.querySelector('label[for="' + idSel + '"]');
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

  // Text for a single [role="option"] (listbox dropdown option)
  function getRoleOptionText(optionEl) {
    const ariaLabel = (optionEl.getAttribute('aria-label') || '').trim();
    if (ariaLabel && ariaLabel.length < 300) return ariaLabel;
    const raw = (optionEl.textContent || '').trim().replace(/\s+/g, ' ');
    if (raw.length > 0 && raw.length < 300) return raw;
    return '';
  }

  function gatherRoleListboxes() {
    const out = [];
    const comboboxes = document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"]');
    for (const combo of comboboxes) {
      if (combo.closest('[role="listbox"]') || combo.closest('[role="menu"]')) continue;
      const listboxId = combo.getAttribute('aria-controls');
      const byId = listboxId ? document.getElementById(listboxId) : null;
      const listbox = byId && (byId.getAttribute('role') === 'listbox' || byId.querySelectorAll('[role="option"], [role="menuitem"]').length) ? byId : null;
      let optionEls = listbox ? Array.from(listbox.querySelectorAll('[role="option"], [role="menuitem"]')) : [];
      if (optionEls.length === 0 && byId) {
        optionEls = Array.from(byId.querySelectorAll('[role="menuitem"]'));
      }
      const options = optionEls.map(function (o) {
        const text = getRoleOptionText(o);
        return { value: text, text: text.substring(0, 200) };
      }).filter(function (o) { return (o.text || o.value); });
      const label = (combo.getAttribute('aria-label') || '').trim()
        || getFieldLabel(combo);
      out.push({
        el: combo,
        label,
        placeholder: (combo.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100),
        tag: 'div',
        type: 'listbox',
        roleListbox: true,
        listboxEl: listbox || null,
        optionEls,
        options
      });
    }
    return out;
  }

  // For dropdown triggers that only show "Choose", get the real question title from parent (e.g. "Branch *").
  function getDropdownQuestionLabel(trigger) {
    const skipText = ['choose', 'select'];
    function ok(t) {
      const s = (t || '').trim().replace(/\s+/g, ' ');
      return s.length > 1 && s.length < 200 && !skipText.includes(s.toLowerCase());
    }
    for (let p = trigger.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.closest('[class*="exportSelectPopup"], [class*="SelectPopup"]')) continue;
      const heading = p.querySelector('[class*="Title"], [class*="title"], [class*="Header"], [role="heading"]');
      if (heading && !trigger.contains(heading) && heading !== trigger) {
        const t = (heading.textContent || '').trim().replace(/\s+/g, ' ');
        if (ok(t)) return t;
      }
      for (const child of p.children) {
        if (child.contains(trigger) || child === trigger) continue;
        const t = (child.textContent || '').trim().replace(/\s+/g, ' ');
        if (ok(t)) return t;
      }
      const raw = (p.textContent || '').trim().replace(/\s+/g, ' ');
      const withoutPlaceholder = raw.replace(/\bChoose\b/gi, '').replace(/\bSelect\b/gi, '').trim();
      const first = withoutPlaceholder.split(/\s{2,}|\n/)[0] || withoutPlaceholder.substring(0, 80);
      if (ok(first)) return first;
    }
    const parent = trigger.closest('[role="group"], [class*="Question"], [class*="question"], [class*="Formviewer"], [class*="freebird"]');
    if (parent && !parent.closest('[class*="exportSelectPopup"]')) {
      const prev = trigger.previousElementSibling;
      if (prev) {
        const t = (prev.textContent || '').trim().replace(/\s+/g, ' ');
        if (ok(t)) return t;
      }
      const raw = (parent.textContent || '').trim().replace(/\s+/g, ' ');
      const first = raw.replace(/\bChoose\b/gi, '').trim().split(/\s{2,}|\n/)[0] || raw.substring(0, 80);
      if (ok(first)) return first;
    }
    return '';
  }

  // Google Forms: div-based dropdown (class names, no ARIA). Trigger shows "Choose"; popup has options.
  function gatherGoogleFormsDropdowns() {
    const out = [];
    const seen = new Set();

    function addTrigger(trigger) {
      if (!trigger || seen.has(trigger)) return;
      if (trigger.closest('[class*="exportSelectPopup"], [class*="SelectPopup"]')) return;
      let label = getFieldLabel(trigger);
      if (!label || label.trim() === 'Choose' || label.trim() === 'Select') {
        label = getDropdownQuestionLabel(trigger) || label;
      }
      const placeholder = (trigger.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100);
      if (!label && !placeholder) return;
      seen.add(trigger);
      out.push({
        el: trigger,
        label: label || placeholder,
        placeholder,
        tag: 'div',
        type: 'listbox',
        roleListbox: true,
        listboxEl: null,
        optionEls: [],
        options: [],
        googleFormsDropdown: true
      });
    }

    // 1) Class-based: known Google Forms patterns (including minified/hashed)
    const classSelectors = [
      '[class*="PaperselectOptionList"]',
      '[class*="MenuPaperselect"]',
      '[class*="quantumWizMenuPaperselect"]',
      '[class*="MaterialWizMenuPaperselect"]',
      '[class*="freebirdThemedSelect"]',
      '[class*="Dropdown"]:not([class*="SelectPopup"])',
      '[data-value][class*="Select"]'
    ];
    for (const sel of classSelectors) {
      try {
        const list = document.querySelectorAll(sel);
        for (const el of list) {
          if (el.closest('[class*="exportSelectPopup"], [class*="SelectPopup"]')) continue;
          addTrigger(el);
        }
      } catch (_) {}
    }

    // 2) Fallback: any element that shows "Choose" (or "Select") and is a dropdown trigger (not inside popup)
    const placeholders = ['Choose', 'Select'];
    const all = document.querySelectorAll('div, span, [role="button"]');
    for (const el of all) {
      const text = (el.textContent || '').trim();
      if (!placeholders.includes(text)) continue;
      if (el.closest('[class*="exportSelectPopup"], [class*="SelectPopup"]')) continue;
      const clickable = el.closest('[class*="Select"], [class*="Dropdown"], [class*="MenuPaper"], [class*="Paperselect"]') || el.parentElement;
      const trigger = clickable && clickable !== el ? clickable : el;
      const rect = trigger.getBoundingClientRect && trigger.getBoundingClientRect();
      if (trigger && rect && rect.width > 20 && rect.height > 10) {
        addTrigger(trigger);
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
    fields.push.apply(fields, gatherRoleListboxes());
    const seenEls = new Set(fields.map(function (f) { return f.el; }));
    const gformDropdowns = gatherGoogleFormsDropdowns().filter(function (f) { return !seenEls.has(f.el); });
    fields.push.apply(fields, gformDropdowns);
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

    // Google Forms / custom dropdown: [role="combobox"] + [role="listbox"] or Google class-based dropdown
    if (field.roleListbox && field.el) {
      const combo = field.el;
      combo.focus();
      combo.click();
      combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
      combo.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
      combo.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
      const listboxPromise = new Promise(function (resolve) {
        setTimeout(function () {
          const listboxId = combo.getAttribute('aria-controls');
          let listbox = listboxId ? document.getElementById(listboxId) : null;
          if (!listbox || listbox.querySelectorAll('[role="option"], [role="menuitem"]').length === 0) {
            const all = document.querySelectorAll('[role="listbox"], [role="menu"]');
            for (const lb of all) {
              if (lb.querySelectorAll('[role="option"], [role="menuitem"]').length && (lb.offsetParent != null || lb.getBoundingClientRect().height > 0)) {
                listbox = lb;
                break;
              }
            }
          }
          let optionEls = listbox ? Array.from(listbox.querySelectorAll('[role="option"], [role="menuitem"]')) : (field.optionEls || []);
          if (optionEls.length === 0 && field.optionEls && field.optionEls.length) optionEls = field.optionEls;
          if (optionEls.length === 0 && (field.googleFormsDropdown || !listbox)) {
            const popup = document.querySelector('[class*="exportSelectPopup"], [class*="SelectPopup"]');
            if (popup) {
              optionEls = Array.from(popup.querySelectorAll('[class*="PaperselectOption"], [class*="exportOption"], [class*="SelectOption"], [class*="quantumWizMenuPaperselectOption"], [class*="Option"]')).filter(function (o) { return (o.textContent || '').trim().length > 0; });
              if (optionEls.length === 0) {
                optionEls = Array.from(popup.querySelectorAll('[data-value]')).filter(function (o) { return (o.textContent || '').trim().length > 0; });
              }
              if (optionEls.length === 0 && popup.children.length > 0) {
                optionEls = Array.from(popup.children).filter(function (o) { return (o.textContent || '').trim().length > 0 && (o.textContent || '').trim() !== 'Choose'; });
              }
            }
          }
          let bestOptEl = null;
          let bestScore = 0;
          for (const optEl of optionEls) {
            const optText = getRoleOptionText(optEl);
            const score = scoreMatch(v, optText, optText);
            if (score > bestScore) {
              bestScore = score;
              bestOptEl = optEl;
            }
          }
          if (bestOptEl && bestScore >= MIN_MATCH_SCORE) {
            bestOptEl.focus();
            bestOptEl.click();
            bestOptEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
            bestOptEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
            bestOptEl.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
          }
          resolve();
        }, DROPDOWN_OPEN_MS);
      });
      return listboxPromise;
    }

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
      if (bestMatch && bestScore >= MIN_MATCH_SCORE) {
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

      if (bestMatch && bestScore >= 40) {
        bestMatch.checked = true;
        bestMatch.dispatchEvent(new Event('change', { bubbles: true }));
        bestMatch.dispatchEvent(new Event('input', { bubbles: true }));
        const labelSel = safeIdSelector(bestMatch.id);
        const labelFor = labelSel ? document.querySelector('label[for="' + labelSel + '"]') : null;
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
      if (opts.length === 0) return;
      let bestOpt = null;
      let bestScore = 0;
      for (const optEl of opts) {
        const optVal = (optEl.value || '').trim();
        const optText = (optEl.text || '').trim();
        if (!optVal && !optText) continue; // skip placeholder/empty
        const score = scoreMatch(v, optText, optVal);
        if (score > bestScore) {
          bestScore = score;
          bestOpt = optEl;
        }
      }
      if (bestOpt && bestScore >= MIN_MATCH_SCORE) {
        el.value = bestOpt.value;
      } else {
        const fallback = opts.find(o => (o.value || o.text).trim().toLowerCase() === v.toLowerCase())
          || opts.find(o => (o.text || o.value).trim().toLowerCase().includes(v.toLowerCase()));
        if (fallback) el.value = fallback.value;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
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

  async function tryFillWithAI(field, question, apiKey, apiProvider, resume) {
    try {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'GENERATE_ANSWER', question, resume, apiKey, apiProvider }, resolve);
      });
      if (response && response.text) {
        const setPromise = setInputValue(field, response.text);
        if (setPromise && typeof setPromise.then === 'function') await setPromise;
        addFillLabel(field.el, 'AI');
        return { filled: 1 };
      }
      if (response && response.error) return { error: ((field.label || field.placeholder || '').trim() || 'Field') + ': ' + response.error };
    } catch (e) {
      return { error: ((field.label || field.placeholder || '').trim() || 'Field') + ': ' + (e.message || String(e)) };
    }
    return {};
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
    let classifications = [];

    // Step 1: Classify each field as PREFILLED or AI_ANSWER
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

    // Step 2: Route each field to PREFILLED or AI path
    let filled = 0;
    const errors = [];

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const { el, label, placeholder, tag, type, options } = field;
      const effectiveLabel = (label || placeholder || '').trim();
      const effLower = effectiveLabel.toLowerCase();
      const isTextLike = tag === 'textarea' || (tag === 'input' && (type === 'text' || type === 'email' || type === 'url' || type === ''));
      const isMultipleChoice = (tag === 'select') || (type === 'listbox' && field.roleListbox) || (type === 'radio' && field.radios);

      if (classifications[i] === 'PREFILLED') {
        const profileKey = getProfileKeyForLabel(effectiveLabel);
        const profileValue = profileKey ? getProfileValue(profile, profileKey) : null;
        if (profileValue) {
          const setPromise = setInputValue(field, profileValue);
          if (setPromise && typeof setPromise.then === 'function') await setPromise;
          addFillLabel(el, 'Prefilled');
          filled++;
        }
        continue;
      }

      if (classifications[i] === 'AI_ANSWER' && resume && apiKey) {
        if (effectiveLabel.length < 15 && SKIP_FOR_AI.some(s => effLower === s || effLower.startsWith(s + ' '))) continue;
        let question = effectiveLabel || 'Please provide a brief professional response for this form field.';
        if (isMultipleChoice && options && options.length) {
          const optList = options.map(o => o.text || o.value).filter(Boolean).join(', ');
          question = question + ' Choose exactly one from: ' + optList + '. Reply with only that option.';
        } else if (!isTextLike) continue;
        const result = await tryFillWithAI(field, question, apiKey, apiProvider, resume);
        if (result.filled) filled++;
        if (result.error) errors.push(result.error);
      }
    }

    // Step 3: Fill still-empty fields with AI
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const { el, label, placeholder, tag, type, radios, options } = field;
      let currentVal = (radios && radios.length)
        ? (field.roleRadio
            ? (radios.some(r => r.getAttribute('aria-checked') === 'true') ? 'selected' : '')
            : ((radios.find(r => r.checked) || {}).value || '').trim())
        : (field.roleListbox ? trimText(el.textContent) : (el.value || '').trim());
      if (field.roleListbox && (currentVal === 'Choose' || currentVal === 'Select' || (placeholder && trimText(currentVal) === trimText(placeholder)))) currentVal = '';
      if (currentVal) continue;
      const effectiveLabel = trimText(label || placeholder);
      const effLower = effectiveLabel.toLowerCase();
      const isTextLike = tag === 'textarea' || (tag === 'input' && (type === 'text' || type === 'email' || type === 'url' || type === ''));
      const isMultipleChoice = (tag === 'select') || (type === 'listbox' && field.roleListbox) || (type === 'radio' && radios);
      if ((!isTextLike && !isMultipleChoice) || !resume || !apiKey) continue;
      if (effectiveLabel.length < 15 && SKIP_FOR_AI.some(s => effLower === s || effLower.startsWith(s + ' '))) continue;
      let question = effectiveLabel || 'Please provide a brief professional response for this form field.';
      if (isMultipleChoice && options && options.length) {
        const optList = options.map(o => o.text || o.value).filter(Boolean).join(', ');
        question = question + ' Choose exactly one from: ' + optList + '. Reply with only that option.';
      }
      const result = await tryFillWithAI(field, question, apiKey, apiProvider, resume);
      if (result.filled) filled++;
      if (result.error) errors.push(result.error);
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
