/**
 * Job Application Auto-Fill — Field mapping.
 * Maps form label/placeholder/name to profile keys or marks field as AI (open-ended).
 */

(function (global) {
  const PROFILE_KEYS = [
    'firstName', 'lastName', 'fullName', 'email', 'phone',
    'yearsExperience', 'linkedin', 'currentCompany', 'currentRole', 'currentCompanyAndRole',
    'currentSalary', 'currentCGPA', 'tenthPercentage', 'tenthBoard', 'tenthStream',
    'twelfthPercentage', 'twelfthBoard', 'twelfthStream', 'rollNumber',
    'age', 'gender', 'institute', 'degree', 'branch'
  ];

  // Normalize for matching: lowercase, collapse spaces, remove common punctuation
  function normalize(s) {
    if (typeof s !== 'string') return '';
    return s
      .toLowerCase()
      .replace(/[\s_\-\.]+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Label/placeholder/name patterns → profile key (order matters: more specific before generic like "name")
  const LABEL_TO_KEY = [
    { patterns: ['first name', 'firstname', 'given name', 'fname', 'applicant first'], key: 'firstName' },
    { patterns: ['last name', 'lastname', 'family name', 'surname', 'lname', 'applicant last'], key: 'lastName' },
    { patterns: ['name of institute', 'name of university', 'institute', 'university', 'college', 'institute name', 'university name', 'college name', 'name of your institute', 'name of your university', 'institute university final degree', 'name of institute university final degree', 'final degree institute', 'final degree university'], key: 'institute' },
    { patterns: ['degree', 'qualification', 'course', 'degree name', 'graduation', 'highest qualification', 'highest educational qualification', 'educational qualification'], key: 'degree' },
    { patterns: ['branch', 'branch name', 'specialization', 'department', 'stream', 'branch specialization'], key: 'branch' },
    { patterns: ['full name', 'name', 'applicant name', 'your name', 'candidate name'], key: 'fullName' },
    { patterns: ['email', 'e mail', 'email address', 'e-mail', 'work email', 'primary email', 'applicant email'], key: 'email' },
    { patterns: ['phone', 'telephone', 'mobile', 'cell', 'phone number', 'work phone', 'primary phone', 'contact number'], key: 'phone' },
    { patterns: ['years of experience', 'years experience', 'experience years', 'yoe', 'years in', 'how many years'], key: 'yearsExperience' },
    { patterns: ['linkedin', 'linked in', 'linkedin url', 'linkedin profile'], key: 'linkedin' },
    { patterns: ['current company name role', 'current company role', 'company name role', 'current company and role', 'company and role in it'], key: 'currentCompanyAndRole' },
    {
      patterns: ['current company', 'current employer', 'company name', 'employer', 'organization'],
      key: 'currentCompany',
      // Long question asking for experience/project/tech stack → use AI, not just company name
      excludeIf: function (n) {
        return n.length > 50 || /\b(tell about|describe|explain|tell us about)\b/.test(n) ||
          (/\b(project|tech stack|experience in your)\b/.test(n) && /\bcompany\b/.test(n));
      }
    },
    { patterns: ['current role', 'role', 'designation', 'job title', 'position', 'role in it'], key: 'currentRole' },
    {
      patterns: ['current salary', 'current ctc', 'ctc', 'salary', 'current compensation', 'annual salary', 'expected ctc', 'expected salary', 'current package', 'salary expectation'],
      key: 'currentSalary',
      excludeIf: function (n) {
        return /^(age|your age|dob|date of birth)$/.test(n);
      }
    },
    { patterns: ['current cgpa', 'cgpa', 'current gpa', 'gpa'], key: 'currentCGPA' },
    { patterns: ['age', 'your age', 'date of birth', 'dob'], key: 'age', excludeIf: function (n) { return /10th|12th|tenth|twelfth|percentage|diploma/.test(n); } },
    { patterns: ['10th percentage', '10th %', 'tenth percentage', 'tenth %', 'class 10 percentage', '10 percentage'], key: 'tenthPercentage', excludeIf: function (n) { return /^(age|your age|dob|date of birth)$/.test(n); } },
    { patterns: ['10th board', 'tenth board', 'class 10 board', '10 board'], key: 'tenthBoard' },
    { patterns: ['10th stream', 'tenth stream', 'class 10 stream', '10 stream'], key: 'tenthStream' },
    { patterns: ['12th percentage', '12th %', 'twelfth percentage', 'twelfth %', 'class 12 percentage', '12 percentage', '12 diploma', '12% diploma', 'diploma %', 'diploma percentage'], key: 'twelfthPercentage' },
    { patterns: ['12th board', 'twelfth board', 'class 12 board', '12 board'], key: 'twelfthBoard' },
    { patterns: ['12th stream', 'twelfth stream', 'class 12 stream', '12 stream'], key: 'twelfthStream' },
    { patterns: ['roll number', 'roll no', 'roll no'], key: 'rollNumber' },
    { patterns: ['gender', 'sex', 'male female'], key: 'gender' }
  ];

  function getProfileKeyForLabel(labelText) {
    const n = normalize(labelText);
    if (!n) return null;
    for (const entry of LABEL_TO_KEY) {
      const { patterns, key, excludeIf } = entry;
      if (typeof excludeIf === 'function' && excludeIf(n)) continue;
      for (const p of patterns) {
        if (n === p || n.includes(p) || p.includes(n)) return key;
      }
    }
    return null;
  }

  // Phrases that suggest an open-ended / essay question → use AI (short labels allowed)
  const AI_QUESTION_PATTERNS = [
    'tell me about', 'describe', 'explain', 'why do you', 'what is your',
    'how did you', 'share an example', 'tell us about', 'walk me through',
    'project', 'experience', 'accomplishment', 'challenge', 'motivation',
    'interest', 'goals', 'cover letter', 'additional', 'anything else',
    'summary', 'introduce yourself', 'about yourself', 'background',
    'why us', 'why company', 'why this role', 'letter', 'comments',
    'other', 'question', 'anything', 'message', 'bio', 'story'
  ];

  function looksLikeAIQuestion(labelText) {
    const n = normalize(labelText);
    if (!n) return false;
    for (const p of AI_QUESTION_PATTERNS) {
      if (n.includes(p)) return true;
    }
    return false;
  }

  // Use AI for any text/textarea that has a label/placeholder and we couldn't match profile
  function shouldTryAI(labelText, tagName, placeholder) {
    const text = (labelText || '').trim() || (placeholder || '').trim();
    if (!text) return false;
    const n = normalize(text);
    if (!n) return false;
    // Textareas are almost always open-ended
    if ((tagName || '').toLowerCase() === 'textarea') return true;
    // Short text inputs with question-like label
    if (looksLikeAIQuestion(text)) return true;
    // Longer labels/placeholders often are questions (e.g. "Tell me about a project at your previous company")
    if (n.length >= 15) return true;
    return false;
  }

  global.JobAutoFillFieldMapping = {
    PROFILE_KEYS,
    getProfileKeyForLabel,
    looksLikeAIQuestion,
    shouldTryAI,
    normalize
  };
})(typeof window !== 'undefined' ? window : self);
