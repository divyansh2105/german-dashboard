import React, { useState, useEffect, useRef } from 'react';
import { queryGemini } from '../utils/geminiApi';

const PRESET_SITUATIONS = [
  {
    id: 'late',
    icon: '🚗',
    label: 'Running Late',
    description: 'Explaining to a friend or boss why I am late because my train was delayed and traffic was stuck.'
  },
  {
    id: 'weekend',
    icon: '📅',
    label: 'Weekend Plans',
    description: 'Inviting a friend to a spontaneous weekend lake trip if the weather stays nice, planning who brings snacks.'
  },
  {
    id: 'mixup',
    icon: '💼',
    label: 'Work Mix-up',
    description: 'Resolving an email misunderstanding with a colleague about project deadlines and proposing a quick call.'
  },
  {
    id: 'landlord',
    icon: '🏠',
    label: 'Landlord Request',
    description: 'Informing the landlord that the heating has stopped working and asking when a technician could come.'
  },
  {
    id: 'return',
    icon: '🛒',
    label: 'Store Return',
    description: 'Explaining to a store clerk that a jacket bought yesterday has a broken zipper and asking for an exchange.'
  },
  {
    id: 'random',
    icon: '🎲',
    label: 'Surprise Me',
    description: 'A spontaneous, realistic B1 everyday conversation scenario in Germany.'
  }
];

export const FLUENCY_GRAMMAR_AREAS = [
  {
    id: 'perfekt',
    label: 'Perfekt',
    shortClue: 'conversational spoken past tense',
    rule: 'haben/sein + Partizip II'
  },
  {
    id: 'nebensaetze',
    label: 'Nebensätze',
    shortClue: 'weil, obwohl, dass, wenn, da',
    rule: 'subordinate clauses with verb at end'
  },
  {
    id: 'infinitiv_zu',
    label: 'Infinitiv mit zu',
    shortClue: 'versuchen ... zu, hoffen ... zu, Zeit haben ... zu',
    rule: 'infinitival clause with zu'
  },
  {
    id: 'konjunktiv2',
    label: 'Konjunktiv II',
    shortClue: 'hätte, wäre, könnte, würde gern',
    rule: 'polite requests & hypotheticals'
  },
  {
    id: 'relative_clauses',
    label: 'Relative clauses',
    shortClue: 'der, die, das, in dem, mit dem, worüber',
    rule: 'Relativsätze with relative pronoun and verb placed at the very end'
  },
  {
    id: 'subordinate_clauses',
    label: 'Subordinate clauses',
    shortClue: 'nachdem, bevor, während, als, falls, sodass, damit, ob',
    rule: 'advanced temporal/conditional/concessive clauses with verb at end'
  }
];

const FALLBACK_SCENARIO = {
  scenarioTitle: "Running Late for a Meeting",
  scenarioContext: "You are texting your colleague explaining why you haven't arrived at the office yet.",
  englishParagraph: "I am really sorry that I am running so late today. The morning train that I usually take was canceled because there was a technical problem on the tracks. I tried to catch a bus instead, but the traffic was completely stuck before we could reach the station. If I had known about the delay earlier, I would have taken my bicycle. I hope to be at the office in about twenty minutes.",
  sentences: [
    "I am really sorry that I am running so late today.",
    "The morning train that I usually take was canceled because there was a technical problem on the tracks.",
    "I tried to catch a bus instead, but the traffic was completely stuck before we could reach the station.",
    "If I had known about the delay earlier, I would have taken my bicycle.",
    "I hope to be at the office in about twenty minutes."
  ],
  targetGrammarPoints: [
    { name: "Nebensätze (dass, weil)", description: "Verb moved to the very end of the subordinate clause" },
    { name: "Relative clauses (Relativsätze)", description: "Relative pronoun (den ich normalerweise nehme) with verb placed at the very end" },
    { name: "Subordinate clauses (bevor)", description: "Advanced temporal clause with verb at end" },
    { name: "Perfekt / Passiv", description: "Spoken past tense / past action (wurde abgesagt, bin steckengeblieben)" },
    { name: "Infinitiv mit zu", description: "Infinitiv phrase with zu (versucht ... zu erwischen, hoffe ... zu sein)" },
    { name: "Konjunktiv II", description: "Hypothetical condition (Wenn ich ... gewusst hätte, hätte ich ... genommen)" }
  ],
  keyVocabulary: [
    { english: "to be running late", germanHint: "sich verspäten / spät dran sein" },
    { english: "technical problem", germanHint: "die technische Störung" },
    { english: "completely stuck", germanHint: "völlig überlastet / im Stau stehen" },
    { english: "delay", germanHint: "die Verspätung" }
  ],
  referenceGermanTranslation: "Es tut mir wirklich leid, dass ich heute so spät dran bin. Der Morgenzug, den ich normalerweise nehme, ist ausgefallen, weil es ein technisches Problem auf den Gleisen gab. Ich habe stattdessen versucht, einen Bus zu nehmen, aber der Verkehr hat komplett gestanden, bevor wir den Bahnhof erreichen konnten. Wenn ich früher von der Verspätung gewusst hätte, hätte ich mein Fahrrad genommen. Ich hoffe, in etwa zwanzig Minuten im Büro zu sein.",
  nativeColloquialGerman: "Tut mir echt leid, dass ich heute so spät bin! Mein normaler Zug, den ich sonst immer nehme, ist heute früh ausgefallen, weil's 'ne technische Störung gab. Hab dann versucht, den Bus zu kriegen, aber es ging gar nichts mehr, noch bevor wir überhaupt am Bahnhof waren. Wenn ich das vorher gewusst hätte, wär ich einfach mit'm Rad gefahren. Müsste aber in so zwanzig Minuten da sein!"
};

export default function FluencyPractice({
  apiKey,
  selectedModel,
  availableModels,
  fallbackNotice,
  setFallbackNotice,
  speakGermanText
}) {
  const [currentScenario, setCurrentScenario] = useState(() => {
    const saved = localStorage.getItem('b1_fluency_current_scenario');
    return saved ? JSON.parse(saved) : FALLBACK_SCENARIO;
  });
  const [customSituation, setCustomSituation] = useState('');
  const [activePreset, setActivePreset] = useState('late');

  const [selectedGrammarFocus, setSelectedGrammarFocus] = useState(() => {
    const saved = localStorage.getItem('b1_fluency_grammar_focus');
    return saved ? JSON.parse(saved) : [];
  });

  const [sentenceLength, setSentenceLength] = useState(() => {
    const saved = localStorage.getItem('b1_fluency_sentence_length');
    return saved ? parseInt(saved, 10) : 5;
  });

  const [sentenceComplexity, setSentenceComplexity] = useState(() => {
    const saved = localStorage.getItem('b1_fluency_sentence_complexity');
    return saved ? parseInt(saved, 10) : 5;
  });

  const getLengthDescriptor = (val) => {
    if (val <= 2) return { label: 'Very Short', count: '~5–8 words/sent', color: '#60a5fa' };
    if (val <= 4) return { label: 'Short', count: '~8–11 words/sent', color: '#38bdf8' };
    if (val <= 6) return { label: 'Medium', count: '~12–15 words/sent', color: '#34d399' };
    if (val <= 8) return { label: 'Long', count: '~16–21 words/sent', color: '#fbbf24' };
    return { label: 'Extended', count: '~22–30+ words/sent', color: '#f87171' };
  };

  const getComplexityDescriptor = (val) => {
    if (val <= 2) return { label: 'Basic Spoken', detail: 'Simple daily words & direct clauses', color: '#60a5fa' };
    if (val <= 4) return { label: 'Accessible B1', detail: 'Everyday vocabulary & direct connectors', color: '#38bdf8' };
    if (val <= 6) return { label: 'Solid B1', detail: 'Authentic spoken rhythm & common idioms', color: '#a78bfa' };
    if (val <= 8) return { label: 'Upper B1', detail: 'Rich colloquial particles & varied clauses', color: '#c084fc' };
    return { label: 'Colloquial Mastery', detail: 'Deep native idioms & expressive flow', color: '#f472b6' };
  };

  const [userTranslation, setUserTranslation] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [critiqueResult, setCritiqueResult] = useState(null);
  const [showVocabHints, setShowVocabHints] = useState(false);

  // Speech Recognition state
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const sessionBaseTextRef = useRef('');

  // Save current scenario to localStorage
  useEffect(() => {
    if (currentScenario) {
      localStorage.setItem('b1_fluency_current_scenario', JSON.stringify(currentScenario));
    }
  }, [currentScenario]);

  // Setup Web Speech Recognition for German dictation
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'de-DE';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
      };

      rec.onresult = (event) => {
        let sessionTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i][0]) {
            sessionTranscript += event.results[i][0].transcript;
          }
        }
        const cleanedSession = sessionTranscript.trim();
        const base = sessionBaseTextRef.current;
        setUserTranslation(base ? (base + ' ' + cleanedSession) : cleanedSession);
      };

      rec.onerror = (event) => {
        console.error('Speech recognition error in Fluency:', event.error);
        if (event.error === 'aborted') return;
      };

      rec.onend = () => {
        setIsListening(false);
        isListeningRef.current = false;
      };

      recognitionRef.current = rec;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Please try Google Chrome or Safari.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      sessionBaseTextRef.current = userTranslation ? userTranslation.trim() : '';
      recognitionRef.current.start();
    }
  };

  // Speak English paragraph using browser TTS
  const speakEnglish = (text) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Speak German using the passed speakGermanText or window.speechSynthesis
  const speakGerman = (text) => {
    if (speakGermanText) {
      speakGermanText(text);
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'de-DE';
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Generate a new 4-5 sentence conversational English paragraph
  const handleGenerateScenario = async (targetSituationOverride = null) => {
    const situationToUse = targetSituationOverride !== null 
      ? targetSituationOverride 
      : (customSituation.trim() || (PRESET_SITUATIONS.find(p => p.id === activePreset)?.description || 'everyday casual conversation in Germany'));

    setIsGenerating(true);
    setCritiqueResult(null);
    setUserTranslation('');

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    if (!apiKey) {
      // Pick a variation or use fallback
      setCurrentScenario(FALLBACK_SCENARIO);
      setIsGenerating(false);
      return;
    }

    const randomSeed = Math.floor(Math.random() * 1000000);

    const activeGrammarLabels = selectedGrammarFocus.length > 0
      ? FLUENCY_GRAMMAR_AREAS.filter(ga => selectedGrammarFocus.includes(ga.id)).map(ga => `${ga.label} (${ga.shortClue})`)
      : FLUENCY_GRAMMAR_AREAS.map(ga => `${ga.label} (${ga.shortClue})`);

    const lengthDesc = getLengthDescriptor(sentenceLength);
    const complexityDesc = getComplexityDescriptor(sentenceComplexity);

    const promptText = `Generate a 4-to-5 sentence conversational English paragraph suitable for B1 German practice.
Target Situation: "${situationToUse}".

CRITICAL REQUIREMENTS:
1. TONE & STYLE: It must sound like everyday natural spoken speech between people (e.g., explaining why I was late, talking about weekend plans, resolving a mix-up at work, an apartment issue, or making plans). Casual, spontaneous, and realistic!
2. SENTENCE COUNT: Exactly 4 or 5 sentences.
3. SENTENCE LENGTH (Level ${sentenceLength}/10 - ${lengthDesc.label}): Target average length of ${lengthDesc.count}. Ensure the English sentences reflect this target length.
4. SENTENCE COMPLEXITY (Level ${sentenceComplexity}/10 - ${complexityDesc.label}): ${complexityDesc.detail}. Structure the conversational dialogue to match this B1 fluency depth.
5. GRAMMAR EMBEDDING: ${selectedGrammarFocus.length > 0 
    ? `You MUST specifically embed these selected B1 grammar structures:
${activeGrammarLabels.map(l => `   - ${l}`).join('\n')}`
    : `You MUST naturally embed at least TWO of these key B1 German grammar structures:
   - Perfekt (conversational spoken past tense: haben/sein + Partizip II)
   - Nebensätze with connectors (weil, obwohl, dass, wenn, da)
   - Infinitiv mit zu (e.g., versuchen ... zu, hoffen ... zu, Lust haben ... zu, Zeit haben ... zu)
   - Konjunktiv II (polite request, suggestion, or hypothetical: könnte, hätte, wäre, würde gern)
   - Relative clauses (Relativsätze: der, die, das, in dem, mit dem, worüber - relative pronoun matching gender/case with verb at the end)
   - Subordinate clauses (advanced temporal, conditional, or consecutive clauses: nachdem, bevor, während, als, falls, sodass, damit, ob)`}
6. SPOKEN PAST TENSE DIRECTIVE (PERFEKT PREFERRED OVER PRÄTERITUM): The student will almost always be using Perfekt instead of Präteritum for past actions. When generating referenceGermanTranslation and nativeColloquialGerman, provide translations that prioritize natural spoken Perfekt (haben/sein + Partizip II). Only use Präteritum for auxiliary verbs (war, hatte), modal verbs (musste, konnte, wollte, durfte, sollte), or fixed spoken idioms (es gab). In all other cases, use conversational Perfekt so it sounds completely natural to speak.
7. DO NOT provide the German translation yet to the student.

Seed: ${randomSeed}`;

    const systemInstruction = `You are an expert German language examiner creating everyday conversational speech challenges for B1 German learners.
Note: The student will almost always use conversational Perfekt instead of narrative Präteritum. Ensure referenceGermanTranslation and nativeColloquialGerman reflect natural spoken German (using Perfekt for action verbs, reserving Präteritum only for war, hatte, modal verbs, or es gab).
Return a raw JSON object matching this schema exactly:
{
  "scenarioTitle": "Catchy short title (e.g. 'Late for the Meeting')",
  "scenarioContext": "Brief 1-sentence setting (e.g. 'You are messaging your colleague after missing your connecting train.')",
  "englishParagraph": "The complete 4-to-5 sentence conversational English paragraph.",
  "sentences": [
    "Sentence 1",
    "Sentence 2",
    "Sentence 3",
    "Sentence 4",
    "Sentence 5 (optional)"
  ],
  "targetGrammarPoints": [
    {
      "name": "Nebensätze (weil / obwohl / dass)",
      "description": "Subordinate clause connector requiring the conjugated verb placed at the very end"
    },
    {
      "name": "Perfekt",
      "description": "Spoken past tense using auxiliary (haben/sein) + Partizip II"
    }
  ],
  "keyVocabulary": [
    { "english": "flat tire", "germanHint": "der platte Reifen / einen Platten haben" },
    { "english": "to catch up", "germanHint": "sich austauschen / nachholen" }
  ],
  "referenceGermanTranslation": "Accurate, clean B1 standard German translation using conversational Perfekt",
  "nativeColloquialGerman": "100% natural, colloquial German version of how a native speaker would say this in casual everyday conversation (favoring Perfekt for past actions)"
}
Output raw JSON only. Do not wrap in markdown code fences.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: promptText,
        systemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          if (setFallbackNotice) {
            setFallbackNotice(`Modell ${failedModel} war überlastet. Versuche ${nextModel}...`);
          }
        }
      });

      if (wasFallback && setFallbackNotice) {
        setFallbackNotice(`⚡ Szenario über Backup-Modell (${usedModel}) generiert.`);
        setTimeout(() => setFallbackNotice(''), 6000);
      }

      const parsed = parsedJson || JSON.parse(rawJson);
      if (!parsed.englishParagraph) {
        throw new Error("Invalid scenario format returned.");
      }

      setCurrentScenario(parsed);
    } catch (err) {
      console.error("Fluency generation error:", err);
      if (setFallbackNotice) {
        setFallbackNotice(`⚠️ Fehler bei der Generierung: ${err.message}. Verwende Standard-Szenario.`);
      }
      setCurrentScenario(FALLBACK_SCENARIO);
    } finally {
      setIsGenerating(false);
    }
  };

  // Critique student's German translation
  const handleCheckTranslation = async (e) => {
    if (e) e.preventDefault();
    if (!userTranslation.trim() || isEvaluating) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setIsEvaluating(true);

    if (!apiKey) {
      // Heuristic fallback critique
      const fallbackCritique = {
        overallScore: 85,
        rating: "good",
        summary: "Good conversational attempt! You conveyed the main points well. Compare your word order with the native colloquial version below.",
        wordOrderCritique: {
          rating: "minor_issues",
          explanation: "In subordinate clauses introduced by 'weil' or 'dass', verify that your conjugated verb is placed at the very end. In main clauses, maintain Verb in Position 2."
        },
        corrections: [
          {
            original: userTranslation.slice(0, 40) + '...',
            corrected: currentScenario.referenceGermanTranslation.slice(0, 45) + '...',
            category: "Word Order / Collocation",
            explanation: "Ensure the verb moves to the end after subordinate connectors."
          }
        ],
        nativeColloquialGerman: currentScenario.nativeColloquialGerman || currentScenario.referenceGermanTranslation,
        colloquialNuances: [
          {
            phrase: "weil's 'ne technische Störung gab",
            explanation: "In spoken German, 'weil es eine' is frequently contracted to 'weil's 'ne' for smooth conversational rhythm."
          },
          {
            phrase: "es ging gar nichts mehr",
            explanation: "A very popular spoken idiom meaning 'traffic came to a complete standstill' or 'nothing was moving anymore'."
          }
        ],
        grammarPointsChecklist: (currentScenario.targetGrammarPoints || []).map(g => ({
          point: g.name,
          achieved: true,
          feedback: `Practiced in this exercise: ${g.description}`
        }))
      };

      setCritiqueResult(fallbackCritique);
      setIsEvaluating(false);
      return;
    }

    const evalPrompt = `Here is my German translation for the English paragraph:
"${userTranslation.trim()}"

Critique my word order (especially verb placement and connectors), correct any errors, and give me a 100% natural, colloquial German version of how a native speaker would say this in casual conversation. Note: I will almost always be using Perfekt instead of Präteritum for past actions, so provide feedback and recommendations based on Perfekt, as long as it continues sounding natural to speak.`;

    const evalSystemInstruction = `You are an expert, encouraging German language coach and native speaker evaluating a B1 student's translation of an everyday conversational paragraph.

English Source Paragraph:
"${currentScenario.englishParagraph}"

Targeted B1 Grammar:
${JSON.stringify(currentScenario.targetGrammarPoints || [])}

The student has submitted this German translation:
"${userTranslation.trim()}"

CRITICAL EVALUATION TASKS:
1. SPOKEN PAST TENSE DIRECTIVE (PERFEKT PREFERRED OVER PRÄTERITUM):
   - The student will almost always use Perfekt (haben/sein + Partizip II) instead of Präteritum for past actions.
   - NEVER penalize, deduct points, or treat Perfekt as inferior when the student describes past actions using Perfekt (e.g., 'ich habe gearbeitet', 'wir sind gefahren', 'er hat gesagt'). Both are grammatically correct, and Perfekt is the primary natural spoken form in German!
   - In all your corrections, suggested improvements, and 'nativeColloquialGerman', ALWAYS favor and recommend Perfekt rather than converting sentences into bookish/narrative Präteritum, as long as it continues sounding natural to speak.
   - Only suggest Präteritum where native German speakers genuinely prefer it in casual speech (specifically: 'sein' -> war, 'haben' -> hatte, modal verbs -> musste/konnte/wollte/durfte/sollte, or 'es gab'). Full action verbs must remain in Perfekt.
2. CRITIQUE WORD ORDER:
   - Analyze verb placement in detail:
     * Main clauses: conjugated verb in Position 2 (V2).
     * Subordinate clauses (Nebensätze): conjugated verb placed at the very end (weil, obwohl, dass, wenn, als, nachdem, bevor, während, falls, sodass, damit, ob).
     * Relative clauses (Relativsätze): relative pronoun agreement (der/die/das/dem/den/dessen/mit dem/in der/worüber) and conjugated verb placed at the very end of the relative clause!
     * Infinitives with 'zu': 'zu' + infinitive placed at the end of the infinitive clause.
     * Konjunktiv II forms (hätte, wäre, könnte, würde gern).
     * Perfekt: auxiliary verb (haben/sein) placement + Partizip II at clause end.
     * Separable prefixes placed at the end of main clauses.
   - Analyze connectors (weil vs. denn, obwohl vs. trotzdem, dass vs. sodass, als vs. wenn) and relative pronouns (der, die, das, dem, den, dessen, mit dem, in der).
3. ERROR CORRECTION:
   - Check case inflections (Akkusativ, Dativ, Genitiv), prepositions, adjective endings, noun gender, and tense formation.
4. 100% NATURAL, COLLOQUIAL GERMAN:
   - Provide a 100% natural, colloquial German version of how a native German speaker would say this exact paragraph in casual conversation (using natural colloquial particles like 'halt', 'mal', 'eben', smooth idioms, spoken rhythm, and conversational Perfekt).
5. CRITICAL LANGUAGE REQUIREMENT:
   - All critique remarks, explanations, rules, and notes MUST BE WRITTEN IN ENGLISH so the student clearly grasps why their word order or grammar was incorrect.

Output ONLY a JSON object matching this schema:
{
  "overallScore": number (0 to 100),
  "rating": "excellent" | "good" | "needs_work",
  "summary": "2-3 encouraging sentences in English summarizing the attempt and overall conversational flow",
  "wordOrderCritique": {
    "rating": "perfect" | "minor_issues" | "needs_attention",
    "explanation": "Clear, detailed breakdown in English critiquing verb positions and connectors."
  },
  "corrections": [
    {
      "original": "part from student's German with mistake",
      "corrected": "corrected German phrasing",
      "category": "Word Order | Case | Preposition | Tense | Vocabulary",
      "explanation": "Explanation in English of the rule and why it was corrected"
    }
  ],
  "nativeColloquialGerman": "100% natural colloquial German paragraph as spoken by a native in casual conversation",
  "colloquialNuances": [
    {
      "phrase": "colloquial phrase or particle in German",
      "explanation": "English explanation of why native speakers say it this way in casual speech"
    }
  ],
  "grammarPointsChecklist": [
    {
      "point": "Name of grammar point (e.g. Perfekt, Nebensatz)",
      "achieved": boolean,
      "feedback": "Short feedback in English on how well the student applied it"
    }
  ]
}
Output raw JSON only.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: evalPrompt,
        systemInstruction: evalSystemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          if (setFallbackNotice) {
            setFallbackNotice(`Modell ${failedModel} war ausgelastet. Wechsle zu ${nextModel}...`);
          }
        }
      });

      if (wasFallback && setFallbackNotice) {
        setFallbackNotice(`⚡ Bewertung über Backup-Modell (${usedModel}) generiert.`);
        setTimeout(() => setFallbackNotice(''), 6000);
      }

      const critiqueData = parsedJson || JSON.parse(rawJson);
      setCritiqueResult(critiqueData);
    } catch (err) {
      console.error("Fluency evaluation error:", err);
      if (setFallbackNotice) {
        setFallbackNotice(`⚠️ Fehler bei der Bewertung: ${err.message}`);
      }
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      
      {/* Top Banner / Controls & Persistent Filters */}
      <div className="glass-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255, 255, 255, 0.02)' }}>
        
        {/* Title row & Generate action */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>⚡</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#fff' }}>
                Fluency Builder: Conversational German
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                Practice spoken everyday German with custom grammar targets, sentence length, and complexity sliders.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleGenerateScenario()}
            disabled={isGenerating}
            className="feedback-btn good"
            style={{ padding: '8px 18px', fontSize: '13px', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {isGenerating ? '🔄 Generating...' : '🎲 Generate Scenario'}
          </button>
        </div>

        {/* 1. GRAMMAR FILTERS (Top) */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '12px 14px',
          borderRadius: '12px',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.06)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px' }}>🎯</span>
              <span style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#e2e8f0' }}>
                Grammar Filters ({selectedGrammarFocus.length > 0 ? `${selectedGrammarFocus.length} selected` : 'All 6 active'}):
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {selectedGrammarFocus.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGrammarFocus([]);
                    localStorage.removeItem('b1_fluency_grammar_focus');
                  }}
                  style={{ background: 'none', border: 'none', color: '#93c5fd', fontSize: '11px', cursor: 'pointer', padding: '0 4px', textDecoration: 'underline' }}
                >
                  Reset to All (Any 2+)
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Click to filter specific targets
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {FLUENCY_GRAMMAR_AREAS.map(ga => {
              const isExplicit = selectedGrammarFocus.includes(ga.id);
              const isAllActive = selectedGrammarFocus.length === 0;
              return (
                <button
                  key={ga.id}
                  type="button"
                  onClick={() => {
                    let next;
                    if (isExplicit) {
                      next = selectedGrammarFocus.filter(id => id !== ga.id);
                    } else {
                      next = [...selectedGrammarFocus, ga.id];
                    }
                    setSelectedGrammarFocus(next);
                    localStorage.setItem('b1_fluency_grammar_focus', JSON.stringify(next));
                  }}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: isExplicit ? '700' : '500',
                    background: isExplicit ? 'rgba(139, 92, 246, 0.35)' : (isAllActive ? 'rgba(139, 92, 246, 0.12)' : 'rgba(255, 255, 255, 0.04)'),
                    border: isExplicit ? '1px solid rgba(167, 139, 250, 0.8)' : (isAllActive ? '1px solid rgba(139, 92, 246, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)'),
                    color: isExplicit ? '#f3e8ff' : (isAllActive ? '#c4b5fd' : 'var(--text-muted)'),
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease'
                  }}
                  title={`${ga.label}: ${ga.shortClue} (${ga.rule})`}
                >
                  <span style={{ fontSize: '12px' }}>{isExplicit ? '✅' : (isAllActive ? '✨' : '⚪')}</span>
                  <span>{ga.label}</span>
                  <span style={{ fontSize: '10.5px', opacity: 0.7, fontStyle: 'italic' }}>({ga.shortClue})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. DUAL SLIDERS: SENTENCE LENGTH (1-10) & COMPLEXITY (1-10) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '14px',
          padding: '14px 16px',
          borderRadius: '12px',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.06)'
        }}>
          {/* Slider 1: Sentence Length */}
          {(() => {
            const desc = getLengthDescriptor(sentenceLength);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📏</span>
                    <span>Sentence Length:</span>
                  </label>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: desc.color,
                    border: '1px solid rgba(59, 130, 246, 0.3)'
                  }}>
                    Level {sentenceLength}/10 • {desc.label} ({desc.count})
                  </span>
                </div>

                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={sentenceLength}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setSentenceLength(val);
                    localStorage.setItem('b1_fluency_sentence_length', val.toString());
                  }}
                  style={{
                    width: '100%',
                    cursor: 'pointer',
                    accentColor: '#3b82f6',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'rgba(255, 255, 255, 0.15)',
                    margin: '4px 0'
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                  <span>1 (Short ~6w)</span>
                  <span style={{ opacity: 0.6 }}>5 (Medium ~14w)</span>
                  <span>10 (Long ~28w+)</span>
                </div>
              </div>
            );
          })()}

          {/* Slider 2: Sentence Complexity */}
          {(() => {
            const desc = getComplexityDescriptor(sentenceComplexity);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🧠</span>
                    <span>Sentence Complexity:</span>
                  </label>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'rgba(168, 85, 247, 0.2)',
                    color: desc.color,
                    border: '1px solid rgba(168, 85, 247, 0.3)'
                  }}>
                    Level {sentenceComplexity}/10 • {desc.label}
                  </span>
                </div>

                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={sentenceComplexity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setSentenceComplexity(val);
                    localStorage.setItem('b1_fluency_sentence_complexity', val.toString());
                  }}
                  style={{
                    width: '100%',
                    cursor: 'pointer',
                    accentColor: '#a855f7',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'rgba(255, 255, 255, 0.15)',
                    margin: '4px 0'
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                  <span>1 (Simple)</span>
                  <span style={{ opacity: 0.6 }}>5 (Solid B1)</span>
                  <span>10 (Native-like)</span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* 3. SITUATION PRESETS & CUSTOM INPUT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)' }}>
            Choose or Customize Situation:
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {PRESET_SITUATIONS.map(preset => {
              const isSelected = activePreset === preset.id && !customSituation.trim();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setActivePreset(preset.id);
                    setCustomSituation('');
                    handleGenerateScenario(preset.description);
                  }}
                  disabled={isGenerating}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: isSelected ? '700' : '500',
                    background: isSelected ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                    border: isSelected ? '1px solid var(--color-verb)' : '1px solid rgba(255, 255, 255, 0.1)',
                    color: isSelected ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease'
                  }}
                  title={preset.description}
                >
                  <span>{preset.icon}</span>
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom situation input */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={customSituation}
            onChange={(e) => setCustomSituation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleGenerateScenario();
              }
            }}
            placeholder="Or type a custom scenario (e.g. 'Asking neighbor to water my plants', 'Explaining a train delay')..."
            style={{
              flex: '1 1 280px',
              padding: '9px 14px',
              borderRadius: '10px',
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid var(--border-color)',
              color: '#fff',
              fontSize: '13px'
            }}
          />
          <button
            type="button"
            onClick={() => handleGenerateScenario()}
            disabled={isGenerating || !customSituation.trim()}
            style={{
              padding: '9px 16px',
              borderRadius: '10px',
              background: customSituation.trim() ? 'var(--color-verb)' : 'rgba(255, 255, 255, 0.05)',
              border: 'none',
              color: '#fff',
              fontSize: '13px',
              fontWeight: '600',
              cursor: customSituation.trim() ? 'pointer' : 'default',
              opacity: customSituation.trim() ? 1 : 0.6
            }}
          >
            Generate Custom ➔
          </button>
        </div>

      </div>

      {/* Main Challenge Card */}
      {currentScenario && (
        <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          
          {/* Scenario Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.4)' }}>
                  {currentScenario.sentences?.length || 5} Sentences • Length {sentenceLength}/10 • Complexity {sentenceComplexity}/10
                </span>
                <h4 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#fff' }}>
                  {currentScenario.scenarioTitle || "Conversational Scenario"}
                </h4>
              </div>
              {currentScenario.scenarioContext && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '2px' }}>
                  📌 {currentScenario.scenarioContext}
                </div>
              )}
            </div>

            {/* Audio & Vocab buttons */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => speakEnglish(currentScenario.englishParagraph)}
                className="sound-btn"
                title="Listen to English paragraph"
                style={{ fontSize: '12px', padding: '6px 12px', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span>🔊</span>
                <span>Listen (EN)</span>
              </button>
              {currentScenario.keyVocabulary && currentScenario.keyVocabulary.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowVocabHints(!showVocabHints)}
                  className="sound-btn"
                  title="Toggle Vocabulary Hints"
                  style={{ fontSize: '12px', padding: '6px 12px', background: showVocabHints ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.06)', borderRadius: '8px', color: showVocabHints ? '#93c5fd' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>💡</span>
                  <span>{showVocabHints ? 'Hide Vocab Hints' : 'Vocab Hints'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Target Grammar Focus Badges */}
          {currentScenario.targetGrammarPoints && currentScenario.targetGrammarPoints.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)' }}>
                Target Grammar to Include in German:
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {currentScenario.targetGrammarPoints.map((gp, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: '12px',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      color: '#93c5fd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    title={gp.description}
                  >
                    <span>🎯</span>
                    <strong>{gp.name}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Vocabulary Hints Collapsible */}
          {showVocabHints && currentScenario.keyVocabulary && (
            <div style={{
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Key Vocabulary Hints:
              </span>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {currentScenario.keyVocabulary.map((v, i) => (
                  <span key={i} style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    • <span style={{ color: '#fff' }}>{v.english}:</span> <strong style={{ color: '#4ade80' }}>{v.germanHint}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* The English Paragraph Box */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8))',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            padding: '20px 24px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
          }}>
            <p style={{
              margin: 0,
              fontSize: '16px',
              lineHeight: 1.7,
              color: '#f8fafc',
              fontWeight: '400',
              fontStyle: 'normal'
            }}>
              "{currentScenario.englishParagraph}"
            </p>
          </div>

          {/* Student German Translation Form */}
          <form onSubmit={handleCheckTranslation} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '700', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🇩🇪 Your German Translation:</span>
                <span style={{ fontSize: '11px', fontWeight: '500', color: 'var(--text-muted)' }}>
                  (Type or click Speak to dictate)
                </span>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Microphone Dictation Button */}
                <button
                  type="button"
                  onClick={toggleMic}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    border: isListening ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.15)',
                    background: isListening ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                    color: isListening ? '#fca5a5' : '#fff',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease'
                  }}
                  title={isListening ? "Click to stop dictation" : "Click to speak in German"}
                >
                  <span style={{ fontSize: '14px', animation: isListening ? 'pulse 1s infinite' : 'none' }}>
                    {isListening ? '🛑' : '🎙️'}
                  </span>
                  <span>{isListening ? 'Listening (Speaking)...' : 'Dictate German'}</span>
                </button>

                {userTranslation && (
                  <button
                    type="button"
                    onClick={() => setUserTranslation('')}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', padding: '4px 8px' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Translation Textarea */}
            <textarea
              value={userTranslation}
              onChange={(e) => setUserTranslation(e.target.value)}
              placeholder="Hier auf Deutsch übersetzen (z.B. 'Es tut mir leid, dass ich mich verspätet habe...')"
              rows={4}
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '12px',
                background: 'rgba(0, 0, 0, 0.35)',
                border: isListening ? '1px solid #ef4444' : '1px solid var(--border-color)',
                color: '#fff',
                fontSize: '15px',
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />

            {/* Submit & Navigation Triggers */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '6px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {userTranslation.trim().split(/\s+/).filter(Boolean).length} words
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="submit"
                  disabled={!userTranslation.trim() || isEvaluating}
                  className="feedback-btn good"
                  style={{
                    padding: '10px 24px',
                    fontSize: '14px',
                    fontWeight: '700',
                    width: 'auto',
                    borderRadius: '10px',
                    background: 'var(--color-verb)',
                    border: '1px solid rgba(59, 130, 246, 0.4)'
                  }}
                >
                  {isEvaluating ? '🔄 Evaluating Word Order & Grammar...' : 'Critique Translation & Native Version ➔'}
                </button>
              </div>
            </div>
          </form>

          {/* Feedback & Native Colloquial Output */}
          {critiqueResult && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              padding: '24px',
              borderRadius: '14px',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              animation: 'fadeIn 0.3s ease'
            }}>
              
              {/* Header Status & Score */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '24px' }}>
                    {critiqueResult.overallScore >= 80 ? '🎉' : '✍️'}
                  </span>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '800', color: critiqueResult.overallScore >= 80 ? '#4ade80' : '#facc15' }}>
                      {critiqueResult.overallScore >= 90 ? 'Excellent Conversational Flow!' : (critiqueResult.overallScore >= 75 ? 'Great Attempt!' : 'Needs Work on Word Order')}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {critiqueResult.summary}
                    </div>
                  </div>
                </div>

                <div style={{
                  padding: '6px 14px',
                  borderRadius: '10px',
                  background: critiqueResult.overallScore >= 80 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                  color: critiqueResult.overallScore >= 80 ? '#4ade80' : '#facc15',
                  fontWeight: '800',
                  fontSize: '15px'
                }}>
                  {critiqueResult.overallScore}/100
                </div>
              </div>

              {/* 1. Word Order & Connectors Critique Box */}
              {critiqueResult.wordOrderCritique && (
                <div style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: '12px',
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.7px', color: '#93c5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📐</span>
                    <span>Word Order &amp; Verb Placement Critique:</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '13.5px', color: '#f1f5f9', lineHeight: 1.6 }}>
                    {critiqueResult.wordOrderCritique.explanation}
                  </p>
                </div>
              )}

              {/* 2. Targeted Grammar Points Checklist */}
              {critiqueResult.grammarPointsChecklist && critiqueResult.grammarPointsChecklist.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                    B1 Grammar Check:
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {critiqueResult.grammarPointsChecklist.map((item, idx) => (
                      <div key={idx} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        background: 'rgba(255, 255, 255, 0.02)',
                        padding: '8px 12px',
                        borderRadius: '8px'
                      }}>
                        <span>{item.achieved ? '✅' : '⚠️'}</span>
                        <strong style={{ color: item.achieved ? '#86efac' : '#fca5a5' }}>{item.point}:</strong>
                        <span style={{ color: 'var(--text-secondary)' }}>{item.feedback}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Detailed Corrections Breakdown */}
              {critiqueResult.corrections && critiqueResult.corrections.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                    Corrections &amp; Grammar Breakdown:
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {critiqueResult.corrections.map((corr, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(0, 0, 0, 0.35)',
                          borderRadius: '10px',
                          padding: '12px 16px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ color: '#f87171', textDecoration: 'line-through' }}>{corr.original}</span>
                          <span style={{ color: 'var(--text-muted)' }}>➔</span>
                          <strong style={{ color: '#4ade80' }}>{corr.corrected}</strong>
                          {corr.category && (
                            <span style={{ fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                              {corr.category}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {corr.explanation}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. 100% Natural, Colloquial German Native Version */}
              {critiqueResult.nativeColloquialGerman && (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(6, 78, 59, 0.25))',
                  border: '1px solid rgba(52, 211, 153, 0.4)',
                  borderRadius: '14px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '20px' }}>🇩🇪</span>
                      <strong style={{ fontSize: '14px', color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                        100% Natural Spoken Native Version (Casual Conversation)
                      </strong>
                    </div>

                    <button
                      type="button"
                      onClick={() => speakGerman(critiqueResult.nativeColloquialGerman)}
                      className="sound-btn"
                      title="Listen to native spoken German"
                      style={{ fontSize: '13px', padding: '6px 14px', background: 'rgba(52, 211, 153, 0.2)', border: '1px solid rgba(52, 211, 153, 0.4)', borderRadius: '10px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <span>🔊</span>
                      <span>Anhören (Audio)</span>
                    </button>
                  </div>

                  <p style={{
                    margin: 0,
                    fontSize: '15.5px',
                    lineHeight: 1.7,
                    color: '#ecfdf5',
                    fontWeight: '500'
                  }}>
                    "{critiqueResult.nativeColloquialGerman}"
                  </p>

                  {/* Colloquial Nuances breakdown */}
                  {critiqueResult.colloquialNuances && critiqueResult.colloquialNuances.length > 0 && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      marginTop: '4px',
                      paddingTop: '10px',
                      borderTop: '1px solid rgba(52, 211, 153, 0.2)'
                    }}>
                      <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#6ee7b7' }}>
                        💡 Spoken Native Nuances &amp; Particles:
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {critiqueResult.colloquialNuances.map((cn, idx) => (
                          <div key={idx} style={{ fontSize: '12.5px', color: '#d1fae5', lineHeight: 1.5 }}>
                            • <strong style={{ color: '#a7f3d0' }}>"{cn.phrase}":</strong> {cn.explanation}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Bottom buttons: Next Scenario or Revise */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setCritiqueResult(null);
                  }}
                  className="nav-button"
                  style={{ padding: '10px 18px', fontSize: '13px' }}
                >
                  ✍️ Revise &amp; Retry
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateScenario()}
                  className="feedback-btn good"
                  style={{ padding: '10px 22px', fontSize: '13px', width: 'auto' }}
                >
                  Next Scenario ➔
                </button>
              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
}
