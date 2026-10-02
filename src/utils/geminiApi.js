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
 * Priority scoring for models. Lower score means tried earlier.
 */
function getModelPriorityScore(modelName) {
  if (!modelName) return 999;
  const lower = modelName.toLowerCase();
  
  // Highest priority requested: 3.6 flash, then 3.7 flash, then 3.5 flash
  if (lower.includes('3.6') && lower.includes('flash')) return 10;
  if (lower.includes('3.7') && lower.includes('flash')) return 20;
  if (lower.includes('3.5') && lower.includes('flash')) return 30;
  if (lower.includes('3.6')) return 32;
  if (lower.includes('3.7')) return 34;
  if (lower.includes('3.5')) return 36;
  
  // 2.0 generation models
  if (lower.includes('2.0') && lower.includes('flash')) return 40;
  if (lower.includes('2.0')) return 45;
  
  // 1.5 generation models
  if (lower.includes('1.5') && lower.includes('flash-8b')) return 50;
  if (lower.includes('1.5') && lower.includes('flash')) return 55;
  if (lower.includes('1.5') && lower.includes('pro')) return 60;
  
  // Other flash models
  if (lower.includes('flash')) return 70;
  
  // Everything else
  return 80;
}

/**
 * Builds an ordered list of models to try, starting with preferredModel.
 */
export function getCandidateModels(preferredModel, availableModels = []) {
  const pool = Array.from(new Set([
    preferredModel,
    ...DEFAULT_GEMINI_MODELS,
    ...(availableModels || [])
  ])).filter(Boolean);

  // Keep preferredModel first
  const remaining = pool.filter(m => m !== preferredModel);

  // Sort remaining models by priority score
  remaining.sort((a, b) => {
    const scoreA = getModelPriorityScore(a);
    const scoreB = getModelPriorityScore(b);
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
    return a.localeCompare(b);
  });

  return [preferredModel, ...remaining];
}

/**
 * Checks if an error is retryable on a different model (high demand, quota, 429, 503, 500, etc.)
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
 * Executes a Gemini generateContent request with automatic backup model fallback.
 */
export async function generateContentWithFallback({
  apiKey,
  preferredModel,
  availableModels = [],
  payload,
  onFallback
}) {
  if (!apiKey) {
    throw new Error('Kein API-Schlüssel hinterlegt. Bitte gib deinen Gemini API-Schlüssel ein.');
  }

  const candidates = getCandidateModels(preferredModel, availableModels);
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const isPrimary = i === 0;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.error) {
        const shouldFallback = isModelFallbackError(response.status, data.error);
        if (shouldFallback && i < candidates.length - 1) {
          console.warn(`[Gemini Fallback] Model '${model}' failed (${data.error.message}). Trying backup model '${candidates[i + 1]}'...`);
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

      // Check for valid response candidates
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text && i < candidates.length - 1) {
        console.warn(`[Gemini Fallback] Model '${model}' returned empty candidate. Trying '${candidates[i + 1]}'...`);
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
        console.warn(`[Gemini Fallback] Model '${model}' threw: ${err.message}. Trying backup model '${candidates[i + 1]}'...`);
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
 * Fetches available models from Gemini API.
 */
export async function fetchAvailableModels(apiKey) {
  if (!apiKey) return DEFAULT_GEMINI_MODELS;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) return DEFAULT_GEMINI_MODELS;
    const data = await res.json();
    if (data.models && data.models.length > 0) {
      const names = data.models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''));
      
      const combined = Array.from(new Set([...DEFAULT_GEMINI_MODELS, ...names]));
      // Sort in our preferred priority order
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
