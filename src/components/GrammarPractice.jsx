import React, { useState, useEffect, useRef } from 'react';
import { queryGemini, fetchAvailableModels, DEFAULT_GEMINI_MODELS } from '../utils/geminiApi';
import { FIXED_VERBS_GROUPS, ALL_FIXED_VERBS, formatVerbFormula } from '../data/fixedVerbsData';

const PREPOSITION_GROUPS = {
  Akkusativ: ['bis', 'durch', 'für', 'gegen', 'ohne', 'um'],
  Dativ: ['aus', 'bei', 'mit', 'nach', 'seit', 'von', 'zu', 'gegenüber'],
  Wechsel: ['an', 'auf', 'hinter', 'in', 'neben', 'über', 'unter', 'vor', 'zwischen'],
  Genitiv: ['wegen', 'während', 'trotz', 'statt', 'anstatt']
};

const ALL_PREPOSITIONS = [
  ...PREPOSITION_GROUPS.Akkusativ,
  ...PREPOSITION_GROUPS.Dativ,
  ...PREPOSITION_GROUPS.Wechsel,
  ...PREPOSITION_GROUPS.Genitiv
];

const DEFAULT_PREP_WEIGHTS = Object.fromEntries(ALL_PREPOSITIONS.map(p => [p, 2]));

const CORE_13_PREPS = [
  'für', 'um',
  'bei', 'mit', 'nach', 'seit', 'von', 'zu',
  'an', 'auf', 'in', 'über', 'vor'
];
const CORE_13_WEIGHTS = Object.fromEntries(
  ALL_PREPOSITIONS.map(p => [p, CORE_13_PREPS.includes(p) ? 2 : 0])
);

// Helper to strip any raw LaTeX math syntax ($$\textbf{...}$$) and return clean plain text
export const cleanFormulaText = (text) => {
  if (!text) return '';
  return text
    .replace(/\$\$\s*\\textbf\{([^}]+)\}\s*\+\s*\\textbf\{([^}]+)\}\s*\+\s*\\textbf\{([^}]+)\}\s*\$\$/g, '$1 + $2 + $3')
    .replace(/\$\$\s*\\textbf\{([^}]+)\}\s*\$\$/g, '$1')
    .replace(/\$\$(.*?)\$\$/g, '$1')
    .replace(/\\textbf\{([^}]+)\}/g, '$1')
    .replace(/\\textbf/g, '')
    .trim();
};

export default function GrammarPractice() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('b1_gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(!apiKey);
  const [tempKey, setTempKey] = useState('');
  
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem('b1_gemini_selected_model');
    if (!saved || saved === 'gemini-1.5-flash') {
      return 'gemini-3.6-flash';
    }
    return saved;
  });
  const [availableModels, setAvailableModels] = useState(() => {
    const saved = localStorage.getItem('b1_gemini_available_models');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set([...DEFAULT_GEMINI_MODELS, ...parsed]));
        }
      } catch (e) {
        // ignore JSON parse error
      }
    }
    return DEFAULT_GEMINI_MODELS;
  });

  // State to track selected prepositions (synced with saved weights)
  const [selectedPreps, setSelectedPreps] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_prep_weights');
      if (saved) {
        const parsed = JSON.parse(saved);
        const active = ALL_PREPOSITIONS.filter(p => (parsed[p] || 0) > 0);
        if (active.length > 0) return active;
      }
    } catch (e) {}
    return [...ALL_PREPOSITIONS];
  });

  // Weighted Deck & Anti-Repetition States
  const [prepWeights, setPrepWeights] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_prep_weights');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_PREP_WEIGHTS, ...parsed };
      }
    } catch (e) {}
    return DEFAULT_PREP_WEIGHTS;
  });

  const [deckRemaining, setDeckRemaining] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_deck_remaining');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed;
      }
    } catch (e) {}
    return DEFAULT_PREP_WEIGHTS;
  });

  const [recentHistory, setRecentHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.slice(0, 10);
      }
    } catch (e) {}
    return [];
  });

  // Track the last 10 questions individually per preposition and verb
  const [topicHistory, setTopicHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_topic_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return {};
  });

  // 65 High-Frequency Fixed Verbs (Feste Verbverbindungen) Iteration Deck
  const [festVerbsRemaining, setFestVerbsRemaining] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_fest_verbs_remaining');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return ALL_FIXED_VERBS.map(v => v.id);
  });

  const [festVerbsIteration, setFestVerbsIteration] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_fest_verbs_iteration');
      if (saved) {
        const num = parseInt(saved, 10);
        if (!isNaN(num) && num >= 1) return num;
      }
    } catch (e) {}
    return 1;
  });

  const [currentVerbTarget, setCurrentVerbTarget] = useState(null);
  const [showVerbListModal, setShowVerbListModal] = useState(false);
  const [verbSearchQuery, setVerbSearchQuery] = useState('');
  const [verbGroupFilter, setVerbGroupFilter] = useState('all');

  const [showDeckModal, setShowDeckModal] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [questionMode, setQuestionMode] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_question_mode');
      if (saved && ['all', 'situational', 'verbs'].includes(saved)) {
        return saved;
      }
    } catch (e) {}
    return 'situational';
  });

  const [currentQuestions, setCurrentQuestions] = useState([]);
  const [userInputs, setUserInputs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [checkResults, setCheckResults] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  const [fallbackNotice, setFallbackNotice] = useState('');

  const getQueueSignature = (mode = questionMode, preps = selectedPreps) =>
    `${mode}::${[...preps].sort().join(',')}`;

  const [questionQueue, setQuestionQueue] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_question_queue');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          parsed &&
          parsed.signature === getQueueSignature(questionMode, selectedPreps) &&
          Array.isArray(parsed.items)
        ) {
          return parsed.items;
        }
      }
    } catch (e) {}
    return [];
  });
  const [isPrefetching, setIsPrefetching] = useState(false);

  const questionQueueRef = useRef(questionQueue);
  const queueSignatureRef = useRef(getQueueSignature(questionMode, selectedPreps));
  const isPrefetchingRef = useRef(false);
  const deckRemainingRef = useRef(deckRemaining);
  const festVerbsRemainingRef = useRef(festVerbsRemaining);
  const topicHistoryRef = useRef(topicHistory);
  const recentHistoryRef = useRef(recentHistory);
  const prepWeightsRef = useRef(prepWeights);

  useEffect(() => { questionQueueRef.current = questionQueue; }, [questionQueue]);
  useEffect(() => { deckRemainingRef.current = deckRemaining; }, [deckRemaining]);
  useEffect(() => { festVerbsRemainingRef.current = festVerbsRemaining; }, [festVerbsRemaining]);
  useEffect(() => { topicHistoryRef.current = topicHistory; }, [topicHistory]);
  useEffect(() => { recentHistoryRef.current = recentHistory; }, [recentHistory]);
  useEffect(() => { prepWeightsRef.current = prepWeights; }, [prepWeights]);

  const saveQuestionQueue = (items, signatureOverride) => {
    const sig = signatureOverride || queueSignatureRef.current;
    questionQueueRef.current = items;
    setQuestionQueue(items);
    try {
      localStorage.setItem('b1_grammar_question_queue', JSON.stringify({ signature: sig, items }));
    } catch (e) {}
  };

  useEffect(() => {
    const nextSig = getQueueSignature(questionMode, selectedPreps);
    if (nextSig !== queueSignatureRef.current) {
      queueSignatureRef.current = nextSig;
      saveQuestionQueue([], nextSig);
    }
  }, [questionMode, selectedPreps]);

  // Fetch available models if API key is present
  useEffect(() => {
    if (apiKey) {
      fetchAvailableModels(apiKey).then(models => {
        if (models && models.length > 0) {
          setAvailableModels(models);
          localStorage.setItem('b1_gemini_available_models', JSON.stringify(models));
        }
      });
    }
  }, [apiKey]);

  const handleSaveKey = (e) => {
    e.preventDefault();
    if (tempKey.trim()) {
      localStorage.setItem('b1_gemini_api_key', tempKey.trim());
      setApiKey(tempKey.trim());
      setShowKeyInput(false);
      setTempKey('');
    }
  };

  const handleRemoveKey = () => {
    if (window.confirm("Are you sure you want to remove the Gemini API Key?")) {
      localStorage.removeItem('b1_gemini_api_key');
      setApiKey('');
      setShowKeyInput(true);
    }
  };

  // Sync sidebar preposition selection directly to prepWeights & current cycle deckRemaining
  const syncPrepsToCycle = (nextSelectedPreps) => {
    const selectedSet = new Set(nextSelectedPreps);
    const nextWeights = {};
    ALL_PREPOSITIONS.forEach(p => {
      if (selectedSet.has(p)) {
        nextWeights[p] = (prepWeights[p] || 0) > 0 ? prepWeights[p] : 2;
      } else {
        nextWeights[p] = 0;
      }
    });
    setPrepWeights(nextWeights);
    localStorage.setItem('b1_grammar_prep_weights', JSON.stringify(nextWeights));

    setDeckRemaining(prev => {
      const nextRemaining = {};
      ALL_PREPOSITIONS.forEach(p => {
        if (selectedSet.has(p)) {
          nextRemaining[p] = (prev[p] || 0) > 0 ? prev[p] : nextWeights[p];
        } else {
          nextRemaining[p] = 0;
        }
      });
      localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(nextRemaining));
      return nextRemaining;
    });
  };

  // Toggle single preposition
  const togglePrep = (prep) => {
    const nextSelected = selectedPreps.includes(prep)
      ? selectedPreps.filter(p => p !== prep)
      : [...selectedPreps, prep];
    setSelectedPreps(nextSelected);
    syncPrepsToCycle(nextSelected);
  };

  // Toggle entire category group
  const toggleGroup = (groupName) => {
    const groupPreps = PREPOSITION_GROUPS[groupName];
    const allSelected = groupPreps.every(p => selectedPreps.includes(p));
    const nextSelected = allSelected
      ? selectedPreps.filter(p => !groupPreps.includes(p))
      : [...selectedPreps, ...groupPreps.filter(p => !selectedPreps.includes(p))];
    setSelectedPreps(nextSelected);
    syncPrepsToCycle(nextSelected);
  };

  const selectAllPreps = () => {
    const all = [...ALL_PREPOSITIONS];
    setSelectedPreps(all);
    syncPrepsToCycle(all);
  };

  const selectNonePreps = () => {
    setSelectedPreps([]);
    syncPrepsToCycle([]);
  };

  // Speaks complete German text using browser Text-to-Speech
  const speakGermanText = (text) => {
    if (!text) return;
    if (window.speakGerman) {
      window.speakGerman(text);
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'de-DE';
        utt.rate = 0.92;
        window.speechSynthesis.speak(utt);
      } catch (e) {
        console.warn('TTS playback error:', e);
      }
    }
  };

  const handleResetVerbIteration = () => {
    const allIds = ALL_FIXED_VERBS.map(v => v.id);
    setFestVerbsRemaining(allIds);
    localStorage.setItem('b1_grammar_fest_verbs_remaining', JSON.stringify(allIds));
  };

  const handlePracticeSpecificVerb = (verbObj) => {
    setQuestionMode('verbs');
    localStorage.setItem('b1_grammar_question_mode', 'verbs');
    setShowVerbListModal(false);
    generateQuestion(verbObj);
  };

  // Deck Management Helpers
  const handleRefillDeck = (customWeights = prepWeights) => {
    const refilled = { ...customWeights };
    deckRemainingRef.current = refilled;
    setDeckRemaining(refilled);
    localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(refilled));
    saveQuestionQueue([]);
  };

  const [tempWeights, setTempWeights] = useState({ ...DEFAULT_PREP_WEIGHTS });
  const [setAllVal, setSetAllVal] = useState('2');

  const handleOpenWeightsModal = () => {
    setTempWeights({ ...prepWeights });
    setShowDeckModal(true);
  };

  const handleTempWeightChange = (prep, valStr) => {
    const val = valStr === '' ? 0 : parseInt(valStr, 10);
    setTempWeights(prev => ({
      ...prev,
      [prep]: isNaN(val) ? 0 : Math.max(0, val)
    }));
  };

  const handleTempWeightDelta = (prep, delta) => {
    setTempWeights(prev => ({
      ...prev,
      [prep]: Math.max(0, (prev[prep] ?? 0) + delta)
    }));
  };

  const handleApplySetAll = () => {
    const val = parseInt(setAllVal, 10);
    if (!isNaN(val) && val >= 0) {
      const next = Object.fromEntries(ALL_PREPOSITIONS.map(p => [p, val]));
      setTempWeights(next);
    }
  };

  const handleApplyCore13Template = () => {
    setPrepWeights(CORE_13_WEIGHTS);
    localStorage.setItem('b1_grammar_prep_weights', JSON.stringify(CORE_13_WEIGHTS));
    setTempWeights(CORE_13_WEIGHTS);
    setSelectedPreps([...CORE_13_PREPS]);
    handleRefillDeck(CORE_13_WEIGHTS);
  };

  const handlePresetInDialog = (presetType) => {
    if (presetType === 'core_13') {
      handleApplyCore13Template();
      return;
    }
    let next = {};
    if (presetType === 'balanced_2') {
      next = Object.fromEntries(ALL_PREPOSITIONS.map(p => [p, 2]));
    } else if (presetType === 'balanced_1') {
      next = Object.fromEntries(ALL_PREPOSITIONS.map(p => [p, 1]));
    } else if (presetType === 'genitiv_focus') {
      next = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Genitiv.includes(p) ? 4 : 1
      ]));
    } else if (presetType === 'dativ_focus') {
      next = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Dativ.includes(p) ? 3 : 1
      ]));
    } else if (presetType === 'wechsel_focus') {
      next = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Wechsel.includes(p) ? 3 : 1
      ]));
    } else if (presetType === 'akkusativ_focus') {
      next = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Akkusativ.includes(p) ? 3 : 1
      ]));
    }
    setTempWeights(next);
  };

  const handleSaveWeightsModal = (shouldRefill = false) => {
    setPrepWeights(tempWeights);
    localStorage.setItem('b1_grammar_prep_weights', JSON.stringify(tempWeights));
    setSelectedPreps(ALL_PREPOSITIONS.filter(p => (tempWeights[p] || 0) > 0));

    if (shouldRefill) {
      handleRefillDeck(tempWeights);
    } else {
      setDeckRemaining(prev => {
        const next = { ...prev };
        Object.keys(tempWeights).forEach(p => {
          next[p] = Math.min(tempWeights[p] ?? 0, next[p] ?? (tempWeights[p] ?? 0));
        });
        deckRemainingRef.current = next;
        localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(next));
        return next;
      });
      saveQuestionQueue([]);
    }
    setShowDeckModal(false);
  };

  const fetchQuestionBatch = async (count = 2, overrideTargetVerb = null, isBackground = false) => {
    const randomSeed = Math.floor(Math.random() * 1000000);
    let pickedVerbs = [];
    let targetPreps = [];
    let promptText = '';
    let systemInstruction = '';

    if (questionMode === 'verbs' || overrideTargetVerb) {
      if (overrideTargetVerb) {
        pickedVerbs = Array.from({ length: count }, () => overrideTargetVerb);
        if (!isBackground) setCurrentVerbTarget(overrideTargetVerb);
      } else {
        let currentRemainingIds = [...festVerbsRemainingRef.current];
        let iterationBump = 0;

        const drawOneVerb = () => {
          if (currentRemainingIds.length === 0) {
            currentRemainingIds = ALL_FIXED_VERBS.map(v => v.id);
            iterationBump += 1;
          }
          let candidates = currentRemainingIds.map(id => ALL_FIXED_VERBS.find(v => v.id === id)).filter(Boolean);

          if (selectedPreps.length > 0 && selectedPreps.length < ALL_PREPOSITIONS.length) {
            const filteredBySelectedPreps = candidates.filter(v => selectedPreps.includes(v.prep));
            if (filteredBySelectedPreps.length > 0) {
              candidates = filteredBySelectedPreps;
            } else {
              const allMatching = ALL_FIXED_VERBS.filter(v => selectedPreps.includes(v.prep));
              if (allMatching.length > 0) candidates = allMatching;
            }
          }
          if (candidates.length === 0) candidates = ALL_FIXED_VERBS;

          const usedIds = new Set(pickedVerbs.map(v => v.id));
          const distinctPool = candidates.filter(v => !usedIds.has(v.id));
          const pool = distinctPool.length > 0 ? distinctPool : candidates;
          const chosen = pool[Math.floor(Math.random() * pool.length)];
          currentRemainingIds = currentRemainingIds.filter(id => id !== chosen.id);
          return chosen;
        };

        for (let i = 0; i < count; i++) {
          pickedVerbs.push(drawOneVerb());
        }

        if (currentRemainingIds.length === 0) {
          currentRemainingIds = ALL_FIXED_VERBS.map(v => v.id);
          iterationBump += 1;
        }
        if (iterationBump > 0) {
          setFestVerbsIteration(it => {
            const nextIt = it + iterationBump;
            localStorage.setItem('b1_grammar_fest_verbs_iteration', String(nextIt));
            return nextIt;
          });
        }
        festVerbsRemainingRef.current = currentRemainingIds;
        setFestVerbsRemaining(currentRemainingIds);
        localStorage.setItem('b1_grammar_fest_verbs_remaining', JSON.stringify(currentRemainingIds));
        if (!isBackground) setCurrentVerbTarget(pickedVerbs[0]);
      }

      targetPreps = pickedVerbs.map(v => v.prep);

      const topicSpecificList = Array.from(new Set(
        pickedVerbs.flatMap(v => [
          ...(topicHistoryRef.current[`verb_${v.verb}`] || []),
          ...(topicHistoryRef.current[`prep_${v.prep}`] || [])
        ])
      )).slice(0, 10);

      const otherRecentList = recentHistoryRef.current
        .filter(s => !topicSpecificList.some(ts => s === ts || s.startsWith(ts) || ts.startsWith(s)))
        .slice(0, Math.max(0, 10 - topicSpecificList.length));

      const recentAvoidBlock = (topicSpecificList.length > 0 || otherRecentList.length > 0)
        ? `\nCRITICAL ANTI-REPETITION CONSTRAINT:
${topicSpecificList.length > 0 ? `PREVIOUS QUESTIONS ON THESE VERBS/PREPOSITIONS:
${topicSpecificList.map((s, idx) => `  ${idx + 1}. "${s}"`).join('\n')}` : ''}
${otherRecentList.length > 0 ? `\nOTHER RECENTLY GENERATED QUESTIONS (DO NOT REUSE THE SAME CONTEXT OR SUBJECTS):
${otherRecentList.map((s, idx) => `  • "${s}"`).join('\n')}` : ''}
STRICT REQUIREMENT: Use different everyday situations and subjects than the ones listed above, while keeping the vocabulary simple and natural.\n`
        : '';

      const verbSpecs = pickedVerbs.map((v, i) => {
        const vCase = (v.case || '').toLowerCase().startsWith('akk') ? 'Akkusativ' : 'Dativ';
        const vFormula = `${v.verb} + ${v.prep} + ${vCase}`;
        return `QUESTION ${i + 1}:
- Verb: "${v.verb}"
- Fixed Preposition: "${v.prep}"
- Required Case: ${vCase} (${v.case})
- Verb Meaning: "${v.meaning}"
- Pronominal Adverbs (da-/wo-): "${v.daWo}"
- Plain-text formula: "${vFormula}"`;
      }).join('\n\n');

      const schemaItems = pickedVerbs.map((v, i) => {
        const vCase = (v.case || '').toLowerCase().startsWith('akk') ? 'Akkusativ' : 'Dativ';
        return `    {
      "sentence": "German sentence ${i + 1} with a single '___' blank representing '${v.prep}'.",
      "correctPreposition": "${v.prep}",
      "translation": "English translation of sentence ${i + 1}.",
      "category": "Feste Verbverbindung",
      "targetVerb": "${v.verb}",
      "formula": "${v.verb} + ${v.prep} + ${vCase}",
      "case": "${vCase}",
      "meaning": "${v.meaning}",
      "daWo": "${v.daWo}",
      "explanation": "Concise English explanation in plain text without LaTeX math syntax."
    }`;
      }).join(',\n');

      promptText = `Generate ${count} distinct B1-level German sentences testing fixed verb-preposition combinations (Verben mit festen Präpositionen).

${verbSpecs}

CRITICAL VOCABULARY & SIMPLICITY RULE:
1. Use functional, everyday spoken German with high-frequency A2–B1 core vocabulary only.
2. Keep each sentence short, clear, and natural (about 6–12 words, straightforward structure).
3. The ONLY challenge must be the preposition and its grammar/case — never difficult vocabulary.
4. STRICTLY AVOID B2/C1, academic, formal, bureaucratic, technical, or literary words, rare compound nouns, and needlessly complex nested clauses.

CRITICAL FILL-IN-THE-BLANK RULE:
1. In each sentence, conjugate and naturally use its target verb in the main clause.
2. Replace ONLY its target preposition with three underscores '___'.
3. Each blank '___' must be followed by a noun, pronoun, or clause in the required case.
4. Each sentence MUST unambiguously require its target preposition based strictly on the verb collocation.
5. All ${count} sentences MUST have different everyday situations and subjects.

CRITICAL FORMULA IN EXPLANATION:
In each explanation field, explain clearly in plain English why the verb requires its preposition and case, what it means, and its da-/wo- form. State the formula simply in clean plain text. DO NOT use LaTeX formatting, dollar signs ($$), or \\textbf.

${recentAvoidBlock}
Requirements:
1. Use simple, natural everyday situations (home, work, friends, shopping, appointments, transport, food, weather, free time).
2. Vary everyday subjects naturally ('ich', 'wir', 'du', 'mein Freund', 'meine Kollegin', formal 'Sie', etc.).
Seed: ${randomSeed}`;

      systemInstruction = `You are an expert German language teacher generating ${count} preposition fill-in-the-blank questions for B1 students.
Use simple, functional everyday German vocabulary and short, natural sentences so the student can focus purely on preposition grammar.
You must return a raw JSON object matching this schema exactly:
{
  "questions": [
${schemaItems}
  ]
}
Do not wrap the JSON output in markdown code blocks. Output raw JSON.`;

    } else {
      if (!isBackground) setCurrentVerbTarget(null);
      let activeDeck = { ...deckRemainingRef.current };
      const currentWeights = prepWeightsRef.current;

      const drawOnePrep = () => {
        let eligible = selectedPreps.filter(p => (activeDeck[p] || 0) > 0);
        if (eligible.length === 0) {
          selectedPreps.forEach(p => {
            activeDeck[p] = Math.max(1, currentWeights[p] || 1);
          });
          eligible = selectedPreps.filter(p => (activeDeck[p] || 0) > 0);
        }
        if (eligible.length === 0) eligible = selectedPreps;

        let totalWeight = 0;
        eligible.forEach(p => {
          totalWeight += Math.max(1, activeDeck[p] || 1);
        });
        let rand = Math.random() * totalWeight;
        let chosen = eligible[0];
        for (const p of eligible) {
          const w = Math.max(1, activeDeck[p] || 1);
          if (rand < w) {
            chosen = p;
            break;
          }
          rand -= w;
        }
        activeDeck[chosen] = Math.max(0, (activeDeck[chosen] || 1) - 1);
        return chosen;
      };

      for (let i = 0; i < count; i++) {
        targetPreps.push(drawOnePrep());
      }
      deckRemainingRef.current = activeDeck;
      setDeckRemaining(activeDeck);
      localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(activeDeck));

      const topicSpecificList = Array.from(new Set(
        targetPreps.flatMap(p => topicHistoryRef.current[`prep_${p}`] || [])
      )).slice(0, 10);
      const otherRecentList = recentHistoryRef.current
        .filter(s => !topicSpecificList.some(ts => s === ts || s.startsWith(ts) || ts.startsWith(s)))
        .slice(0, Math.max(0, 10 - topicSpecificList.length));

      const recentAvoidBlock = (topicSpecificList.length > 0 || otherRecentList.length > 0)
        ? `\nCRITICAL ANTI-REPETITION CONSTRAINT FOR THESE PREPOSITIONS:
${topicSpecificList.length > 0 ? `PREVIOUS QUESTIONS ON THESE PREPOSITIONS:
${topicSpecificList.map((s, idx) => `  ${idx + 1}. "${s}"`).join('\n')}` : ''}
${otherRecentList.length > 0 ? `\nOTHER RECENTLY GENERATED QUESTIONS (DO NOT REUSE THE SAME CONTEXT OR SUBJECTS):
${otherRecentList.map((s, idx) => `  • "${s}"`).join('\n')}` : ''}
STRICT REQUIREMENT: Use different everyday situations and subjects than the ones listed above, while keeping the vocabulary simple and natural.\n`
        : '';

      let modeConstraint = '';
      if (questionMode === 'situational') {
        modeConstraint = `CRITICAL FOCUS: SIMPLER SITUATIONAL PREPOSITIONS (NOT VERB-DEPENDENT).
All ${count} sentences MUST use their target preposition purely for situational context:
- Spatial / Location & Direction (Wo? / Wohin? e.g. location of an object or destination of movement in a room, city, street, or building)
- Temporal (Wann? / Wie lange? e.g. times of day, before/after an appointment, days, months, seasons, duration)
- Modal / Means / Cause / Circumstance (Wie? / Womit? / Warum? e.g. travel with a vehicle, food with/without ingredients, weather/circumstances)
STRICT REQUIREMENT: DO NOT use fixed verb-preposition idioms ("Verben mit festen Präpositionen" like 'warten auf', 'denken an', 'sich freuen über', 'hoffen auf', 'abhängen von', 'teilnehmen an', 'gehören zu', etc.). The verb itself must be a normal action (e.g. schlafen, arbeiten, essen, gehen, fahren, ankommen, wohnen, stellen, liegen) that does NOT require this preposition. The preposition must be freely used to express place, time, manner, or reason.`;
      } else {
        modeConstraint = `SENTENCE FOCUS: BALANCED MIX.
You may generate either simple situational prepositions (Lokal: Wo/Wohin, Temporal: Wann, or Modal/Kausal) OR fixed verb collocations (Verb mit Präposition). Vary the sentence structures naturally.`;
      }

      const prepTargetLines = targetPreps
        .map((p, idx) => `- Question ${idx + 1} MUST specifically and unambiguously test the preposition: "${p}".`)
        .join('\n');

      const schemaItems = targetPreps.map((p, i) => `    {
      "sentence": "German sentence ${i + 1} with a single '___' blank representing '${p}'.",
      "correctPreposition": "${p}",
      "translation": "English translation of sentence ${i + 1}.",
      "category": "Lokal | Temporal | Modal | Kausal | Feste Verbverbindung",
      "targetVerb": "Verb used if fixed collocation, or null",
      "formula": "Plain-text formula if fixed collocation (e.g. 'warten auf + Akkusativ'), or null",
      "explanation": "A concise grammatical explanation in English detailing why '${p}' is correct, which case it governs in this context (Akkusativ, Dativ, Genitiv), and clarifying whether it is a situational usage or a fixed verb-preposition combination."
    }`).join(',\n');

      promptText = `Generate ${count} distinct B1-level German sentences.
CRITICAL TARGET PREPOSITIONS:
${prepTargetLines}
Replace the target preposition in each sentence with three underscores '___' for a blank challenge.
For each sentence, the only natural and grammatically correct solution for the blank must be its target preposition.
All ${count} sentences MUST have different everyday situations and subjects.

CRITICAL VOCABULARY & SIMPLICITY RULE:
1. Use functional, everyday spoken German with high-frequency A2–B1 core vocabulary only.
2. Keep each sentence short, clear, and natural (about 6–12 words, straightforward structure).
3. The ONLY challenge must be the preposition and its grammar/case — never difficult vocabulary.
4. STRICTLY AVOID B2/C1, academic, formal, bureaucratic, technical, or literary words, rare compound nouns, and needlessly complex nested clauses.

${modeConstraint}
${recentAvoidBlock}
Requirements:
1. Use clear, practical everyday sentences (home, friends, work, transport, appointments, shopping, weather, food, free time).
2. Vary everyday subjects naturally ('ich', 'wir', 'du', 'mein Freund', 'meine Kollegin', formal 'Sie', etc.).
3. Do NOT excessively use reflexive verbs.

Seed: ${randomSeed}`;

      systemInstruction = `You are an expert German language teacher generating ${count} preposition fill-in-the-blank questions for B1 students.
Use simple, functional everyday German vocabulary and short, natural sentences so the student can focus purely on preposition grammar.
You must return a raw JSON object matching this schema exactly:
{
  "questions": [
${schemaItems}
  ]
}
Do not wrap the JSON output in markdown code blocks. Output raw JSON.`;
    }

    const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
      apiKey,
      preferredModel: selectedModel,
      availableModels,
      prompt: promptText,
      systemInstruction,
      jsonMode: true,
      onFallback: ({ failedModel, nextModel }) => {
        if (!isBackground) {
          setFallbackNotice(`Modell ${failedModel} war überlastet. Versuche automatisch ${nextModel}...`);
        }
      }
    });

    if (!isBackground) {
      if (wasFallback) {
        setFallbackNotice(`⚡ Sätze über Backup-Modell (${usedModel}) generiert, da ${selectedModel} ausgelastet war.`);
        setTimeout(() => setFallbackNotice(''), 7000);
      } else {
        setFallbackNotice('');
      }
    }

    const parsed = parsedJson || JSON.parse(rawJson);
    const rawList = Array.isArray(parsed?.questions)
      ? parsed.questions
      : (parsed?.sentence && parsed?.correctPreposition ? [parsed] : []);

    const validList = rawList.filter(q => q?.sentence && q?.correctPreposition);
    if (validList.length === 0) {
      throw new Error('Invalid question format returned.');
    }

    const enrichedQuestions = validList.map((q, idx) => {
      const pv = pickedVerbs[idx] || null;
      const pvCase = pv ? ((pv.case || '').toLowerCase().startsWith('akk') ? 'Akkusativ' : 'Dativ') : null;
      const pvFormula = pv ? `${pv.verb} + ${pv.prep} + ${pvCase}` : null;
      return {
        ...q,
        targetVerb: q.targetVerb || (pv ? pv.verb : null),
        formula: q.formula || pvFormula,
        case: q.case || pvCase,
        meaning: q.meaning || (pv ? pv.meaning : null),
        daWo: q.daWo || (pv ? pv.daWo : null)
      };
    });

    // Save all generated sentences to recent history
    let nextTopicHistory = { ...topicHistoryRef.current };
    let nextRecentHistory = [...recentHistoryRef.current];

    enrichedQuestions.forEach((q, idx) => {
      const fullSentence = q.sentence.replace('___', q.correctPreposition);
      const pv = pickedVerbs[idx] || null;
      const prepTopicKey = `prep_${q.correctPreposition || targetPreps[idx]}`;
      const verbTopicKey = pv ? `verb_${pv.verb}` : null;
      const keysToUpdate = [prepTopicKey];
      if (verbTopicKey) keysToUpdate.push(verbTopicKey);

      keysToUpdate.forEach(k => {
        const prevList = nextTopicHistory[k] || [];
        nextTopicHistory[k] = [
          fullSentence,
          ...prevList.filter(s => s !== fullSentence)
        ].slice(0, 10);
      });

      nextRecentHistory = [
        fullSentence,
        ...nextRecentHistory.filter(s => s !== fullSentence)
      ].slice(0, 10);
    });

    topicHistoryRef.current = nextTopicHistory;
    setTopicHistory(nextTopicHistory);
    localStorage.setItem('b1_grammar_topic_history', JSON.stringify(nextTopicHistory));
    recentHistoryRef.current = nextRecentHistory;
    setRecentHistory(nextRecentHistory);
    localStorage.setItem('b1_grammar_history', JSON.stringify(nextRecentHistory));

    return enrichedQuestions;
  };

  const prefetchMoreInBackground = async (count = 2) => {
    if (isPrefetchingRef.current || !apiKey) return;
    if (questionMode !== 'verbs' && selectedPreps.length === 0) return;
    if (questionQueueRef.current.length >= 6) return;

    const reqSig = queueSignatureRef.current;
    isPrefetchingRef.current = true;
    setIsPrefetching(true);
    try {
      const batch = await fetchQuestionBatch(count, null, true);
      if (queueSignatureRef.current === reqSig && batch.length > 0) {
        saveQuestionQueue([...questionQueueRef.current, ...batch], reqSig);
      }
    } catch (err) {
      console.warn('Background prefetch error:', err);
    } finally {
      isPrefetchingRef.current = false;
      setIsPrefetching(false);
    }
  };

  const generateQuestion = async (targetVerbInput = null) => {
    const overrideTargetVerb = (targetVerbInput && typeof targetVerbInput === 'object' && targetVerbInput.verb)
      ? targetVerbInput
      : null;

    if (questionMode !== 'verbs' && !overrideTargetVerb && selectedPreps.length === 0) {
      alert("Bitte wähle mindestens eine Präposition aus!");
      return;
    }

    // Specific verb override: always fetch 2 fresh sentences for that verb
    if (overrideTargetVerb) {
      setIsLoading(true);
      setErrorMsg('');
      setHasChecked(false);
      setCheckResults([]);
      setUserInputs([]);
      setCurrentQuestions([]);
      try {
        const batch = await fetchQuestionBatch(2, overrideTargetVerb, false);
        setCurrentQuestions(batch);
        setUserInputs(batch.map(() => ''));
      } catch (err) {
        console.error(err);
        setErrorMsg(`Fehler bei der Verbindung mit Gemini: ${err.message}. Bitte API-Key oder Netzwerk prüfen.`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Instant 0ms swap from localStorage backlog when >= 2 questions are buffered
    if (questionQueueRef.current.length >= 2) {
      const nextBatch = questionQueueRef.current.slice(0, 2);
      const rest = questionQueueRef.current.slice(2);
      saveQuestionQueue(rest);
      setErrorMsg('');
      setHasChecked(false);
      setCheckResults([]);
      setCurrentQuestions(nextBatch);
      setUserInputs(nextBatch.map(() => ''));
      setIsLoading(false);

      if (rest.length < 6) {
        prefetchMoreInBackground(2);
      }
      return;
    }

    // Cold start (or < 2 buffered): generate 8 sentences at once (show 2, buffer 6)
    const reqSig = queueSignatureRef.current;
    setIsLoading(true);
    setErrorMsg('');
    setHasChecked(false);
    setCheckResults([]);
    setUserInputs([]);
    setCurrentQuestions([]);

    try {
      const batch = await fetchQuestionBatch(8, null, false);
      const combined = [...questionQueueRef.current, ...batch];
      const nextBatch = combined.slice(0, 2);
      const rest = combined.slice(2);
      if (queueSignatureRef.current === reqSig) {
        saveQuestionQueue(rest, reqSig);
      }
      setCurrentQuestions(nextBatch);
      setUserInputs(nextBatch.map(() => ''));
    } catch (err) {
      console.error(err);
      setErrorMsg(`Fehler bei der Verbindung mit Gemini: ${err.message}. Bitte API-Key oder Netzwerk prüfen.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheck = (e) => {
    if (e) e.preventDefault();
    if (currentQuestions.length === 0 || hasChecked) return;

    const results = currentQuestions.map((q, idx) => {
      const normalizedUser = (userInputs[idx] || '').trim().toLowerCase();
      const normalizedCorrect = q.correctPreposition.trim().toLowerCase();
      return normalizedUser === normalizedCorrect;
    });
    setCheckResults(results);
    setHasChecked(true);

    // Trigger background prefetch immediately on submit so the next 2 are ready
    if (questionQueueRef.current.length < 6) {
      prefetchMoreInBackground(2);
    }

    // Speak the first completed German sentence
    const firstFullSentence = currentQuestions[0].sentence.replace('___', currentQuestions[0].correctPreposition);
    speakGermanText(firstFullSentence);
  };

  if (showKeyInput) {
    return (
      <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '550px', padding: '20px' }}>
        <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center', width: '100%' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔑</div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '12px', color: '#fff' }}>Gemini API-Schlüssel</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.5' }}>
            Der Grammatik-Trainer benötigt einen Gemini API-Schlüssel.<br/>
            Dein Schlüssel wird <strong>nur lokal im Browser gespeichert</strong> und nicht geteilt.
          </p>
          
          <form onSubmit={handleSaveKey} style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
            <input
              type="password"
              className="search-input"
              style={{ textAlign: 'center', padding: '14px', borderRadius: '10px', fontSize: '15px' }}
              placeholder="Füge deinen Gemini API-Key hier ein..."
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              required
            />
            <button type="submit" className="feedback-btn good" style={{ padding: '12px', borderRadius: '10px' }}>
              Schlüssel Speichern 💾
            </button>
          </form>

          <div style={{ marginTop: '20px', fontSize: '13px' }}>
            <a 
              href="https://aistudio.google.com/" 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ color: 'var(--color-verb)', textDecoration: 'underline', fontWeight: '600' }}
            >
              Kostenlosen API-Key bei Google AI Studio erstellen ➔
            </a>
          </div>
        </div>
      </div>
    );
  }

  const totalWeightsForSelected = selectedPreps.reduce((acc, p) => acc + (prepWeights[p] || 0), 0);
  const totalRemainingForSelected = selectedPreps.reduce((acc, p) => acc + (deckRemaining[p] || 0), 0);
  const allTotalWeights = ALL_PREPOSITIONS.reduce((acc, p) => acc + (prepWeights[p] || 0), 0);
  const allTotalRemaining = ALL_PREPOSITIONS.reduce((acc, p) => acc + (deckRemaining[p] || 0), 0);

  return (
    <div className="grammar-container animate-fade-in">
      
      {/* Settings bar */}
      <div className="grammar-top-bar">
        <div className="grammar-top-left">
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#fff', whiteSpace: 'nowrap' }}>
            📝 Prepositions
          </div>
          <button
            type="button"
            onClick={handleOpenWeightsModal}
            style={{
              padding: '5px 10px',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: '600',
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: '#60a5fa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap'
            }}
            title="Präpositionen-Gewichtung manuell bearbeiten"
          >
            <span>⚖️ Weights</span>
            <span style={{ fontSize: '10.5px', opacity: 0.85 }}>({totalRemainingForSelected}/{totalWeightsForSelected})</span>
          </button>

          {/* Question Mode: Situational (Non-verb) vs Verbs vs Mixed */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Typ:</span>
            <select
              value={questionMode}
              onChange={(e) => {
                setQuestionMode(e.target.value);
                localStorage.setItem('b1_grammar_question_mode', e.target.value);
              }}
              style={{
                fontSize: '11.5px',
                padding: '3px 8px',
                height: '28px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-color)',
                color: '#fff',
                borderRadius: '8px',
                cursor: 'pointer',
                maxWidth: '180px'
              }}
              title="Wähle den Fragestil: Einfach/Situativ, Feste Verben oder Gemischt"
            >
              <option value="situational" style={{ background: '#090a0f', color: '#fff' }}>
                📍 Situativ (Lokal/Temporal)
              </option>
              <option value="verbs" style={{ background: '#090a0f', color: '#fff' }}>
                🔗 Feste Verben (warten auf...)
              </option>
              <option value="all" style={{ background: '#090a0f', color: '#fff' }}>
                🎲 Gemischt (Alle)
              </option>
            </select>
          </div>

          {/* Button: Show Verb List */}
          <button
            type="button"
            onClick={() => setShowVerbListModal(true)}
            style={{
              padding: '5px 10px',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: '700',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(168, 85, 247, 0.22))',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              color: '#d8b4fe',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap'
            }}
            title="65 B1 Verben mit festen Präpositionen nach Präpositionen gruppiert ansehen"
          >
            <span>📋 65 Verben</span>
            <span style={{ fontSize: '10.5px', opacity: 0.9, background: 'rgba(0,0,0,0.35)', padding: '1px 5px', borderRadius: '8px' }}>
              {68 - festVerbsRemaining.length}/68
            </span>
          </button>

          {/* If in verbs mode, show cycle badge and reset button */}
          {questionMode === 'verbs' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(139, 92, 246, 0.14)',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              borderRadius: '8px',
              padding: '3px 8px',
              fontSize: '11px',
              whiteSpace: 'nowrap'
            }}>
              <span style={{ color: '#c4b5fd', fontWeight: '700' }}>Cycle #{festVerbsIteration}:</span>
              <span style={{ color: '#fff', fontWeight: '600' }}>{68 - festVerbsRemaining.length}/68</span>
              <button
                type="button"
                onClick={handleResetVerbIteration}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#93c5fd',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '0 2px',
                  textDecoration: 'underline'
                }}
                title="Zyklus zurücksetzen (alle 68 wieder freischalten)"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        <div className="grammar-top-right">
          <select
            value={selectedModel}
            onChange={(e) => {
              setSelectedModel(e.target.value);
              localStorage.setItem('b1_gemini_selected_model', e.target.value);
            }}
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              height: '28px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              color: '#fff',
              borderRadius: '8px',
              cursor: 'pointer',
              maxWidth: '140px'
            }}
            title="Wähle das Gemini-Modell"
          >
            {availableModels.map(model => (
              <option key={model} value={model} style={{ background: '#090a0f', color: '#fff' }}>
                {model}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleRemoveKey}
            className="sound-btn"
            title="API-Schlüssel verwalten"
            style={{ fontSize: '11.5px', padding: '4px 10px', height: '28px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', borderRadius: '8px' }}
          >
            ⚙️ Key
          </button>
        </div>
      </div>

      {/* Floating Modal Overlay for Editing Weights */}
      {showDeckModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(5, 7, 15, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeckModal(false);
          }}
        >
          <div
            className="glass-card animate-fade-in"
            style={{
              width: '100%',
              maxWidth: '740px',
              maxHeight: '92vh',
              overflowY: 'auto',
              background: 'rgba(16, 20, 36, 0.98)',
              border: '1px solid rgba(59, 130, 246, 0.45)',
              borderRadius: '16px',
              boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
              padding: '18px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            {/* Dialog Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚖️ Edit Preposition Weights</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                  Lege für jede Präposition ein manuelles Gewicht fest. Du kannst <strong>beliebige Zahlen</strong> eingeben (sie müssen sich nicht zu einer bestimmten Summe addieren).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeckModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* Quick controls: Set All + Presets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>Alle setzen auf:</span>
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={setAllVal}
                  onChange={(e) => setSetAllVal(e.target.value)}
                  style={{
                    width: '60px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'rgba(0,0,0,0.4)',
                    color: '#fff',
                    fontSize: '12px',
                    textAlign: 'center'
                  }}
                />
                <button
                  type="button"
                  onClick={handleApplySetAll}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: 'rgba(59, 130, 246, 0.25)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#93c5fd',
                    fontSize: '11.5px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Auf alle anwenden
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Vorlagen:</span>
                {[
                  { id: 'core_13', label: '⭐ Core 13 (26)', highlight: true },
                  { id: 'balanced_2', label: 'Ausgeglichen (je 2)' },
                  { id: 'balanced_1', label: 'Kompakt (je 1)' },
                  { id: 'genitiv_focus', label: 'Genitiv-Fokus' },
                  { id: 'dativ_focus', label: 'Dativ-Fokus' },
                  { id: 'wechsel_focus', label: 'Wechselpräp.-Fokus' },
                  { id: 'akkusativ_focus', label: 'Akkusativ-Fokus' }
                ].map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePresetInDialog(p.id)}
                    style={{
                      background: p.highlight ? 'rgba(245, 158, 11, 0.16)' : 'rgba(255, 255, 255, 0.05)',
                      border: p.highlight ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      fontWeight: p.highlight ? '700' : '400',
                      color: p.highlight ? '#fcd34d' : '#e2e8f0',
                      cursor: 'pointer'
                    }}
                    title={p.highlight ? 'Reassigns weights (13 core prepositions × 2, others 0) and restarts the deck cycle' : undefined}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid of groups with manual number input */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', maxHeight: '360px', overflowY: 'auto', paddingRight: '4px' }}>
              {Object.keys(PREPOSITION_GROUPS).map(groupName => {
                const preps = PREPOSITION_GROUPS[groupName];
                let groupColor = 'var(--color-conn)';
                if (groupName === 'Akkusativ') groupColor = 'var(--color-noun)';
                if (groupName === 'Dativ') groupColor = 'var(--color-verb)';
                if (groupName === 'Wechsel') groupColor = 'var(--color-adj)';
                if (groupName === 'Genitiv') groupColor = 'var(--color-reflexive)';

                return (
                  <div key={groupName} style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '10px',
                    padding: '10px'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: groupColor, marginBottom: '8px' }}>
                      {groupName} ({preps.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {preps.map(prep => {
                        const val = tempWeights[prep] ?? 0;
                        return (
                          <div key={prep} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            background: val === 0 ? 'rgba(239, 68, 68, 0.06)' : 'rgba(255,255,255,0.02)'
                          }}>
                            <span style={{ fontSize: '12.5px', fontWeight: '600', color: val === 0 ? 'var(--text-muted)' : '#fff' }}>
                              {prep}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <button
                                type="button"
                                onClick={() => handleTempWeightDelta(prep, -1)}
                                style={{
                                  width: '20px',
                                  height: '22px',
                                  borderRadius: '4px 0 0 4px',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  background: 'rgba(255,255,255,0.06)',
                                  color: '#fff',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="0"
                                max="999"
                                value={val}
                                onChange={(e) => handleTempWeightChange(prep, e.target.value)}
                                style={{
                                  width: '42px',
                                  height: '22px',
                                  padding: '0 2px',
                                  textAlign: 'center',
                                  borderRadius: 0,
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  borderLeft: 'none',
                                  borderRight: 'none',
                                  background: 'rgba(0,0,0,0.5)',
                                  color: '#fff',
                                  fontSize: '12px',
                                  fontWeight: '700'
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => handleTempWeightDelta(prep, 1)}
                                style={{
                                  width: '20px',
                                  height: '22px',
                                  borderRadius: '0 4px 4px 0',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  background: 'rgba(255,255,255,0.06)',
                                  color: '#fff',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dialog Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Gesamte Deck-Summe: <strong style={{ color: '#fff' }}>{Object.values(tempWeights).reduce((a, b) => a + (b || 0), 0)}</strong>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowDeckModal(false)}
                  className="nav-button"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveWeightsModal(true)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: 'rgba(59, 130, 246, 0.25)',
                    border: '1px solid rgba(59, 130, 246, 0.5)',
                    color: '#93c5fd',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  🔄 Speichern & Deck auffüllen
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveWeightsModal(false)}
                  className="feedback-btn good"
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    width: 'auto',
                    maxWidth: 'none',
                    minHeight: 'auto'
                  }}
                >
                  💾 Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {fallbackNotice && (
        <div style={{
          width: '100%',
          padding: '8px 12px',
          background: 'rgba(234, 179, 8, 0.15)',
          border: '1px solid rgba(234, 179, 8, 0.35)',
          borderRadius: '10px',
          color: '#facc15',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '10px'
        }}>
          <span>🔄</span>
          <span>{fallbackNotice}</span>
        </div>
      )}

      {/* Floating Modal Overlay for 65 High-Frequency Fixed Verbs List */}
      {showVerbListModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(5, 7, 15, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowVerbListModal(false);
          }}
        >
          <div
            className="glass-card animate-fade-in"
            style={{
              width: '100%',
              maxWidth: '880px',
              maxHeight: '92vh',
              overflowY: 'auto',
              background: 'rgba(15, 19, 36, 0.98)',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              borderRadius: '16px',
              boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📋 65 High-Frequency B1 Verbs</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                  Prioritized B1 Verben mit festen Präpositionen, Kasus (Akkusativ/Dativ) und Pronominaladverbien (<em>da(r)-</em> / <em>wo(r)-</em>).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowVerbListModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* Cycle / Iteration Tracker Bar */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.12))',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', maxWidth: '320px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: '700', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span>🔄 Cycle #{festVerbsIteration}:</span>
                  <span style={{ color: '#d8b4fe' }}>{68 - festVerbsRemaining.length}/68</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({festVerbsRemaining.length} left)</span>
                </div>
                {/* Progress bar */}
                <div style={{ width: '100%', maxWidth: '240px', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.round(((68 - festVerbsRemaining.length) / 68) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #818cf8, #c084fc)',
                    borderRadius: '3px',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleResetVerbIteration}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#e2e8f0',
                    fontSize: '11.5px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                  title="Iteration zurücksetzen (alle 68 wieder als unbenutzt markieren)"
                >
                  🔄 Zyklus Zurücksetzen
                </button>
              </div>
            </div>

            {/* Filters Bar: Search + Group selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="🔍 Suchen (z.B. warten, auf, freuen, Zug, holiday, Beispielsatz)..."
                  value={verbSearchQuery}
                  onChange={(e) => setVerbSearchQuery(e.target.value)}
                  style={{
                    flex: '1 1 auto',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#fff',
                    fontSize: '13px'
                  }}
                />
                {verbSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setVerbSearchQuery('')}
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: 'var(--text-secondary)',
                      borderRadius: '6px',
                      padding: '6px 10px',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Quick Group Tabs */}
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                <button
                  type="button"
                  onClick={() => setVerbGroupFilter('all')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: '600',
                    background: verbGroupFilter === 'all' ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255,255,255,0.04)',
                    border: '1px solid',
                    borderColor: verbGroupFilter === 'all' ? 'rgba(168, 85, 247, 0.6)' : 'rgba(255,255,255,0.08)',
                    color: verbGroupFilter === 'all' ? '#d8b4fe' : 'var(--text-muted)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Alle (68)
                </button>
                {FIXED_VERBS_GROUPS.map(g => {
                  const isActive = verbGroupFilter === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setVerbGroupFilter(g.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600',
                        background: isActive ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255,255,255,0.04)',
                        border: '1px solid',
                        borderColor: isActive ? 'rgba(168, 85, 247, 0.6)' : 'rgba(255,255,255,0.08)',
                        color: isActive ? '#d8b4fe' : 'var(--text-muted)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {g.title.split(' ')[0]} ({g.verbs.length})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Verb Groups & Tables */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '560px', overflowY: 'auto', paddingRight: '4px' }}>
              {FIXED_VERBS_GROUPS
                .filter(group => verbGroupFilter === 'all' || verbGroupFilter === group.id)
                .map((group, groupIdx) => {
                  const query = verbSearchQuery.trim().toLowerCase();
                  const matchingVerbs = group.verbs.filter(v => {
                    if (!query) return true;
                    return (
                      v.verb.toLowerCase().includes(query) ||
                      v.prep.toLowerCase().includes(query) ||
                      v.meaning.toLowerCase().includes(query) ||
                      (v.example && v.example.toLowerCase().includes(query)) ||
                      (v.exampleEn && v.exampleEn.toLowerCase().includes(query)) ||
                      group.title.toLowerCase().includes(query) ||
                      group.concept.toLowerCase().includes(query)
                    );
                  });

                  if (matchingVerbs.length === 0) return null;

                  return (
                    <div
                      key={group.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      {/* Group Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
                        <div>
                          <span style={{ fontSize: '14px', fontWeight: '800', color: '#fff' }}>
                            {groupIdx + 1}. {group.title}
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                            ({group.concept})
                          </span>
                        </div>
                        <span style={{ fontSize: '11px', color: '#c084fc', background: 'rgba(168, 85, 247, 0.15)', padding: '2px 8px', borderRadius: '6px' }}>
                          {matchingVerbs.length} Verben
                        </span>
                      </div>

                      {/* Desktop Table View */}
                      <div className="grammar-verb-table-desktop">
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)', fontSize: '11px' }}>
                              <th style={{ padding: '6px 8px', width: '32px' }}>#</th>
                              <th style={{ padding: '6px 8px', minWidth: '130px' }}>Verb</th>
                              <th style={{ padding: '6px 8px', width: '55px' }}>Kasus</th>
                              <th style={{ padding: '6px 8px', minWidth: '140px' }}>Bedeutung</th>
                              <th style={{ padding: '6px 8px' }}>Beispielsatz</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right', width: '70px' }}>Aktion</th>
                            </tr>
                          </thead>
                          <tbody>
                            {matchingVerbs.map(v => {
                              return (
                                <tr
                                  key={v.id}
                                  style={{
                                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    verticalAlign: 'middle'
                                  }}
                                >
                                  <td style={{ padding: '10px 8px', color: 'var(--text-muted)', fontSize: '11px' }}>{v.id}</td>
                                  <td style={{ padding: '10px 8px', fontWeight: '700', color: '#fff' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span>{v.verb}</span>
                                      <button
                                        type="button"
                                        onClick={() => speakGermanText(v.verb)}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          color: 'var(--text-muted)',
                                          cursor: 'pointer',
                                          fontSize: '12px',
                                          padding: 0
                                        }}
                                        title="Verb anhören"
                                      >
                                        🔊
                                      </button>
                                    </div>
                                  </td>
                                  <td style={{ padding: '10px 8px' }}>
                                    <span style={{
                                      fontSize: '10.5px',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      fontWeight: '700',
                                      background: v.case === 'Akk' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                      color: v.case === 'Akk' ? '#fca5a5' : '#93c5fd',
                                      border: v.case === 'Akk' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)'
                                    }}>
                                      {v.case}
                                    </span>
                                  </td>
                                  <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>{v.meaning}</td>
                                  <td style={{ padding: '10px 8px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ color: '#e2e8f0', fontWeight: '500', lineHeight: 1.4 }}>
                                          {v.example}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => speakGermanText(v.example)}
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--text-muted)',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            padding: 0,
                                            flexShrink: 0
                                          }}
                                          title="Beispielsatz anhören"
                                        >
                                          🔊
                                        </button>
                                      </div>
                                      {v.exampleEn && (
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                          🇬🇧 {v.exampleEn}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                    <button
                                      type="button"
                                      onClick={() => handlePracticeSpecificVerb(v)}
                                      style={{
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        background: 'rgba(59, 130, 246, 0.2)',
                                        border: '1px solid rgba(59, 130, 246, 0.45)',
                                        color: '#93c5fd',
                                        fontSize: '11px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap'
                                      }}
                                      title={`Diesen Satz mit "${v.verb} ${v.prep}" jetzt generieren`}
                                    >
                                      🎯 Üben
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Cards View (Clean readable cards for phone screens) */}
                      <div className="grammar-verb-cards-mobile">
                        {matchingVerbs.map(v => (
                          <div
                            key={`m-${v.id}`}
                            style={{
                              background: 'rgba(255, 255, 255, 0.03)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              borderRadius: '10px',
                              padding: '12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>#{v.id}</span>
                                <strong style={{ fontSize: '14.5px', color: '#fff' }}>{v.verb}</strong>
                                <button
                                  type="button"
                                  onClick={() => speakGermanText(v.verb)}
                                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                                  title="Verb anhören"
                                >
                                  🔊
                                </button>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{
                                  fontSize: '10.5px',
                                  padding: '2px 7px',
                                  borderRadius: '5px',
                                  fontWeight: '700',
                                  background: v.case === 'Akk' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                  color: v.case === 'Akk' ? '#fca5a5' : '#93c5fd',
                                  border: v.case === 'Akk' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(59, 130, 246, 0.3)'
                                }}>
                                  {v.case}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handlePracticeSpecificVerb(v)}
                                  style={{
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    background: 'rgba(59, 130, 246, 0.2)',
                                    border: '1px solid rgba(59, 130, 246, 0.45)',
                                    color: '#93c5fd',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                  }}
                                >
                                  🎯 Üben
                                </button>
                              </div>
                            </div>

                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                              🇬🇧 {v.meaning}
                            </div>

                            {v.example && (
                              <div style={{
                                fontSize: '12px',
                                color: '#e2e8f0',
                                background: 'rgba(0, 0, 0, 0.25)',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                borderLeft: '2px solid var(--color-conn)'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                  <span style={{ lineHeight: 1.4 }}>{v.example}</span>
                                  <button
                                    type="button"
                                    onClick={() => speakGermanText(v.example)}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', padding: 0, flexShrink: 0 }}
                                  >
                                    🔊
                                  </button>
                                </div>
                                {v.exampleEn && (
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '3px' }}>
                                    🇬🇧 {v.exampleEn}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
              <button
                type="button"
                onClick={() => setShowVerbListModal(false)}
                className="feedback-btn good"
                style={{ width: 'auto', maxWidth: 'none', padding: '8px 20px', borderRadius: '8px', fontSize: '12px' }}
              >
                Schließen ✔️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main interface layout: Responsive layout for Desktop & Mobile */}
      <div className="grammar-main-layout">
        
        {/* Mobile Filter Accordion Toggle (Visible only on phone <= 768px) */}
        <button
          type="button"
          className="grammar-mobile-filter-toggle"
          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
          aria-expanded={mobileFiltersOpen}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚙️</span>
            <span>Präpositionen Filter ({selectedPreps.length}/{ALL_PREPOSITIONS.length} aktiv)</span>
          </span>
          <span style={{ fontSize: '13px', transform: mobileFiltersOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
            ▼
          </span>
        </button>

        {/* Prepositions filter list (Desktop: Left sidebar; Mobile: Collapsible card) */}
        <div className={`glass-card grammar-sidebar ${!mobileFiltersOpen ? 'mobile-collapsed' : ''}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
            <div>
              <span style={{ fontSize: '13.5px', fontWeight: '700', color: '#fff' }}>Präpositionen</span>
              <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                {totalRemainingForSelected} im Deck aktiv
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <span onClick={selectAllPreps} style={{ fontSize: '11px', color: 'var(--color-verb)', cursor: 'pointer', fontWeight: '600' }}>All</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>|</span>
              <span onClick={selectNonePreps} style={{ fontSize: '11px', color: '#ef4444', cursor: 'pointer', fontWeight: '600' }}>None</span>
            </div>
          </div>

          {/* Quick link to 65 Fixed Verbs */}
          <button
            type="button"
            onClick={() => setShowVerbListModal(true)}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: '700',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(168, 85, 247, 0.18))',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              color: '#d8b4fe',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px'
            }}
          >
            <span>📋 65 Verben-Liste</span>
            <span style={{ fontSize: '10px', background: 'rgba(0,0,0,0.35)', padding: '1px 5px', borderRadius: '8px' }}>
              {68 - festVerbsRemaining.length}/68
            </span>
          </button>

          {/* Choosable Core 13 Template */}
          {(() => {
            const isCore13Active =
              selectedPreps.length === CORE_13_PREPS.length &&
              CORE_13_PREPS.every(p => selectedPreps.includes(p)) &&
              ALL_PREPOSITIONS.every(p => (prepWeights[p] ?? 0) === (CORE_13_WEIGHTS[p] ?? 0));
            return (
              <button
                type="button"
                onClick={handleApplyCore13Template}
                style={{
                  padding: '6px 10px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: '700',
                  background: isCore13Active
                    ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.28), rgba(234, 179, 8, 0.18))'
                    : 'rgba(245, 158, 11, 0.1)',
                  border: isCore13Active
                    ? '1px solid rgba(245, 158, 11, 0.65)'
                    : '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#fcd34d',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px'
                }}
                title="Reassigns weights (13 core prepositions × 2, others 0) and restarts the deck cycle"
              >
                <span>⭐ Core 13 Template</span>
                <span style={{ fontSize: '10px', background: 'rgba(0,0,0,0.35)', padding: '1px 6px', borderRadius: '8px' }}>
                  26
                </span>
              </button>
            );
          })()}

          <div style={{ overflowY: 'auto', maxHeight: '420px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Object.keys(PREPOSITION_GROUPS).map(groupName => {
              const preps = PREPOSITION_GROUPS[groupName];
              const groupSelected = preps.every(p => selectedPreps.includes(p));
              const someSelected = preps.some(p => selectedPreps.includes(p)) && !groupSelected;
              
              let groupColor = 'var(--color-conn)';
              if (groupName === 'Akkusativ') groupColor = 'var(--color-noun)';
              if (groupName === 'Dativ') groupColor = 'var(--color-verb)';
              if (groupName === 'Wechsel') groupColor = 'var(--color-adj)';
              if (groupName === 'Genitiv') groupColor = 'var(--color-reflexive)';

              return (
                <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div 
                    onClick={() => toggleGroup(groupName)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      cursor: 'pointer', 
                      fontSize: '12px', 
                      fontWeight: '700', 
                      color: groupColor
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={groupSelected}
                      ref={el => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={() => {}}
                      style={{ cursor: 'pointer', accentColor: groupColor }}
                    />
                    {groupName} ({preps.length})
                  </div>
                  
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', paddingLeft: '18px' }}>
                    {preps.map(prep => {
                      const active = selectedPreps.includes(prep);
                      return (
                        <button
                          key={prep}
                          type="button"
                          onClick={() => togglePrep(prep)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid',
                            borderColor: active ? groupColor : 'var(--border-color)',
                            background: active ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                            color: active ? '#fff' : 'var(--text-muted)',
                            fontSize: '11.5px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {prep}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Large Question Card */}
        <div className="glass-card grammar-question-card">
          
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', width: '100%', height: '100%', minHeight: '260px' }}>
              <div style={{ fontSize: '32px', animation: 'spin 1.5s linear infinite' }}>🔄</div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center' }} className="animate-pulse">
                Gemini generiert 8 Präpositionalsätze (2 sofort + 6 im Puffer)...
              </div>
            </div>
          )}

          {errorMsg && (
            <div style={{ textAlign: 'center', color: '#ef4444', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', minHeight: '260px' }}>
              <div style={{ fontSize: '36px' }}>⚠️</div>
              <p style={{ fontSize: '14px', maxWidth: '380px', lineHeight: '1.5' }}>{errorMsg}</p>
              <button onClick={() => generateQuestion()} className="feedback-btn good" style={{ maxWidth: '180px', padding: '10px' }}>
                Erneut versuchen 🔄
              </button>
            </div>
          )}

          {currentQuestions.length === 0 && !isLoading && !errorMsg && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', minHeight: '260px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px' }}>📝</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff' }}>Präpositionen Trainieren</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '340px', lineHeight: '1.5' }}>
                  Wähle links die Präpositionen aus, die du üben möchtest, und klicke auf Generieren.
                </p>
              </div>
              <button 
                onClick={() => generateQuestion()} 
                className="feedback-btn good" 
                style={{ padding: '12px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: '700', width: 'auto', maxWidth: 'none' }}
                disabled={selectedPreps.length === 0}
              >
                2 Sätze Generieren ➔
              </button>
            </div>
          )}

          {currentQuestions.length > 0 && !isLoading && (() => {
            const menuPreps = (selectedPreps.length > 0
              ? ALL_PREPOSITIONS.filter(p => selectedPreps.includes(p))
              : ALL_PREPOSITIONS
            ).slice().sort((a, b) => a.localeCompare(b, 'de'));
            const getPrepGroupColor = (prep) => {
              if (PREPOSITION_GROUPS.Akkusativ.includes(prep)) return 'var(--color-noun)';
              if (PREPOSITION_GROUPS.Dativ.includes(prep)) return 'var(--color-verb)';
              if (PREPOSITION_GROUPS.Wechsel.includes(prep)) return 'var(--color-adj)';
              if (PREPOSITION_GROUPS.Genitiv.includes(prep)) return 'var(--color-reflexive)';
              return 'var(--color-conn)';
            };
            const allFilled = currentQuestions.every((_, idx) => (userInputs[idx] || '').trim().length > 0);
            const correctCount = checkResults.filter(Boolean).length;

            return (
              <form onSubmit={handleCheck} style={{ display: 'flex', flexDirection: 'column', gap: '18px', animation: 'fadeIn 0.3s ease', width: '100%' }}>
                {/* Subtle Backlog Status Badge */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '3px 10px',
                    borderRadius: '10px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#6ee7b7'
                  }}>
                    ⚡ {questionQueue.length} im Puffer{isPrefetching ? ' · 🔄 +2...' : ''}
                  </span>
                </div>
                {currentQuestions.map((q, qIdx) => {
                  const val = userInputs[qIdx] || '';
                  const trimmedVal = val.trim().toLowerCase();
                  const isQCorrect = Boolean(checkResults[qIdx]);
                  const parts = q.sentence.split('___');

                  return (
                    <div
                      key={qIdx}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                        padding: '16px',
                        borderRadius: '12px',
                        background: 'rgba(255, 255, 255, 0.025)',
                        border: hasChecked
                          ? (isQCorrect ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)')
                          : '1px solid rgba(255, 255, 255, 0.08)'
                      }}
                    >
                      {/* Sentence header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                          Satz {qIdx + 1} von {currentQuestions.length} • Setze die richtige Präposition ein:
                        </span>
                        {hasChecked && (
                          <button
                            type="button"
                            className="sound-btn"
                            onClick={() => {
                              const full = q.sentence.replace('___', q.correctPreposition);
                              speakGermanText(full);
                            }}
                            style={{ width: '32px', height: '32px', fontSize: '14px', padding: 0, justifyContent: 'center', alignItems: 'center', borderRadius: '8px' }}
                            title="Satz anhören"
                          >
                            🔊
                          </button>
                        )}
                      </div>

                      {/* Responsive grid: Sentence + Input on left, Preposition Quick-Pick Menu on right */}
                      <div className="grammar-question-row-grid">
                        {/* Left: Sentence, Translation, Manual Input */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div className="grammar-sentence-box" style={{ fontSize: '18px', padding: '14px 16px' }}>
                            {hasChecked ? (
                              <span>
                                {parts[0]}
                                <strong style={{ color: isQCorrect ? 'var(--color-noun)' : '#ef4444', borderBottom: isQCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444', padding: '0 4px' }}>
                                  {q.correctPreposition}
                                </strong>
                                {parts.slice(1).join('___')}
                              </span>
                            ) : val.trim() ? (
                              <span>
                                {parts[0]}
                                <strong style={{ color: '#93c5fd', borderBottom: '2px solid #3b82f6', padding: '0 4px' }}>
                                  {val.trim()}
                                </strong>
                                {parts.slice(1).join('___')}
                              </span>
                            ) : (
                              q.sentence
                            )}
                          </div>

                          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center' }}>
                            🇬🇧 "{q.translation}"
                          </div>

                          <input
                            type="text"
                            className="search-input"
                            placeholder="Präposition eintippen oder rechts anklicken..."
                            value={val}
                            onChange={(e) => {
                              const next = [...userInputs];
                              next[qIdx] = e.target.value;
                              setUserInputs(next);
                            }}
                            disabled={hasChecked}
                            style={{
                              textAlign: 'center',
                              fontSize: '16px',
                              padding: '10px 12px',
                              borderRadius: '10px',
                              border: hasChecked
                                ? (isQCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444')
                                : '1px solid var(--border-color)',
                              outline: 'none',
                              width: '100%'
                            }}
                            autoComplete="off"
                          />
                        </div>

                        {/* Right: Quick-Pick Menu of Currently Selected Prepositions */}
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: '10px',
                          background: 'rgba(0, 0, 0, 0.28)',
                          border: '1px solid rgba(255, 255, 255, 0.06)'
                        }}>
                          <div style={{ fontSize: '10.5px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Ausgewählte Präpositionen ({menuPreps.length})
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {menuPreps.map(prep => {
                              const isPicked = trimmedVal === prep.toLowerCase();
                              const gColor = getPrepGroupColor(prep);
                              return (
                                <button
                                  key={prep}
                                  type="button"
                                  disabled={hasChecked}
                                  onClick={() => {
                                    const next = [...userInputs];
                                    next[qIdx] = prep;
                                    setUserInputs(next);
                                  }}
                                  style={{
                                    padding: '5px 9px',
                                    borderRadius: '7px',
                                    border: `1px solid ${isPicked ? gColor : 'rgba(255, 255, 255, 0.14)'}`,
                                    background: isPicked ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                                    color: isPicked ? '#fff' : '#e2e8f0',
                                    fontSize: '12px',
                                    fontWeight: isPicked ? '700' : '500',
                                    cursor: hasChecked ? 'default' : 'pointer',
                                    opacity: hasChecked && !isPicked ? 0.55 : 1,
                                    boxShadow: isPicked ? `0 0 0 1px ${gColor}` : 'none',
                                    transition: 'all 0.12s ease'
                                  }}
                                >
                                  {prep}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Feedback panel post validation */}
                      {hasChecked && (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', animation: 'fadeIn 0.3s ease', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: isQCorrect ? 'var(--color-noun)' : '#ef4444' }}>
                              {isQCorrect ? '✅ Richtig!' : `❌ Falsch! Richtig ist: ${q.correctPreposition}`}
                            </div>
                            {q.category && (
                              <span style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: 'rgba(59, 130, 246, 0.15)',
                                border: '1px solid rgba(59, 130, 246, 0.35)',
                                color: '#93c5fd',
                                fontWeight: '600'
                              }}>
                                📌 {q.category}
                              </span>
                            )}
                          </div>

                          {(q.formula || q.targetVerb || q.category === 'Feste Verbverbindung') && (
                            <div className="grammar-formula-card">
                              <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>📐</span>
                                <span>Feste Verbverbindung Formel</span>
                              </div>
                              <div className="grammar-formula-equation">
                                <span className="grammar-formula-chip" style={{ color: '#93c5fd', background: 'rgba(59, 130, 246, 0.22)', border: '1px solid rgba(59, 130, 246, 0.5)' }}>
                                  {q.targetVerb || 'Verb'}
                                </span>
                                <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>+</span>
                                <span className="grammar-formula-chip" style={{ color: '#fca5a5', background: 'rgba(239, 68, 68, 0.22)', border: '1px solid rgba(239, 68, 68, 0.5)' }}>
                                  {q.correctPreposition}
                                </span>
                                <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>+</span>
                                <span className="grammar-formula-chip" style={{ color: '#86efac', background: 'rgba(34, 197, 94, 0.22)', border: '1px solid rgba(34, 197, 94, 0.5)' }}>
                                  {q.case || (PREPOSITION_GROUPS.Akkusativ.includes(q.correctPreposition) ? 'Akkusativ' : 'Dativ')}
                                </span>
                              </div>
                              {(q.meaning || q.daWo) && (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                  {q.meaning && <span>🇬🇧 <em>{q.meaning}</em></span>}
                                  {q.meaning && q.daWo && <span>•</span>}
                                  {q.daWo && (
                                    <span style={{ color: '#facc15', fontWeight: '600' }}>
                                      🏷️ {q.daWo}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          <div style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderLeft: isQCorrect ? '3px solid var(--color-noun)' : '3px solid #ef4444',
                            padding: '10px 14px',
                            borderRadius: '4px',
                            fontSize: '12.5px',
                            color: 'var(--text-secondary)',
                            lineHeight: '1.5'
                          }}>
                            <strong>Grammatik-Erklärung:</strong> {cleanFormulaText(q.explanation)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Combined Prüfen or Next Batch triggers */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                  {hasChecked && (
                    <div style={{
                      fontSize: '13px',
                      fontWeight: '700',
                      color: correctCount === currentQuestions.length ? 'var(--color-noun)' : '#facc15'
                    }}>
                      Ergebnis: {correctCount} / {currentQuestions.length} Richtig{correctCount === currentQuestions.length ? ' 🎉' : ''}
                    </div>
                  )}
                  {!hasChecked ? (
                    <button
                      type="submit"
                      className="feedback-btn good"
                      disabled={!allFilled}
                      style={{ width: '100%', maxWidth: '340px', padding: '12px', borderRadius: '10px', fontSize: '14px' }}
                    >
                      Antworten prüfen ✔️
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => generateQuestion()}
                      className="feedback-btn good"
                      style={{ width: '100%', maxWidth: '340px', padding: '12px', borderRadius: '10px', fontSize: '14px', background: 'var(--color-verb)', border: '1px solid rgba(59,130,246,0.3)' }}
                    >
                      {questionQueue.length >= 2 ? 'Nächste 2 Sätze (Sofort) ⚡ ➔' : 'Nächste 2 Sätze ➔'}
                    </button>
                  )}
                </div>
              </form>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
