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

  // State to track selected prepositions
  const [selectedPreps, setSelectedPreps] = useState(() => {
    // Select all by default
    const all = [];
    Object.values(PREPOSITION_GROUPS).forEach(list => all.push(...list));
    return all;
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
  const [questionMode, setQuestionMode] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_question_mode');
      if (saved && ['all', 'situational', 'verbs'].includes(saved)) {
        return saved;
      }
    } catch (e) {}
    return 'situational';
  });

  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [fallbackNotice, setFallbackNotice] = useState('');

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

  // Toggle single preposition
  const togglePrep = (prep) => {
    setSelectedPreps(prev => 
      prev.includes(prep) ? prev.filter(p => p !== prep) : [...prev, prep]
    );
  };

  // Toggle entire category group
  const toggleGroup = (groupName) => {
    const groupPreps = PREPOSITION_GROUPS[groupName];
    const allSelected = groupPreps.every(p => selectedPreps.includes(p));
    
    if (allSelected) {
      // Remove all preps of this group
      setSelectedPreps(prev => prev.filter(p => !groupPreps.includes(p)));
    } else {
      // Add missing preps of this group
      setSelectedPreps(prev => {
        const missing = groupPreps.filter(p => !prev.includes(p));
        return [...prev, ...missing];
      });
    }
  };

  const selectAllPreps = () => {
    const all = [];
    Object.values(PREPOSITION_GROUPS).forEach(list => all.push(...list));
    setSelectedPreps(all);
  };

  const selectNonePreps = () => {
    setSelectedPreps([]);
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
    setDeckRemaining(refilled);
    localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(refilled));
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

  const handlePresetInDialog = (presetType) => {
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

    if (shouldRefill) {
      handleRefillDeck(tempWeights);
    } else {
      setDeckRemaining(prev => {
        const next = { ...prev };
        Object.keys(tempWeights).forEach(p => {
          next[p] = Math.min(tempWeights[p] ?? 0, next[p] ?? (tempWeights[p] ?? 0));
        });
        localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(next));
        return next;
      });
    }
    setShowDeckModal(false);
  };

  const generateQuestion = async (targetVerbInput = null) => {
    // Sanitize targetVerbInput: if invoked as an event handler (e.g. onClick={generateQuestion}), ignore the event object!
    const overrideTargetVerb = (targetVerbInput && typeof targetVerbInput === 'object' && targetVerbInput.verb)
      ? targetVerbInput
      : null;

    if (questionMode !== 'verbs' && !overrideTargetVerb && selectedPreps.length === 0) {
      alert("Bitte wähle mindestens eine Präposition aus!");
      return;
    }
    
    setIsLoading(true);
    setErrorMsg('');
    setHasChecked(false);
    setUserInput('');
    setCurrentQuestion(null);

    const randomSeed = Math.floor(Math.random() * 1000000);
    let targetPrep = '';
    let targetCase = '';
    let targetFormula = '';
    let pickedVerb = null;
    let promptText = '';
    let systemInstruction = '';

    if (questionMode === 'verbs' || overrideTargetVerb) {
      // 1. Strictly select from the 65 high-frequency B1 verbs
      if (overrideTargetVerb) {
        pickedVerb = overrideTargetVerb;
      } else {
        let currentRemainingIds = [...festVerbsRemaining];
        if (currentRemainingIds.length === 0) {
          currentRemainingIds = ALL_FIXED_VERBS.map(v => v.id);
          setFestVerbsIteration(it => {
            const nextIt = it + 1;
            localStorage.setItem('b1_grammar_fest_verbs_iteration', String(nextIt));
            return nextIt;
          });
        }

        let candidates = currentRemainingIds.map(id => ALL_FIXED_VERBS.find(v => v.id === id)).filter(Boolean);

        // If user has filtered prepositions on the left, prioritize verbs matching selectedPreps
        if (selectedPreps.length > 0 && selectedPreps.length < ALL_PREPOSITIONS.length) {
          const filteredBySelectedPreps = candidates.filter(v => selectedPreps.includes(v.prep));
          if (filteredBySelectedPreps.length > 0) {
            candidates = filteredBySelectedPreps;
          } else {
            const allMatching = ALL_FIXED_VERBS.filter(v => selectedPreps.includes(v.prep));
            if (allMatching.length > 0) candidates = allMatching;
          }
        }

        if (candidates.length === 0) {
          candidates = ALL_FIXED_VERBS;
        }

        // Pick one verb from candidates
        pickedVerb = candidates[Math.floor(Math.random() * candidates.length)];

        // Update remaining list
        const nextRemaining = currentRemainingIds.filter(id => id !== pickedVerb.id);
        if (nextRemaining.length === 0) {
          const resetAll = ALL_FIXED_VERBS.map(v => v.id);
          setFestVerbsRemaining(resetAll);
          setFestVerbsIteration(it => {
            const nextIt = it + 1;
            localStorage.setItem('b1_grammar_fest_verbs_iteration', String(nextIt));
            return nextIt;
          });
          localStorage.setItem('b1_grammar_fest_verbs_remaining', JSON.stringify(resetAll));
        } else {
          setFestVerbsRemaining(nextRemaining);
          localStorage.setItem('b1_grammar_fest_verbs_remaining', JSON.stringify(nextRemaining));
        }
      }

      setCurrentVerbTarget(pickedVerb);
      targetPrep = pickedVerb.prep;
      targetCase = (pickedVerb.case || '').toLowerCase().startsWith('akk') ? 'Akkusativ' : 'Dativ';
      targetFormula = `${pickedVerb.verb} + ${pickedVerb.prep} + ${targetCase}`;

      // Specific topic keys for preposition and verb
      const prepTopicKey = `prep_${targetPrep}`;
      const verbTopicKey = `verb_${pickedVerb.verb}`;

      const topicSpecificList = Array.from(new Set([
        ...(topicHistory[verbTopicKey] || []),
        ...(topicHistory[prepTopicKey] || [])
      ])).slice(0, 10);

      const otherRecentList = recentHistory
        .filter(s => !topicSpecificList.some(ts => s === ts || s.startsWith(ts) || ts.startsWith(s)))
        .slice(0, Math.max(0, 10 - topicSpecificList.length));

      const recentAvoidBlock = (topicSpecificList.length > 0 || otherRecentList.length > 0)
        ? `\nCRITICAL ANTI-REPETITION CONSTRAINT FOR VERB "${pickedVerb.verb.toUpperCase()}" & PREPOSITION "${targetPrep.toUpperCase()}":
${topicSpecificList.length > 0 ? `PREVIOUS QUESTIONS ON THIS SPECIFIC VERB/PREPOSITION (${pickedVerb.verb} + ${targetPrep}):
${topicSpecificList.map((s, idx) => `  ${idx + 1}. "${s}"`).join('\n')}` : ''}
${otherRecentList.length > 0 ? `\nOTHER RECENTLY GENERATED QUESTIONS (DO NOT REUSE THE SAME CONTEXT OR SUBJECTS):
${otherRecentList.map((s, idx) => `  • "${s}"`).join('\n')}` : ''}
STRICT REQUIREMENT: Do NOT repeat, mirror, or paraphrase any of these recently generated sentences. Create an entirely DIFFERENT context, subject person, and story!\n`
        : '';

      promptText = `Generate a single B1-level German sentence testing a fixed verb-preposition combination (Verben mit festen Präpositionen).

MANDATORY TARGET VERB COLLOCATION:
- Verb: "${pickedVerb.verb}"
- Fixed Preposition: "${pickedVerb.prep}"
- Required Case: ${targetCase} (${pickedVerb.case})
- Verb Meaning: "${pickedVerb.meaning}"
- Pronominal Adverbs (da-/wo-): "${pickedVerb.daWo}"

CRITICAL FILL-IN-THE-BLANK RULE:
1. Conjugate and naturally use the verb "${pickedVerb.verb}" in the main clause.
2. Replace ONLY the preposition "${pickedVerb.prep}" with three underscores '___' for the blank challenge.
3. The blank '___' must be followed by a noun, pronoun, or clause in the ${targetCase}.
4. The sentence MUST unambiguously require "${pickedVerb.prep}" based strictly on the collocation with "${pickedVerb.verb}".

CRITICAL FORMULA IN EXPLANATION:
In the explanation field, explain clearly in plain English why "${pickedVerb.verb}" requires "${pickedVerb.prep}" with ${targetCase}, what it means ("${pickedVerb.meaning}"), and its da-/wo- form (${pickedVerb.daWo}).
State the collocation formula simply in clean plain text (e.g., "${targetFormula}").
DO NOT use LaTeX formatting, dollar signs ($$), or \\textbf. Write in normal, clean plain text.

${recentAvoidBlock}
Requirements:
1. Provide a diverse, natural, real-life B1 everyday situation (office, appointments, friends, home, transport, hobbies).
2. DO NOT use generic textbook clichés.
3. Vary sentence structure and grammatical subjects ('wir', 'die Kollegin', 'Herr Schmidt', 'unsere Nachbarn', formal 'Sie', etc.).
Seed: ${randomSeed}`;

      systemInstruction = `You are an expert German language teacher generating preposition fill-in-the-blank questions for B1 students.
You must return a raw JSON object matching this schema exactly:
{
  "sentence": "German sentence with a single '___' blank representing the missing preposition '${pickedVerb.prep}'.",
  "correctPreposition": "${pickedVerb.prep}",
  "translation": "English translation of the German sentence.",
  "category": "Feste Verbverbindung",
  "targetVerb": "${pickedVerb.verb}",
  "formula": "${targetFormula}",
  "case": "${targetCase}",
  "meaning": "${pickedVerb.meaning}",
  "daWo": "${pickedVerb.daWo}",
  "explanation": "A concise grammatical explanation in English detailing why '${pickedVerb.verb}' requires '${pickedVerb.prep}' with ${targetCase}. State the formula simply as '${targetFormula}'. Output purely in normal English text without LaTeX math syntax."
}
Do not wrap the JSON output in markdown code blocks. Output raw JSON.`;

    } else {
      // Situational or Mixed mode
      setCurrentVerbTarget(null);
      let activeDeck = { ...deckRemaining };
      let eligible = selectedPreps.filter(p => (activeDeck[p] || 0) > 0);

      if (eligible.length === 0) {
        selectedPreps.forEach(p => {
          activeDeck[p] = Math.max(1, prepWeights[p] || 1);
        });
        eligible = selectedPreps.filter(p => (activeDeck[p] || 0) > 0);
      }

      if (eligible.length === 0) {
        eligible = selectedPreps;
      }

      let totalWeight = 0;
      eligible.forEach(p => {
        totalWeight += Math.max(1, activeDeck[p] || 1);
      });

      let rand = Math.random() * totalWeight;
      targetPrep = eligible[0];
      for (const p of eligible) {
        const w = Math.max(1, activeDeck[p] || 1);
        if (rand < w) {
          targetPrep = p;
          break;
        }
        rand -= w;
      }

      const updatedDeck = {
        ...activeDeck,
        [targetPrep]: Math.max(0, (activeDeck[targetPrep] || 1) - 1)
      };
      setDeckRemaining(updatedDeck);
      localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(updatedDeck));

      // Specific topic key for this preposition
      const prepTopicKey = `prep_${targetPrep}`;
      const topicSpecificList = (topicHistory[prepTopicKey] || []).slice(0, 10);
      const otherRecentList = recentHistory
        .filter(s => !topicSpecificList.some(ts => s === ts || s.startsWith(ts) || ts.startsWith(s)))
        .slice(0, Math.max(0, 10 - topicSpecificList.length));

      const recentAvoidBlock = (topicSpecificList.length > 0 || otherRecentList.length > 0)
        ? `\nCRITICAL ANTI-REPETITION CONSTRAINT FOR PREPOSITION "${targetPrep.toUpperCase()}":
${topicSpecificList.length > 0 ? `PREVIOUS QUESTIONS SPECIFICALLY TESTING "${targetPrep.toUpperCase()}":
${topicSpecificList.map((s, idx) => `  ${idx + 1}. "${s}"`).join('\n')}` : ''}
${otherRecentList.length > 0 ? `\nOTHER RECENTLY GENERATED QUESTIONS (DO NOT REUSE THE SAME CONTEXT OR SUBJECTS):
${otherRecentList.map((s, idx) => `  • "${s}"`).join('\n')}` : ''}
STRICT REQUIREMENT: Do NOT repeat, mirror, or paraphrase any of these recently generated sentences. Create an entirely DIFFERENT context, subject person, and story!\n`
        : '';

      let modeConstraint = '';
      if (questionMode === 'situational') {
        modeConstraint = `CRITICAL FOCUS: SIMPLER SITUATIONAL PREPOSITION (NOT VERB-DEPENDENT).
The sentence MUST use "${targetPrep}" purely for situational context:
- Spatial / Location & Direction (Wo? / Wohin? e.g. location of an object or destination of movement in a room, city, street, or building)
- Temporal (Wann? / Wie lange? e.g. times of day, before/after an appointment, days, months, seasons, duration)
- Modal / Means / Cause / Circumstance (Wie? / Womit? / Warum? e.g. travel with a vehicle, food with/without ingredients, weather/circumstances)
STRICT REQUIREMENT: DO NOT use fixed verb-preposition idioms ("Verben mit festen Präpositionen" like 'warten auf', 'denken an', 'sich freuen über', 'hoffen auf', 'abhängen von', 'teilnehmen an', 'gehören zu', etc.). The verb itself must be a normal action (e.g. schlafen, arbeiten, essen, gehen, fahren, ankommen, wohnen, stellen, liegen) that does NOT require this preposition. The preposition must be freely used to express place, time, manner, or reason.`;
      } else {
        modeConstraint = `SENTENCE FOCUS: BALANCED MIX.
You may generate either a simple situational preposition (Lokal: Wo/Wohin, Temporal: Wann, or Modal/Kausal) OR a fixed verb collocation (Verb mit Präposition). Vary the sentence structure naturally.`;
      }

      promptText = `Generate a single B1-level German sentence.
CRITICAL TARGET PREPOSITION: The sentence MUST specifically and unambiguously test the preposition: "${targetPrep}".
Replace "${targetPrep}" in the sentence with three underscores '___' for a blank challenge.
The only natural and grammatically correct solution for the blank must be "${targetPrep}".
${modeConstraint}
${recentAvoidBlock}
Requirements:
1. Provide a diverse, natural, real-life B1 sentence representing everyday scenarios (work, appointments, apartment, travel, conversations, hobbies).
2. DO NOT use generic textbook clichés (like putting a book on the table).
3. Vary sentence structure and grammatical subjects (use 'wir', 'der Kollege', 'die Nachbarin', formal 'Sie', etc.).
4. Do NOT excessively use reflexive verbs.

Seed: ${randomSeed}`;

      systemInstruction = `You are an expert German language teacher generating preposition fill-in-the-blank questions for B1 students.
You must return a raw JSON object matching this schema exactly:
{
  "sentence": "German sentence with a single '___' blank representing the missing preposition.",
  "correctPreposition": "${targetPrep}",
  "translation": "English translation of the German sentence.",
  "category": "Lokal | Temporal | Modal | Kausal | Feste Verbverbindung",
  "targetVerb": "Verb used if fixed collocation, or null",
  "formula": "LaTeX formula if fixed collocation, or null",
  "explanation": "A concise grammatical explanation in English detailing why '${targetPrep}' is correct, which case it governs in this context (Akkusativ, Dativ, Genitiv), and clarifying whether it is a situational usage or a fixed verb-preposition combination."
}
Do not wrap the JSON output in markdown code blocks. Output raw JSON.`;
    }

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: promptText,
        systemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war überlastet. Versuche automatisch ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Satz über Backup-Modell (${usedModel}) generiert, da ${selectedModel} ausgelastet war.`);
        setTimeout(() => setFallbackNotice(''), 7000);
      } else {
        setFallbackNotice('');
      }

      const parsedQuestion = parsedJson || JSON.parse(rawJson);
      if (!parsedQuestion.sentence || !parsedQuestion.correctPreposition) {
        throw new Error('Invalid question format returned.');
      }

      // Ensure formula and verb details are attached
      const enrichedQuestion = {
        ...parsedQuestion,
        targetVerb: parsedQuestion.targetVerb || (pickedVerb ? pickedVerb.verb : null),
        formula: parsedQuestion.formula || (pickedVerb ? targetFormula : null),
        case: parsedQuestion.case || (pickedVerb ? targetCase : null),
        meaning: parsedQuestion.meaning || (pickedVerb ? pickedVerb.meaning : null),
        daWo: parsedQuestion.daWo || (pickedVerb ? pickedVerb.daWo : null)
      };

      setCurrentQuestion(enrichedQuestion);

      // Save to recent 10-question history
      const fullSentence = enrichedQuestion.sentence.replace('___', enrichedQuestion.correctPreposition);

      // 1. Update topic-specific history (last 10 per preposition/verb)
      const prepTopicKey = `prep_${enrichedQuestion.correctPreposition || targetPrep}`;
      const verbTopicKey = pickedVerb ? `verb_${pickedVerb.verb}` : null;
      const keysToUpdate = [prepTopicKey];
      if (verbTopicKey) keysToUpdate.push(verbTopicKey);

      let nextTopicHistory = { ...topicHistory };
      keysToUpdate.forEach(k => {
        const prevList = nextTopicHistory[k] || [];
        const nextList = [
          fullSentence,
          ...prevList.filter(s => s !== fullSentence)
        ].slice(0, 10);
        nextTopicHistory[k] = nextList;
      });
      setTopicHistory(nextTopicHistory);
      localStorage.setItem('b1_grammar_topic_history', JSON.stringify(nextTopicHistory));

      // 2. Update global recent history (last 10 overall)
      const nextHistory = [
        fullSentence,
        ...recentHistory.filter(s => s !== fullSentence)
      ].slice(0, 10);
      setRecentHistory(nextHistory);
      localStorage.setItem('b1_grammar_history', JSON.stringify(nextHistory));
    } catch (err) {
      console.error(err);
      setErrorMsg(`Fehler bei der Verbindung mit Gemini: ${err.message}. Bitte API-Key oder Netzwerk prüfen.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheck = (e) => {
    if (e) e.preventDefault();
    if (!currentQuestion || hasChecked) return;

    const normalizedUser = userInput.trim().toLowerCase();
    const normalizedCorrect = currentQuestion.correctPreposition.trim().toLowerCase();

    const correct = normalizedUser === normalizedCorrect;
    setIsCorrect(correct);
    setHasChecked(true);

    // Speak the complete German sentence with correct answer filled in
    const fullSentence = currentQuestion.sentence.replace('___', currentQuestion.correctPreposition);
    speakGermanText(fullSentence);
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
    <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '1040px', width: '100%', gap: '22px' }}>
      
      {/* Settings bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '4px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#fff' }}>
            📝 Grammar Prepositions
          </div>
          <button
            type="button"
            onClick={handleOpenWeightsModal}
            style={{
              padding: '5px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: '600',
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: '#60a5fa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
            title="Präpositionen-Gewichtung manuell bearbeiten"
          >
            <span>⚖️ Edit Weights</span>
            <span style={{ fontSize: '11px', opacity: 0.85 }}>({totalRemainingForSelected}/{totalWeightsForSelected} left)</span>
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
                cursor: 'pointer'
              }}
              title="Wähle den Fragestil: Einfach/Situativ, Feste Verben oder Gemischt"
            >
              <option value="situational" style={{ background: '#090a0f', color: '#fff' }}>
                📍 Einfach / Situativ (Lokal, Temporal, Modal)
              </option>
              <option value="verbs" style={{ background: '#090a0f', color: '#fff' }}>
                🔗 Feste Verbverbindungen (warten auf...)
              </option>
              <option value="all" style={{ background: '#090a0f', color: '#fff' }}>
                🎲 Gemischt (Alle Typen)
              </option>
            </select>
          </div>

          {/* Button: Show Verb List */}
          <button
            type="button"
            onClick={() => setShowVerbListModal(true)}
            style={{
              padding: '5px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: '700',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(168, 85, 247, 0.22))',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              color: '#d8b4fe',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
            title="65 B1 Verben mit festen Präpositionen nach Präpositionen gruppiert ansehen"
          >
            <span>📋 Show Verb List</span>
            <span style={{ fontSize: '11px', opacity: 0.9, background: 'rgba(0,0,0,0.35)', padding: '1px 6px', borderRadius: '10px' }}>
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
              fontSize: '11px'
            }}>
              <span style={{ color: '#c4b5fd', fontWeight: '700' }}>Cycle #{festVerbsIteration}:</span>
              <span style={{ color: '#fff', fontWeight: '600' }}>{68 - festVerbsRemaining.length}/68 covered</span>
              <span style={{ color: 'var(--text-muted)' }}>({festVerbsRemaining.length} left)</span>
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

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
              cursor: 'pointer'
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
            style={{ fontSize: '12px', padding: '4px 10px', height: '28px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', borderRadius: '8px' }}
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
            background: 'rgba(5, 7, 15, 0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
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
              maxHeight: '90vh',
              overflowY: 'auto',
              background: 'rgba(16, 20, 36, 0.98)',
              border: '1px solid rgba(59, 130, 246, 0.45)',
              borderRadius: '16px',
              boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
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
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      color: '#e2e8f0',
                      cursor: 'pointer'
                    }}
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
            padding: '20px'
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
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📋 65 High-Frequency B1 Verbs with Fixed Prepositions</span>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                  Prioritized B1 Verben mit festen Präpositionen, Kasus (Akkusativ/Dativ) und Pronominaladverbien (<em>da(r)-</em> / <em>wo(r)-</em>), gruppiert nach Präpositionen.
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
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔄 Cycle #{festVerbsIteration} Fortschritt:</span>
                  <span style={{ color: '#d8b4fe' }}>{68 - festVerbsRemaining.length} / 68 gedeckt</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({festVerbsRemaining.length} verbleibend)</span>
                </div>
                {/* Progress bar */}
                <div style={{ width: '240px', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
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

                      {/* Group Table */}
                      <div style={{ overflowX: 'auto' }}>
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

      {/* Main interface layout: Left compact selector and Right large question layout */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '24px', width: '100%', alignItems: 'stretch' }}>
        
        {/* Left Side: Prepositions filter list (compact) */}
        <div className="glass-card" style={{ flex: '0 0 250px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
        <div className="glass-card" style={{ flex: '1 1 500px', minWidth: '320px', padding: '36px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '440px', position: 'relative' }}>
          
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', width: '100%', height: '100%', minHeight: '260px' }}>
              <div style={{ fontSize: '32px', animation: 'spin 1.5s linear infinite' }}>🔄</div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic' }} className="animate-pulse">
                Gemini generiert einen Präpositionalsatz...
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

          {!currentQuestion && !isLoading && !errorMsg && (
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
                Satz Generieren ➔
              </button>
            </div>
          )}

          {currentQuestion && !isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.3s ease' }}>
              
              {/* Question display */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                  Setze die richtige Präposition ein:
                </div>
                
                {/* Large sentence display */}
                <div style={{ 
                  fontSize: '22px', 
                  fontWeight: '700', 
                  lineHeight: '1.6', 
                  color: '#fff', 
                  padding: '16px', 
                  background: 'rgba(255, 255, 255, 0.02)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '12px',
                  textAlign: 'center'
                }}>
                  {hasChecked ? (
                    <span>
                      {currentQuestion.sentence.split('___')[0]}
                      <strong style={{ color: isCorrect ? 'var(--color-noun)' : '#ef4444', borderBottom: isCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444', padding: '0 4px' }}>
                        {currentQuestion.correctPreposition}
                      </strong>
                      {currentQuestion.sentence.split('___')[1]}
                    </span>
                  ) : (
                    currentQuestion.sentence
                  )}
                </div>

                {/* Translation subtitle */}
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center' }}>
                  🇬🇧 "{currentQuestion.translation}"
                </div>
              </div>

              {/* Form Input */}
              <form onSubmit={handleCheck} style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                <div style={{ display: 'flex', width: '100%', gap: '10px' }}>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Präposition eintippen..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    disabled={hasChecked}
                    style={{ 
                      textAlign: 'center', 
                      fontSize: '16px', 
                      padding: '12px', 
                      borderRadius: '10px',
                      border: hasChecked
                        ? (isCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444')
                        : '1px solid var(--border-color)',
                      outline: 'none',
                      flexGrow: 1
                    }}
                    autoFocus
                    autoComplete="off"
                  />
                  
                  {/* Speaker helper for full sentence */}
                  {hasChecked && (
                    <button
                      type="button"
                      className="sound-btn"
                      onClick={() => {
                        const full = currentQuestion.sentence.replace('___', currentQuestion.correctPreposition);
                        speakGermanText(full);
                      }}
                      style={{ width: '46px', height: '46px', fontSize: '18px', padding: 0, justifyContent: 'center', alignItems: 'center', borderRadius: '10px', flexShrink: 0 }}
                      title="Satz anhören"
                    >
                      🔊
                    </button>
                  )}
                </div>

                {/* Feedback panel post validation */}
                {hasChecked && (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease' }}>
                    {/* Badge and Category */}
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px'
                    }}>
                      <div style={{ 
                        fontSize: '14px', 
                        fontWeight: '700',
                        color: isCorrect ? 'var(--color-noun)' : '#ef4444'
                      }}>
                        {isCorrect ? '✅ Richtig!' : `❌ Falsch! Richtig ist: ${currentQuestion.correctPreposition}`}
                      </div>
                      {currentQuestion.category && (
                        <span style={{
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: 'rgba(59, 130, 246, 0.15)',
                          border: '1px solid rgba(59, 130, 246, 0.35)',
                          color: '#93c5fd',
                          fontWeight: '600'
                        }}>
                          📌 {currentQuestion.category}
                        </span>
                      )}
                    </div>

                    {/* Verb Collocation Formula Card: $$\textbf{Verb} + \textbf{Preposition} + \textbf{Case (Akk / Dat)}$$ */}
                    {(currentQuestion.formula || currentQuestion.targetVerb || currentQuestion.category === 'Feste Verbverbindung') && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '16px 20px',
                        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(15, 23, 42, 0.9))',
                        border: '1px solid rgba(139, 92, 246, 0.4)',
                        borderRadius: '12px',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>📐</span>
                          <span>Feste Verbverbindung Formel</span>
                        </div>

                        {/* Visual equation with styled elements */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexWrap: 'wrap',
                          gap: '10px',
                          fontSize: '18px'
                        }}>
                          <span style={{ fontWeight: '800', color: '#93c5fd', background: 'rgba(59, 130, 246, 0.22)', padding: '4px 14px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.5)' }}>
                            {currentQuestion.targetVerb || 'Verb'}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '18px', fontWeight: '400' }}>+</span>
                          <span style={{ fontWeight: '800', color: '#fca5a5', background: 'rgba(239, 68, 68, 0.22)', padding: '4px 14px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.5)' }}>
                            {currentQuestion.correctPreposition}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '18px', fontWeight: '400' }}>+</span>
                          <span style={{ fontWeight: '800', color: '#86efac', background: 'rgba(34, 197, 94, 0.22)', padding: '4px 14px', borderRadius: '8px', border: '1px solid rgba(34, 197, 94, 0.5)' }}>
                            {currentQuestion.case || (PREPOSITION_GROUPS.Akkusativ.includes(currentQuestion.correctPreposition) ? 'Akkusativ' : 'Dativ')}
                          </span>
                        </div>

                        {/* Meaning & da-/wo- pronominal adverbs */}
                        {(currentQuestion.meaning || currentQuestion.daWo) && (
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                            {currentQuestion.meaning && <span>🇬🇧 <em>{currentQuestion.meaning}</em></span>}
                            {currentQuestion.meaning && currentQuestion.daWo && <span>•</span>}
                            {currentQuestion.daWo && (
                              <span style={{ color: '#facc15', fontWeight: '600' }}>
                                🏷️ {currentQuestion.daWo}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Explanatory notes */}
                    <div style={{ 
                      background: 'rgba(255, 255, 255, 0.03)', 
                      borderLeft: isCorrect ? '3px solid var(--color-noun)' : '3px solid #ef4444', 
                      padding: '12px 16px', 
                      borderRadius: '4px',
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.5'
                    }}>
                      <strong>Grammatik-Erklärung:</strong> {cleanFormulaText(currentQuestion.explanation)}
                    </div>
                  </div>
                )}

                {/* Submissions or Next triggers */}
                {!hasChecked ? (
                  <button 
                    type="submit" 
                    className="feedback-btn good"
                    disabled={!userInput.trim()}
                    style={{ width: '100%', maxWidth: '240px', padding: '12px', borderRadius: '10px', fontSize: '14px' }}
                  >
                    Antwort prüfen ✔️
                  </button>
                ) : (
                  <button 
                    type="button" 
                    onClick={() => generateQuestion()} 
                    className="feedback-btn good"
                    style={{ width: '100%', maxWidth: '240px', padding: '12px', borderRadius: '10px', fontSize: '14px', background: 'var(--color-verb)', border: '1px solid rgba(59,130,246,0.3)' }}
                  >
                    Nächster Satz ➔
                  </button>
                )}
              </form>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
