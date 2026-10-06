/**
 * Unified Gemini API Client & Fallback Engine
 * 
 * Provides a single, reusable interface to query Google Gemini models.
 * Automatically attempts gemini-3.6-flash first, and seamlessly cascades
 * to gemini-3.7-flash, gemini-3.5-flash, and earlier models upon experiencing
 * high demand (503), rate limits (429), or capacity spikes.
 */

export const DEFAULT_GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro'
];

/**
 * Returns a priority score for model ordering (lower number = tried earlier).
 * 3.6-flash (primary) -> 3.7-flash (1st backup) -> 3.5-flash (2nd backup) -> 2.0 -> 1.5
 */
export function getModelPriorityScore(modelName) {
  if (!modelName) return 999;
  const lower = modelName.toLowerCase();
  
  if (lower.includes('3.6') && lower.includes('flash')) return 10;
  if (lower.includes('3.7') && lower.includes('flash')) return 20;
  if (lower.includes('3.5') && lower.includes('flash')) return 30;
  if (lower.includes('3.6')) return 32;
  if (lower.includes('3.7')) return 34;
  if (lower.includes('3.5')) return 36;
  
  // 2.0 generation
  if (lower.includes('2.0') && lower.includes('flash')) return 40;
  if (lower.includes('2.0')) return 45;
  
  // 1.5 generation
  if (lower.includes('1.5') && lower.includes('flash-8b')) return 50;
  if (lower.includes('1.5') && lower.includes('flash')) return 55;
  if (lower.includes('1.5') && lower.includes('pro')) return 60;
  
  // Generic flash or fallback
  if (lower.includes('flash')) return 70;
  return 80;
}

/**
 * Builds an ordered list of models to try, prioritizing preferredModel,
 * followed strictly by 3.6-flash, 3.7-flash, 3.5-flash, and older models.
 */
export function getCandidateModels(preferredModel, availableModels = []) {
  const primary = preferredModel || DEFAULT_GEMINI_MODELS[0];
  const pool = Array.from(new Set([
    primary,
    ...DEFAULT_GEMINI_MODELS,
    ...(availableModels || [])
  ])).filter(Boolean);

  const remaining = pool.filter(m => m !== primary);

  remaining.sort((a, b) => {
    const scoreA = getModelPriorityScore(a);
    const scoreB = getModelPriorityScore(b);
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
    return a.localeCompare(b);
  });

  return [primary, ...remaining];
}

/**
 * Checks if an error status or message warrants falling back to a backup model.
 */
export function isModelFallbackError(status, errorData) {
  if (status === 429 || status === 503 || status === 500 || status === 502 || status === 504 || status === 404) {
    return true;
  }
  if (!errorData) return false;
  
  const msg = (errorData.message || '').toLowerCase();
  const errStatus = (errorData.status || '').toUpperCase();
  const code = errorData.code;

  if (code === 429 || code === 503 || code === 500 || code === 502 || code === 504 || code === 404) {
    return true;
  }

  if (errStatus === 'RESOURCE_EXHAUSTED' || errStatus === 'UNAVAILABLE' || errStatus === 'INTERNAL' || errStatus === 'NOT_FOUND') {
    return true;
  }

  const indicators = [
    'high demand',
    'overloaded',
    'spikes in demand',
    'try again later',
    'resource exhausted',
    'quota',
    'rate limit',
    'capacity',
    'temporar',
    'not found',
    'is not supported'
  ];

  return indicators.some(indicator => msg.includes(indicator));
}

/**
 * Core fallback execution loop.
 */
export async function generateContentWithFallback({
  apiKey,
  preferredModel,
  availableModels = [],
  payload,
  onFallback
}) {
  const activeKey = apiKey || localStorage.getItem('b1_gemini_api_key');
  if (!activeKey) {
    throw new Error('Kein API-Schlüssel hinterlegt. Bitte gib deinen Gemini API-Schlüssel ein.');
  }

  const candidates = getCandidateModels(preferredModel, availableModels);
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const isPrimary = i === 0;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.error) {
        const shouldFallback = isModelFallbackError(response.status, data.error);
        if (shouldFallback && i < candidates.length - 1) {
          console.warn(`[Gemini Fallback] Model '${model}' failed (${data.error.message}). Trying backup '${candidates[i + 1]}'...`);
          if (onFallback) {
            onFallback({
              failedModel: model,
              nextModel: candidates[i + 1],
              reason: data.error.message
            });
          }
          lastError = new Error(data.error.message || 'API Error');
          continue;
        }
        throw new Error(data.error.message || 'API Error');
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text && i < candidates.length - 1) {
        console.warn(`[Gemini Fallback] Model '${model}' returned empty candidate text. Trying '${candidates[i + 1]}'...`);
        continue;
      }

      return {
        data,
        text: text || '',
        usedModel: model,
        wasFallback: !isPrimary
      };
    } catch (err) {
      lastError = err;
      const isNetworkOrFallback = isModelFallbackError(0, { message: err.message });
      if (isNetworkOrFallback && i < candidates.length - 1) {
        console.warn(`[Gemini Fallback] Model '${model}' threw: ${err.message}. Trying backup '${candidates[i + 1]}'...`);
        if (onFallback) {
          onFallback({
            failedModel: model,
            nextModel: candidates[i + 1],
            reason: err.message
          });
        }
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All candidate Gemini models were busy or unavailable. Please try again shortly.');
}

/**
 * High-level unified Gemini query function.
 * Use this everywhere in the app to interact with Gemini with automatic fallback.
 * 
 * @param {Object} options
 * @param {string|Array} options.prompt - The user input or text to generate from.
 * @param {Array} [options.contents] - Full Gemini contents array (e.g. for multi-turn chat).
 * @param {string|Object} [options.systemInstruction] - System instruction string or object.
 * @param {boolean} [options.jsonMode=false] - When true, enforces application/json and parses response.
 * @param {Object} [options.generationConfig={}] - Additional generation options.
 * @param {string} [options.apiKey] - Explicit API key (defaults to localStorage key).
 * @param {string} [options.preferredModel] - Preferred model (defaults to localStorage model or 3.6-flash).
 * @param {Array} [options.availableModels] - List of available models.
 * @param {Function} [options.onFallback] - Callback on model fallback.
 * @returns {Promise<{ text: string, parsedJson: any, data: Object, usedModel: string, wasFallback: boolean }>}
 */
export async function queryGemini({
  prompt,
  contents,
  systemInstruction,
  jsonMode = false,
  generationConfig = {},
  apiKey,
  preferredModel,
  availableModels = [],
  onFallback
}) {
  const key = apiKey || localStorage.getItem('b1_gemini_api_key');
  if (!key) {
    throw new Error('Kein API-Schlüssel hinterlegt. Bitte gib deinen Gemini API-Schlüssel ein.');
  }

  const model = preferredModel || localStorage.getItem('b1_gemini_selected_model') || DEFAULT_GEMINI_MODELS[0];

  let finalContents = contents;
  if (!finalContents && prompt) {
    if (typeof prompt === 'string') {
      finalContents = [{ role: 'user', parts: [{ text: prompt }] }];
    } else if (Array.isArray(prompt)) {
      finalContents = prompt;
    }
  }

  let finalSystemInstruction = undefined;
  if (systemInstruction) {
    if (typeof systemInstruction === 'string') {
      finalSystemInstruction = { parts: [{ text: systemInstruction }] };
    } else {
      finalSystemInstruction = systemInstruction;
    }
  }

  const finalGenConfig = { ...generationConfig };
  if (jsonMode && !finalGenConfig.responseMimeType) {
    finalGenConfig.responseMimeType = 'application/json';
  }

  const payload = {
    contents: finalContents,
    ...(finalSystemInstruction ? { systemInstruction: finalSystemInstruction } : {}),
    ...(Object.keys(finalGenConfig).length > 0 ? { generationConfig: finalGenConfig } : {})
  };

  const result = await generateContentWithFallback({
    apiKey: key,
    preferredModel: model,
    availableModels,
    payload,
    onFallback
  });

  let parsedJson = null;
  if (jsonMode && result.text) {
    try {
      const clean = result.text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      parsedJson = JSON.parse(clean);
    } catch (e) {
      console.warn('[Gemini] JSON parsing of response failed:', e);
    }
  }

  return {
    ...result,
    parsedJson
  };
}

/**
 * Fetches available models from Gemini API for the current API key.
 */
export async function fetchAvailableModels(apiKey) {
  const activeKey = apiKey || localStorage.getItem('b1_gemini_api_key');
  if (!activeKey) return DEFAULT_GEMINI_MODELS;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey}`);
    if (!res.ok) return DEFAULT_GEMINI_MODELS;
    const data = await res.json();
    if (data.models && data.models.length > 0) {
      const names = data.models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''));
      
      const combined = Array.from(new Set([...DEFAULT_GEMINI_MODELS, ...names]));
      combined.sort((a, b) => {
        const scoreA = getModelPriorityScore(a);
        const scoreB = getModelPriorityScore(b);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.localeCompare(b);
      });
      return combined;
    }
  } catch (err) {
    console.error('Error listing Gemini models:', err);
  }
  return DEFAULT_GEMINI_MODELS;
}

/**
 * Shared storage helper functions
 */
export function getStoredGeminiKey() {
  return localStorage.getItem('b1_gemini_api_key') || '';
}

export function setStoredGeminiKey(key) {
  if (key) localStorage.setItem('b1_gemini_api_key', key.trim());
  else localStorage.removeItem('b1_gemini_api_key');
}

export function getStoredGeminiModel() {
  const saved = localStorage.getItem('b1_gemini_selected_model');
  return (!saved || saved === 'gemini-1.5-flash') ? DEFAULT_GEMINI_MODELS[0] : saved;
}

export function setStoredGeminiModel(model) {
  if (model) localStorage.setItem('b1_gemini_selected_model', model);
}

export function getStoredAvailableModels() {
  const saved = localStorage.getItem('b1_gemini_available_models');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return Array.from(new Set([...DEFAULT_GEMINI_MODELS, ...parsed]));
      }
    } catch (e) {}
  }
  return DEFAULT_GEMINI_MODELS;
}
