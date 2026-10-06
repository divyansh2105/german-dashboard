import React, { useState, useEffect, useRef } from 'react';
import { queryGemini, fetchAvailableModels, DEFAULT_GEMINI_MODELS } from '../utils/geminiApi';

// Predefined B1 curriculum topics for translation exercises
const TRANSLATION_TOPICS = [
  { id: 'mixed', label: '🎲 Mixed B1', desc: 'Random mix of essential B1 grammar and vocabulary' },
  { id: 'past', label: '⏳ Past Tenses', desc: 'Perfekt & Präteritum (haben/sein + Partizip II, unregelmäßige Verben)' },
  { id: 'future', label: '🚀 Future Tense', desc: 'Futur I (werden + Infinitiv) and expressing plans' },
  { id: 'prepositions', label: '📍 Prepositions & Cases', desc: 'Wechselpräpositionen, two-way prepositions, Dativ & Akkusativ' },
  { id: 'subordinate', label: '🔗 Subordinate Clauses', desc: 'Nebensätze (weil, dass, obwohl, wenn, als, da - Verb at end)' },
  { id: 'modal', label: '🛠️ Modal Verbs', desc: 'Modalverben (können, müssen, dürfen, sollen, wollen, möchten)' },
  { id: 'passive', label: '⚙️ Passive Voice', desc: 'Vorgangspassiv (werden + Partizip II)' },
  { id: 'relative', label: '👥 Relative Clauses', desc: 'Relativsätze (der, die, das, welcher, dessen, denen)' },
  { id: 'konjunktiv2', label: '💭 Konjunktiv II', desc: 'Wishes and polite requests (hätte, wäre, würde + Infinitiv)' },
  { id: 'everyday', label: '☕ Everyday & Work', desc: 'B1 exam scenarios (work, appointments, doctor, housing, travel)' }
];

// Sentence length configurations
const SENTENCE_LENGTHS = [
  { id: 'auto', label: '⚡ Auto', desc: 'Natural balanced B1 length (~10-18 words)', wordRange: '10 to 18 words' },
  { id: 'small', label: '🔹 Small', desc: 'Short, direct sentences (5-9 words)', wordRange: '5 to 9 words' },
  { id: 'medium', label: '🔸 Medium', desc: 'Standard compound sentences (10-16 words)', wordRange: '10 to 16 words' },
  { id: 'long', label: '🔺 Long', desc: 'Longer multi-clause sentences (17-26 words)', wordRange: '17 to 26 words' }
];

// Diverse real-world scenarios to prevent repetitive generations
const SCENARIO_DOMAINS = [
  { domain: "Workplace & Technology", details: "team meetings, deadlines, IT troubleshooting, remote work, client communication, software rollout, job interviews" },
  { domain: "Housing, Landlords & Repairs", details: "rental contracts, heating malfunction, noise complaints, neighbors, kitchen renovation, waste separation" },
  { domain: "Travel & Public Transportation", details: "railway delays, platform changes, flight delay compensation, booking compartments, luggage, road trips" },
  { domain: "Official Bureaucracy & Admin", details: "residence permit, municipal registration (Bürgeramt), tax office inquiries, banking opening hours, post office returns" },
  { domain: "Health, Doctor & Pharmacy", details: "prescriptions, dentist appointments, allergic reactions, physiotherapy recommendations, medical checkups" },
  { domain: "Social Gatherings & Friendships", details: "dinner invitations, birthday surprise gifts, resolving arguments, concert tickets, mutual favors, weekend trips" },
  { domain: "Shopping, Consumer & Services", details: "defective electronics warranty, returning clothing, organic supermarket choices, customer support hotlines" },
  { domain: "University, Language & Study", details: "library group sessions, exam preparation, German presentation rehearsals, professor office hours" },
  { domain: "Leisure, Outdoors & Nature", details: "hiking in the Black Forest, camping in unpredictable weather, bicycle repair, community sports clubs" },
  { domain: "Culture, Media & City Life", details: "art museum exhibitions, attending the local theater, neighborhood street festivals, cinema debates" }
];

// Diverse sentence perspectives & rhetorical types
const PERSPECTIVE_STYLES = [
  "First-person singular/plural explaining an important personal decision, plan, or lesson learned",
  "Polite professional inquiry or favor request (using formal 'Sie' or polite indirect phrasing)",
  "Third-person situational account (narrating actions of a colleague, landlord, doctor, customer, or technician)",
  "Cause and consequence (describing an obstacle, unforeseen change, and how it was tackled)",
  "Contrast or concessive realization (highlighting an unexpected twist or contradiction with 'although / even though')",
  "Hypothetical advice or constructive suggestion (using conditional advice or recommendations)",
  "Sequential chronology (action that had to be done prior to another event or future milestone)"
];

// Topic-specific grammatical sub-nuances for deep variety
const TOPIC_SUB_FOCUSES = {
  past: [
    "Präteritum of modal verbs (musste, konnte, durfte, wollte) combined with an infinitive clause",
    "Perfekt with 'sein' for change of location or state (z.B. umgezogen, eingeschlafen, aufgewacht, angekommen)",
    "Perfekt with reflexive verbs (z.B. sich beschwert, sich entschieden, sich gefreut)",
    "Plusquamperfekt combined with 'nachdem' for completed past actions",
    "Mixed narrative: reporting a past incident and its lingering consequences"
  ],
  future: [
    "Futur I (werden + Infinitiv) expressing a firm plan, resolution, or prediction",
    "Futur I expressing an assumption about the present (z.B. 'Er wird wohl im Büro sein')",
    "Alternative future using temporal adverbs (z.B. nächsten Monat, übermorgen) + Präsens",
    "Conditional future outcome: what will happen if a specific condition is fulfilled"
  ],
  prepositions: [
    "Two-way prepositions (Wechselpräpositionen) with Dativ for stationary position (in, an, auf, unter, vor, hinter, zwischen)",
    "Two-way prepositions with Akkusativ for motion/direction (stellen, legen, hängen, setzen)",
    "Verbs with fixed prepositions (z.B. warten auf, teilnehmen an, sich interessieren für, träumen von, abhängen von)",
    "Genitiv prepositions common at B1 (während, trotz, wegen, innerhalb)"
  ],
  subordinate: [
    "Double connectors (nicht nur ... sondern auch, sowohl ... als auch, entweder ... oder)",
    "Concessive clauses with 'obwohl' followed by main clause inversion",
    "Infinitive clauses with 'um ... zu' vs causal clause with 'damit'",
    "Infinitive with 'ohne ... zu' or 'anstatt ... zu'",
    "Indirect questions using 'ob' or interrogative pronouns (wann, wie, warum)"
  ],
  modal: [
    "Polite request or subjective permission using Konjunktiv II / Modalverben (dürfte, könnte, müsste)",
    "Modal verb inside a subordinate clause (verb cluster at the end: '... weil er morgen arbeiten muss')",
    "Past tense of modal verbs in everyday workplace or travel excuses",
    "Expressing obligation vs prohibition (müssen vs nicht dürfen)"
  ],
  passive: [
    "Vorgangspassiv in Präsens for ongoing processes or official rules (werden + Partizip II)",
    "Vorgangspassiv in Präteritum/Perfekt for completed events (wurde + Partizip II)",
    "Passive with modal verbs (z.B. 'muss repariert werden', 'kann erst morgen abgeholt werden')",
    "Zustandspassiv (sein + Partizip II) describing the resulting state"
  ],
  relative: [
    "Relative clause with preposition + case (z.B. 'der Kollege, mit dem ich gesprochen habe')",
    "Relative clause in Dativ or Genitiv ('das Kind, dessen Eltern...', 'den Freunden, denen wir geholfen haben')",
    "Relative clause referring to a location or indefinite pronoun ('alles, was...', 'der Ort, wo...')",
    "Relative clause nested within a complex sentence"
  ],
  konjunktiv2: [
    "Polite requests and offers using 'hätte', 'wäre', 'könnte' (z.B. 'Hätten Sie vielleicht einen Moment Zeit?')",
    "Unreal conditions in the present ('Wenn ich mehr Zeit hätte, würde ich...')",
    "Giving polite advice using 'sollte' ('Du solltest unbedingt den Vertrag genau lesen')",
    "Unreal wishes or regrets in daily situations ('Ich wünschte, die Heizung würde funktionieren')"
  ],
  everyday: [
    "Dealing with an unexpected delay, rescheduling an appointment with apologies",
    "Filing a polite complaint about a defective item or service issue",
    "Explaining requirements or asking for advice at a public administrative office",
    "Navigating a small conflict or negotiation with a neighbor, colleague, or landlord"
  ]
};

// Offline backup bank of curated B1 translation exercises
const OFFLINE_EXERCISES = [
  // Short exercises (5-9 words)
  {
    english: "I will call you tomorrow right after work.",
    topic: "future",
    topicName: "Future Tense",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Temporale Angaben und Futur mit 'werden' oder Präsens.",
    hints: [
      { english: "to call", german: "anrufen (ruft an, hat angerufen)" },
      { english: "after work", german: "nach der Arbeit (Dativ)" }
    ],
    referenceTranslations: [
      "Ich werde dich morgen direkt nach der Arbeit anrufen.",
      "Ich rufe dich morgen gleich nach der Arbeit an."
    ]
  },
  {
    english: "The technician repaired the radiator in our office.",
    topic: "past",
    topicName: "Past Tenses",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Perfekt / Präteritum mit Akkusativobjekt und lokaler Präposition.",
    hints: [
      { english: "technician", german: "der Techniker (-)" },
      { english: "radiator / heater", german: "der Heizkörper (-)" },
      { english: "to repair", german: "reparieren (hat repariert)" }
    ],
    referenceTranslations: [
      "Der Techniker hat den Heizkörper in unserem Büro repariert.",
      "Der Techniker reparierte die Heizung in unserem Büro."
    ]
  },
  {
    english: "The keys are lying under the morning newspaper.",
    topic: "prepositions",
    topicName: "Prepositions (Wechselpräpositionen)",
    scenarioDomain: "Housing, Landlords & Repairs",
    grammarFocus: "Wechselpräposition 'unter' + Dativ bei Ortsangabe (keine Bewegung).",
    hints: [
      { english: "to lie / rest", german: "liegen (liegt, hat gelegen)" },
      { english: "newspaper", german: "die Zeitung (-en)" }
    ],
    referenceTranslations: [
      "Die Schlüssel liegen unter der Morgenzeitung.",
      "Die Schlüssel befinden sich unter der Zeitung."
    ]
  },
  {
    english: "The package was delivered to our neighbor yesterday.",
    topic: "passive",
    topicName: "Passive Voice (Vorgangspassiv Präteritum)",
    scenarioDomain: "Official Bureaucracy & Admin",
    grammarFocus: "Vorgangspassiv im Präteritum: 'wurde' + Partizip II ('geliefert').",
    hints: [
      { english: "package", german: "das Paket (-e)" },
      { english: "to deliver", german: "liefern (hat geliefert) / zustellen" },
      { english: "neighbor", german: "der Nachbar (-n, n-Deklination)" }
    ],
    referenceTranslations: [
      "Das Paket wurde gestern bei unserem Nachbarn abgegeben.",
      "Das Paket wurde gestern an unseren Nachbarn geliefert."
    ]
  },
  {
    english: "Could you please open the conference room window?",
    topic: "konjunktiv2",
    topicName: "Konjunktiv II (Polite Request)",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Höfliche Bitte mit Konjunktiv II ('Könnten Sie ... öffnen?').",
    hints: [
      { english: "conference room", german: "der Konferenzraum (-räume)" },
      { english: "to open", german: "öffnen / aufmachen" }
    ],
    referenceTranslations: [
      "Könnten Sie bitte das Fenster im Konferenzraum öffnen?",
      "Würden Sie bitte das Konferenzraumfenster öffnen?"
    ]
  },
  {
    english: "We must submit the financial report today.",
    topic: "modal",
    topicName: "Modal Verbs",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Modalverb 'müssen' im Präsens + Infinitiv am Satzende ('einreichen').",
    hints: [
      { english: "to submit", german: "einreichen (hat eingereicht)" },
      { english: "financial report", german: "der Finanzbericht (-e)" }
    ],
    referenceTranslations: [
      "Wir müssen den Finanzbericht heute einreichen.",
      "Wir müssen heute den Finanzbericht abgeben."
    ]
  },
  // Medium exercises (10-16 words)
  {
    english: "Yesterday I had to cancel the doctor's appointment because my train was delayed.",
    topic: "past",
    topicName: "Past Tenses & Modal Verbs",
    scenarioDomain: "Health, Doctor & Pharmacy",
    grammarFocus: "Modalverb im Präteritum ('musste') und Kausalsatz mit 'weil' (Verb am Ende).",
    hints: [
      { english: "to cancel", german: "absagen (hat abgesagt)" },
      { english: "doctor's appointment", german: "der Arzttermin (-e)" },
      { english: "delayed", german: "verspätet sein" }
    ],
    referenceTranslations: [
      "Gestern musste ich den Arzttermin absagen, weil mein Zug verspätet war.",
      "Gestern habe ich den Arzttermin absagen müssen, weil mein Zug Verspätung hatte."
    ]
  },
  {
    english: "After we arrived at the university library, we reserved a quiet study room.",
    topic: "past",
    topicName: "Past Tenses (Perfekt & Präteritum)",
    scenarioDomain: "University, Language & Study",
    grammarFocus: "Temporalsatz mit 'nachdem' (Perfekt/Plusquamperfekt) und Präteritum im Hauptsatz.",
    hints: [
      { english: "to arrive", german: "ankommen (ist angekommen)" },
      { english: "library", german: "die Bibliothek (-en)" },
      { english: "to reserve", german: "reservieren (hat reserviert)" }
    ],
    referenceTranslations: [
      "Nachdem wir in der Universitätsbibliothek angekommen waren, reservierten wir einen ruhigen Lernraum.",
      "Nachdem wir an der Universitätsbibliothek angekommen sind, haben wir einen ruhigen Arbeitsraum reserviert."
    ]
  },
  {
    english: "Next month our company will introduce a new project management software for all teams.",
    topic: "future",
    topicName: "Future Tense (Futur I)",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Futur I: werden + Infinitiv ('einführen') am Ende des Satzes.",
    hints: [
      { english: "to introduce / roll out", german: "einführen (hat eingeführt)" },
      { english: "next month", german: "nächsten Monat (Akkusativ)" }
    ],
    referenceTranslations: [
      "Nächsten Monat wird unser Unternehmen eine neue Projektmanagement-Software für alle Teams einführen.",
      "Im nächsten Monat führt unsere Firma eine neue Projektmanagement-Software für alle Teams ein."
    ]
  },
  {
    english: "He placed the keys on the kitchen table before he left the house.",
    topic: "prepositions",
    topicName: "Prepositions (Wechselpräpositionen & Cases)",
    scenarioDomain: "Housing, Landlords & Repairs",
    grammarFocus: "Wechselpräposition 'auf' + Akkusativ bei Bewegung ('legen auf den Tisch'), gefolgt von Temporalsatz mit 'bevor'.",
    hints: [
      { english: "to place / put", german: "legen (hat gelegt)" },
      { english: "kitchen table", german: "der Küchentisch (-e)" },
      { english: "to leave", german: "verlassen (verlässt, hat verlassen)" }
    ],
    referenceTranslations: [
      "Er hat die Schlüssel auf den Küchentisch gelegt, bevor er das Haus verlassen hat.",
      "Er legte die Schlüssel auf den Küchentisch, bevor er das Haus verließ."
    ]
  },
  {
    english: "The broken washing machine cannot be repaired until the spare parts arrive tomorrow.",
    topic: "passive",
    topicName: "Passive Voice with Modal Verb",
    scenarioDomain: "Housing, Landlords & Repairs",
    grammarFocus: "Passiv mit Modalverb ('kann nicht repariert werden') und Temporalsatz ('bis ... ankommen').",
    hints: [
      { english: "washing machine", german: "die Waschmaschine (-n)" },
      { english: "spare part", german: "das Ersatzteil (-e)" },
      { english: "to repair", german: "reparieren (hat repariert)" }
    ],
    referenceTranslations: [
      "Die kaputte Waschmaschine kann nicht repariert werden, bis die Ersatzteile morgen ankommen.",
      "Die defekte Waschmaschine lässt sich erst reparieren, wenn die Ersatzteile morgen eintreffen."
    ]
  },
  {
    english: "If we had reserved the flight earlier, we would have saved a lot of money.",
    topic: "konjunktiv2",
    topicName: "Konjunktiv II (Past Unreal Condition)",
    scenarioDomain: "Travel & Public Transportation",
    grammarFocus: "Irrealer Konditionalsatz der Vergangenheit: 'hätten ... reserviert', 'hätten ... gespart'.",
    hints: [
      { english: "to reserve", german: "reservieren / buchen" },
      { english: "to save money", german: "Geld sparen (hat gespart)" }
    ],
    referenceTranslations: [
      "Wenn wir den Flug früher gebucht hätten, hätten wir eine Menge Geld gespart.",
      "Hätten wir den Flug eher reserviert, hätten wir viel Geld gespart."
    ]
  },
  {
    english: "I am looking for a colleague who has solid experience with international contract negotiations.",
    topic: "relative",
    topicName: "Relative Clauses",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Relativsatz im Nominativ Maskulinum ('der ... hat') mit Verbletztstellung.",
    hints: [
      { english: "colleague", german: "der Kollege (-n, n-Deklination)" },
      { english: "contract negotiations", german: "die Vertragsverhandlungen (Plural)" },
      { english: "solid experience", german: "solide Erfahrung (-en)" }
    ],
    referenceTranslations: [
      "Ich suche einen Kollegen, der solide Erfahrung mit internationalen Vertragsverhandlungen hat.",
      "Ich suche nach einer Kollegin, die fundierte Erfahrungen mit internationalen Vertragsverhandlungen besitzt."
    ]
  },
  // Long exercises (17-26 words)
  {
    english: "Since I have lived in Germany for two years, I can understand most conversations at work without any major difficulties.",
    topic: "subordinate",
    topicName: "Subordinate Clauses (Kausalsatz)",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Nebensatz mit 'da / weil' oder 'seit', gefolgt von Hauptsatz mit Inversion.",
    hints: [
      { english: "conversation", german: "das Gespräch (-e) / die Unterhaltung" },
      { english: "difficulty", german: "die Schwierigkeit (-en)" },
      { english: "at work", german: "bei der Arbeit (Dativ)" }
    ],
    referenceTranslations: [
      "Da ich seit zwei Jahren in Deutschland lebe, kann ich die meisten Gespräche bei der Arbeit ohne große Schwierigkeiten verstehen.",
      "Weil ich schon zwei Jahre in Deutschland wohne, verstehe ich die meisten Unterhaltungen am Arbeitsplatz problemlos."
    ]
  },
  {
    english: "Although the weather was rather cold, many colleagues went for a long walk during the lunch break because they needed fresh air.",
    topic: "subordinate",
    topicName: "Subordinate Clauses (obwohl & weil)",
    scenarioDomain: "Leisure, Outdoors & Nature",
    grammarFocus: "Mehrere Nebensätze mit 'obwohl' und 'weil' mit Verbletztstellung.",
    hints: [
      { english: "rather cold", german: "ziemlich kalt" },
      { english: "colleague", german: "der Kollege (-n) / die Kollegin (-nen)" },
      { english: "fresh air", german: "frische Luft" }
    ],
    referenceTranslations: [
      "Obwohl das Wetter ziemlich kalt war, machten viele Kollegen in der Mittagspause einen langen Spaziergang, weil sie frische Luft brauchten.",
      "Obwohl es recht kalt war, sind viele Kollegen in der Mittagspause spazieren gegangen, da sie frische Luft benötigten."
    ]
  },
  {
    english: "Because our landlord decided to renovate the heating system, we had to find temporary accommodation in another neighborhood for two weeks.",
    topic: "subordinate",
    topicName: "Subordinate Clauses (Kausal & Temporal)",
    scenarioDomain: "Housing, Landlords & Repairs",
    grammarFocus: "Kausalsatz mit 'weil/da', gefolgt von Präteritum mit Modalverb ('mussten') und lokaler Präposition.",
    hints: [
      { english: "landlord", german: "der Vermieter (-)" },
      { english: "temporary accommodation", german: "eine vorübergehende Unterkunft" },
      { english: "heating system", german: "die Heizanlage / das Heizungssystem" }
    ],
    referenceTranslations: [
      "Weil unser Vermieter beschlossen hat, die Heizung zu renovieren, mussten wir für zwei Wochen eine vorübergehende Unterkunft in einem anderen Viertel finden.",
      "Da unser Vermieter das Heizungssystem sanieren ließ, mussten wir für zwei Wochen in einen anderen Stadtteil ausweichen."
    ]
  },
  {
    english: "Before you officially sign the employment contract, you should discuss all essential conditions concerning overtime and remote work with your team leader.",
    topic: "everyday",
    topicName: "Workplace & Modal Advice",
    scenarioDomain: "Workplace & Technology",
    grammarFocus: "Temporalsatz mit 'bevor' und Ratschlag im Hauptsatz mit Konjunktiv II ('sollten Sie besprechen').",
    hints: [
      { english: "employment contract", german: "der Arbeitsvertrag (-träge)" },
      { english: "overtime", german: "die Überstunden (Plural)" },
      { english: "remote work", german: "das Homeoffice / das mobile Arbeiten" }
    ],
    referenceTranslations: [
      "Bevor Sie den Arbeitsvertrag offiziell unterschreiben, sollten Sie alle wichtigen Bedingungen bezüglich Überstunden und Homeoffice mit Ihrem Teamleiter besprechen.",
      "Ehe Sie den Vertrag unterzeichnen, sollten Sie alle wesentlichen Regelungen über Überstunden und Remotearbeit mit der Teamleitung klären."
    ]
  }
];

export default function TranslationPractice() {
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
      } catch (e) {}
    }
    return DEFAULT_GEMINI_MODELS;
  });

  const [selectedTopic, setSelectedTopic] = useState('mixed');
  const [selectedLength, setSelectedLength] = useState(() => {
    return localStorage.getItem('b1_translation_length') || 'auto';
  });
  const [currentExercise, setCurrentExercise] = useState(null);
  const [userTranslation, setUserTranslation] = useState('');
  const [showHints, setShowHints] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [fallbackNotice, setFallbackNotice] = useState('');

  // Voice-to-Text Recognition states
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const sessionBaseTextRef = useRef('');
  const recentSentencesRef = useRef([]);

  // Stats / streak
  const [stats, setStats] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_translation_stats');
      return saved ? JSON.parse(saved) : { totalSolved: 0, correct: 0, streak: 0 };
    } catch (e) {
      return { totalSolved: 0, correct: 0, streak: 0 };
    }
  });

  // Sync available models
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

  // Persist stats
  useEffect(() => {
    localStorage.setItem('b1_translation_stats', JSON.stringify(stats));
  }, [stats]);

  // Initialize Web Speech Recognition
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
        console.error('Speech recognition error in Translations:', event.error);
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

  const toggleSpeech = () => {
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

  // Generate a new translation exercise
  const generateNewExercise = async (topicId = selectedTopic, lengthId = selectedLength) => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setUserTranslation('');
    setEvaluation(null);
    setIsGenerating(true);
    setFallbackNotice('');

    const targetTopicObj = TRANSLATION_TOPICS.find(t => t.id === topicId) || TRANSLATION_TOPICS[0];
    const targetLengthObj = SENTENCE_LENGTHS.find(l => l.id === lengthId) || SENTENCE_LENGTHS[0];

    // Pick randomized variation vectors (Scenario domain, rhetorical style, topic sub-focus)
    const randomScenario = SCENARIO_DOMAINS[Math.floor(Math.random() * SCENARIO_DOMAINS.length)];
    const randomPerspective = PERSPECTIVE_STYLES[Math.floor(Math.random() * PERSPECTIVE_STYLES.length)];
    const subFocusList = TOPIC_SUB_FOCUSES[topicId] || [];
    const randomSubFocus = subFocusList.length > 0
      ? subFocusList[Math.floor(Math.random() * subFocusList.length)]
      : null;

    // If no API key is provided, choose from curated offline collection
    if (!apiKey) {
      let filtered = topicId === 'mixed'
        ? OFFLINE_EXERCISES
        : OFFLINE_EXERCISES.filter(ex => ex.topic === topicId);

      // Filter by length if specified
      if (lengthId !== 'auto') {
        const lengthFiltered = filtered.filter(ex => {
          const count = ex.english.trim().split(/\s+/).length;
          if (lengthId === 'small') return count <= 9;
          if (lengthId === 'medium') return count >= 10 && count <= 16;
          if (lengthId === 'long') return count >= 17;
          return true;
        });
        if (lengthFiltered.length > 0) {
          filtered = lengthFiltered;
        }
      }

      const pool = filtered.length > 0 ? filtered : OFFLINE_EXERCISES;
      // Avoid immediate repeats of recently visited exercises
      const unvisited = pool.filter(ex => !recentSentencesRef.current.includes(ex.english));
      const finalPool = unvisited.length > 0 ? unvisited : pool;
      const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
      if (pick) {
        recentSentencesRef.current = [pick.english, ...recentSentencesRef.current.filter(s => s !== pick.english)].slice(0, 10);
      }
      setCurrentExercise(pick);
      setIsGenerating(false);
      return;
    }

    const lengthInstruction = lengthId === 'auto'
      ? "Sentence Length: Natural B1 length (approx. 10 to 18 words)."
      : `Sentence Length Requirement: Strictly ${targetLengthObj.label.toUpperCase()} (${targetLengthObj.wordRange}). ${
          lengthId === 'small'
            ? 'Must be a concise, short sentence between 5 and 9 words long.'
            : lengthId === 'medium'
            ? 'Must be a medium-length sentence between 10 and 16 words long.'
            : 'Must be a longer, more elaborate multi-clause sentence between 17 and 26 words long.'
        }`;

    const recentExList = recentSentencesRef.current;
    const recentAvoidBlock = recentExList.length > 0
      ? `\nDO NOT repeat, mirror, or paraphrase any of these recently generated exercises. Pick an entirely different situation, different vocabulary, and different verbs:\n${recentExList.slice(0, 6).map((s, idx) => `  ${idx + 1}. "${s}"`).join('\n')}\n`
      : '';

    const systemInstruction = `You are an expert German teacher creating varied, dynamic B1 Goethe/Telc certification translation exercises.
The user wants to practice translating an English sentence into natural, grammatically correct German at B1 level.

Topic required: "${targetTopicObj.label}: ${targetTopicObj.desc}".
${randomSubFocus ? `Specific Grammar Nuance to test: "${randomSubFocus}".` : ''}
Required Scenario Domain: "${randomScenario.domain}" (Aspects: ${randomScenario.details}).
Required Sentence Style / Perspective: "${randomPerspective}".

CRITICAL VARIETY & DIVERSITY RULES:
1. NEVER produce generic, cliché textbook sentences (strictly avoid repetitive tropes like missed trains, delayed doctor appointments, put the book on the table, if the weather is good we walk, call after work).
2. Root the exercise authentically in the required scenario domain ("${randomScenario.domain}") using realistic, practical B1 vocabulary.
3. Use diverse grammatical subjects and persons (do NOT always use "I" / "ich"; use "wir", "der Techniker", "meine Kollegin", "der Vermieter", "die Ärztin", "Sie" formal, "die Kunden", etc.).
4. Use diverse sentence structures (direct/indirect questions, temporal sequences with 'nachdem/bevor', concessive clauses with 'obwohl', causal clauses with 'da/weil', infinitive constructions with 'um...zu' or 'ohne...zu', relative clauses, etc.).
${recentAvoidBlock}
${lengthInstruction}

Instructions:
1. Provide a realistic, natural English sentence testing the selected B1 topic and designated scenario domain.
2. If the sentence includes difficult, formal, or specialized nouns, verbs, or prepositions, provide their German equivalents as hints (including article/gender for nouns and auxiliary/participle for verbs).
3. Provide 2-3 natural German reference translations.
4. Explain the key grammar focus tested in German.

You MUST respond strictly with a valid JSON object matching this schema:
{
  "english": "English sentence here",
  "topicName": "${targetTopicObj.label}",
  "lengthType": "${lengthId}",
  "scenarioDomain": "${randomScenario.domain}",
  "grammarFocus": "Brief German explanation of what grammar pattern is being tested",
  "hints": [
    { "english": "difficult word or verb", "german": "der/die/das ... or verb (mit Präposition)" }
  ],
  "referenceTranslations": [
    "Ideal German translation 1",
    "Alternative valid German translation 2"
  ]
}

Respond ONLY with raw JSON. No markdown ticks, no preamble.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: `Generate a new, distinct B1 German translation exercise for topic: ${targetTopicObj.label}.
Context Domain: ${randomScenario.domain}.
Sentence Style: ${randomPerspective}.
Target length: ${targetLengthObj.label} (${targetLengthObj.wordRange}).
Ensure the sentence is creative, natural, and completely different from standard textbook clichés.`,
        systemInstruction,
        generationConfig: {
          temperature: 0.88,
          topP: 0.95
        },
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war ausgelastet. Wechsle zu ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Übung über Backup-Modell (${usedModel}) generiert.`);
        setTimeout(() => setFallbackNotice(''), 6000);
      }

      const parsed = parsedJson || JSON.parse(rawJson);
      if (!parsed.english || !parsed.referenceTranslations) {
        throw new Error("Invalid exercise structure returned.");
      }
      recentSentencesRef.current = [
        parsed.english,
        ...recentSentencesRef.current.filter(s => s !== parsed.english)
      ].slice(0, 10);
      setCurrentExercise(parsed);
    } catch (err) {
      console.error("Failed to generate exercise with Gemini:", err);
      // Fallback to offline collection on error
      const filtered = topicId === 'mixed'
        ? OFFLINE_EXERCISES
        : OFFLINE_EXERCISES.filter(ex => ex.topic === topicId);
      const pool = filtered.length > 0 ? filtered : OFFLINE_EXERCISES;
      const unvisited = pool.filter(ex => !recentSentencesRef.current.includes(ex.english));
      const finalPool = unvisited.length > 0 ? unvisited : pool;
      const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
      if (pick) {
        recentSentencesRef.current = [pick.english, ...recentSentencesRef.current.filter(s => s !== pick.english)].slice(0, 10);
      }
      setCurrentExercise(pick);
      setFallbackNotice("⚠️ Offline-Übung geladen, da keine Verbindung zu Gemini möglich war.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Evaluate the user's translation
  const handleCheckTranslation = async (e) => {
    if (e) e.preventDefault();
    if (!userTranslation.trim() || !currentExercise) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setIsEvaluating(true);
    setFallbackNotice('');

    // If no API key, use client-side heuristic comparison
    if (!apiKey) {
      const cleanUser = userTranslation.trim().toLowerCase().replace(/[.,!?;:]/g, '');
      const matches = currentExercise.referenceTranslations.some(ref => {
        const cleanRef = ref.toLowerCase().replace(/[.,!?;:]/g, '');
        return cleanRef === cleanUser;
      });

      const fallbackEval = {
        isCorrect: matches,
        score: matches ? 100 : 70,
        rating: matches ? 'excellent' : 'good',
        bestTranslation: currentExercise.referenceTranslations[0],
        alternativeTranslations: currentExercise.referenceTranslations.slice(1),
        feedback: matches 
          ? "Perfekt übersetzt! Deine Formulierung entspricht genau der Musterlösung." 
          : "Guter Versuch! Vergleiche deine Antwort mit den Musterlösungen unten.",
        corrections: matches ? [] : [
          {
            original: userTranslation,
            corrected: currentExercise.referenceTranslations[0],
            explanation: `Beachte den Fokus: ${currentExercise.grammarFocus || 'Korrekte Satzstellung und Kasus'}.`
          }
        ],
        grammarNotes: currentExercise.grammarFocus || "Achte auf Wortstellung und korrekte Konjugation."
      };

      setEvaluation(fallbackEval);
      setStats(prev => ({
        totalSolved: prev.totalSolved + 1,
        correct: matches ? prev.correct + 1 : prev.correct,
        streak: matches ? prev.streak + 1 : 0
      }));
      setIsEvaluating(false);
      return;
    }

    const evalSystemInstruction = `You are a strict yet encouraging German language examiner evaluating a B1 student's translation.
English Source: "${currentExercise.english}"
Reference Translations: ${JSON.stringify(currentExercise.referenceTranslations)}
Grammar Focus: "${currentExercise.grammarFocus}"

The user has translated it as:
"${userTranslation.trim()}"

Evaluate the user's German translation accurately:
1. Is it grammatically correct German? Does it preserve the meaning of the English source?
2. Assess word order (Verbposition in Haupt- und Nebensätzen), case endings (Akkusativ, Dativ, Genitiv), tense, and vocabulary.
3. Minor punctuation or capitalization slips should deduct only 5-10 points. Grammar errors (wrong case, misplaced verb, wrong auxiliary) should deduct accordingly.
4. Provide constructive feedback in German suitable for a B1 learner.
5. If there are mistakes, break them down clearly into: original part, corrected part, and the grammatical explanation.

Output ONLY a JSON object matching this schema:
{
  "isCorrect": boolean (true if score >= 80),
  "score": integer (0 to 100),
  "rating": "excellent" | "good" | "needs_work",
  "bestTranslation": "Best natural German sentence",
  "alternativeTranslations": ["Alternative valid sentence"],
  "feedback": "Encouraging, clear explanation in German (2-3 sentences)",
  "corrections": [
    {
      "original": "part with mistake",
      "corrected": "corrected version",
      "explanation": "Why this change is needed"
    }
  ],
  "grammarNotes": "Quick rule reminder for future practice"
}
Output raw JSON only.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: `Evaluate this translation: "${userTranslation.trim()}"`,
        systemInstruction: evalSystemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war ausgelastet. Wechsle zu ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Bewertung über Backup-Modell (${usedModel}) generiert.`);
        setTimeout(() => setFallbackNotice(''), 6000);
      }

      const evalData = parsedJson || JSON.parse(rawJson);
      setEvaluation(evalData);

      setStats(prev => ({
        totalSolved: prev.totalSolved + 1,
        correct: evalData.isCorrect ? prev.correct + 1 : prev.correct,
        streak: evalData.isCorrect ? prev.streak + 1 : 0
      }));
    } catch (err) {
      console.error("Evaluation error:", err);
      setFallbackNotice(`⚠️ Fehler bei der Bewertung: ${err.message}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Load first exercise on mount
  useEffect(() => {
    generateNewExercise(selectedTopic, selectedLength);
  }, []);

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
    if (window.confirm("Are you sure you want to remove the Gemini API Key from this browser?")) {
      localStorage.removeItem('b1_gemini_api_key');
      setApiKey('');
      setShowKeyInput(true);
    }
  };

  const speakText = (text) => {
    if (window.speakGerman) {
      window.speakGerman(text);
    }
  };

  return (
    <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '850px', width: '100%', gap: '20px' }}>
      
      {/* Top Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🌐</span>
            <span>B1 Deutsch Übersetzer & Satz-Trainer</span>
          </div>
          {/* Quick Streak & Solved counter */}
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
            <span style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#facc15', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
              🔥 Streak: {stats.streak}
            </span>
            <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              ✓ {stats.correct}/{stats.totalSolved}
            </span>
          </div>
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
            title="Choose Gemini Model"
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
            title="Manage Gemini API Key"
            style={{ fontSize: '12px', padding: '4px 10px', height: '28px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', borderRadius: '8px' }}
          >
            ⚙️ Key
          </button>
        </div>
      </div>

      {/* Fallback notification indicator */}
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
          gap: '8px'
        }}>
          <span>🔄</span>
          <span>{fallbackNotice}</span>
        </div>
      )}

      {/* API Key Modal if requested */}
      {showKeyInput && (
        <div className="glass-card" style={{ width: '100%', padding: '20px', background: 'rgba(20, 22, 35, 0.95)', border: '1px solid var(--color-conn)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>🔑 Gemini API-Schlüssel</h4>
            {apiKey && (
              <button type="button" onClick={() => setShowKeyInput(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.5 }}>
            Gib deinen kostenlosen Google Gemini API-Schlüssel ein, um unbegrenzte, abwechslungsreiche B1-Übungen und präzises Grammatik-Feedback zu erhalten.
          </p>
          <form onSubmit={handleSaveKey} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              style={{
                flexGrow: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#fff',
                fontSize: '13px'
              }}
            />
            <button type="submit" className="feedback-btn good" style={{ padding: '10px 20px', fontSize: '13px', width: 'auto', maxWidth: 'none', minHeight: 'auto' }}>
              Speichern
            </button>
          </form>
        </div>
      )}

      {/* Topic Selection Carousel / Pill Bar */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: '700' }}>
            Grammatik-Thema / Topic Focus
          </span>
          <button
            type="button"
            onClick={() => generateNewExercise(selectedTopic, selectedLength)}
            disabled={isGenerating}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-verb)',
              fontSize: '12px',
              fontWeight: '600',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>🔄</span>
            <span>{isGenerating ? 'Generiere...' : 'Neue Übung'}</span>
          </button>
        </div>

        <div style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          paddingBottom: '6px',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none'
        }}>
          {TRANSLATION_TOPICS.map(topic => {
            const isSelected = selectedTopic === topic.id;
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => {
                  setSelectedTopic(topic.id);
                  generateNewExercise(topic.id, selectedLength);
                }}
                disabled={isGenerating}
                style={{
                  flexShrink: 0,
                  padding: '7px 14px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: isSelected ? '700' : '500',
                  border: isSelected ? '1px solid var(--color-conn)' : '1px solid var(--border-color)',
                  background: isSelected 
                    ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.3))' 
                    : 'rgba(255, 255, 255, 0.03)',
                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isSelected ? '0 2px 8px rgba(139, 92, 246, 0.2)' : 'none'
                }}
                title={topic.desc}
              >
                {topic.label}
              </button>
            );
          })}
        </div>

        {/* Sentence Length Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: '700' }}>
              Satzlänge / Sentence Length
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {SENTENCE_LENGTHS.find(l => l.id === selectedLength)?.desc}
            </span>
          </div>

          <div style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            paddingBottom: '4px',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none'
          }}>
            {SENTENCE_LENGTHS.map(len => {
              const isSelected = selectedLength === len.id;
              return (
                <button
                  key={len.id}
                  type="button"
                  onClick={() => {
                    setSelectedLength(len.id);
                    localStorage.setItem('b1_translation_length', len.id);
                    generateNewExercise(selectedTopic, len.id);
                  }}
                  disabled={isGenerating}
                  style={{
                    flexShrink: 0,
                    padding: '6px 14px',
                    borderRadius: '18px',
                    fontSize: '12px',
                    fontWeight: isSelected ? '700' : '500',
                    border: isSelected ? '1px solid var(--color-noun)' : '1px solid var(--border-color)',
                    background: isSelected 
                      ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(234, 88, 12, 0.25))' 
                      : 'rgba(255, 255, 255, 0.03)',
                    color: isSelected ? '#fff' : 'var(--text-secondary)',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: isSelected ? '0 2px 8px rgba(245, 158, 11, 0.2)' : 'none'
                  }}
                  title={`${len.desc} (${len.wordRange})`}
                >
                  <span>{len.label}</span>
                  <span style={{ fontSize: '10px', opacity: 0.75, marginLeft: '6px' }}>
                    ({len.wordRange})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Exercise Card */}
      <div className="glass-card" style={{ width: '100%', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
        
        {isGenerating ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '50px 20px', gap: '16px' }}>
            <div className="voice-pulse" style={{ width: '48px', height: '48px', border: '3px solid var(--color-conn)', borderRadius: '50%', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
              Generiere B1-Übersetzungsaufgabe mit Gemini...
            </p>
          </div>
        ) : currentExercise ? (
          <>
            {/* Exercise Source Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '3px 10px',
                    borderRadius: '12px',
                    background: 'rgba(139, 92, 246, 0.15)',
                    color: 'var(--color-conn)',
                    border: '1px solid rgba(139, 92, 246, 0.3)'
                  }}>
                    {currentExercise.topicName || 'B1 German Exercise'}
                  </span>
                  {currentExercise.scenarioDomain && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      padding: '3px 9px',
                      borderRadius: '12px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      color: 'var(--color-verb)',
                      border: '1px solid rgba(59, 130, 246, 0.25)'
                    }}>
                      Context: {currentExercise.scenarioDomain}
                    </span>
                  )}
                  {currentExercise.english && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      padding: '3px 9px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-color)'
                    }}>
                      {(() => {
                        const wordCount = currentExercise.english.trim().split(/\s+/).length;
                        const lenObj = SENTENCE_LENGTHS.find(l => l.id === selectedLength);
                        return `${lenObj ? lenObj.label : 'Length'}: ${wordCount} words`;
                      })()}
                    </span>
                  )}
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Translate to German
                  </span>
                </div>

                {/* Hints Toggle */}
                {currentExercise.hints && currentExercise.hints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHints(prev => !prev)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: showHints ? 'var(--color-noun)' : 'var(--text-muted)',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>💡</span>
                    <span>{showHints ? 'Wortschatz-Tipps ausblenden' : 'Wortschatz-Tipps anzeigen'}</span>
                  </button>
                )}
              </div>

              {/* English Prompt Sentence */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '14px',
                padding: '18px 20px',
                fontSize: '17px',
                fontWeight: '600',
                color: '#fff',
                lineHeight: 1.5,
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
              }}>
                "{currentExercise.english}"
              </div>

              {/* Vocabulary Hints Pill Box */}
              {showHints && currentExercise.hints && currentExercise.hints.length > 0 && (
                <div style={{
                  background: 'rgba(245, 158, 11, 0.05)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>💡</span>
                    <span>Wortschatz-Tipps / Vocabulary Hints:</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {currentExercise.hints.map((hint, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '8px',
                          padding: '4px 10px',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>{hint.english}:</span>
                        <strong style={{ color: '#fff' }}>{hint.german}</strong>
                        <button
                          type="button"
                          onClick={() => speakText(hint.german.replace(/\(.*?\)/g, ''))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '11px', color: 'var(--color-verb)' }}
                          title="Aussprache hören"
                        >
                          🔊
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Translation Input Area */}
            <form onSubmit={handleCheckTranslation} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <textarea
                  value={userTranslation}
                  onChange={(e) => setUserTranslation(e.target.value)}
                  placeholder="✍️ Sprich oder tippe deine deutsche Übersetzung hier..."
                  rows={3}
                  disabled={isEvaluating}
                  style={{
                    width: '100%',
                    padding: '14px 48px 14px 16px',
                    borderRadius: '14px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: isListening ? '1.5px solid #ef4444' : '1px solid var(--border-color)',
                    color: '#fff',
                    fontSize: '15px',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    outline: 'none',
                    boxShadow: isListening ? '0 0 14px rgba(239, 68, 68, 0.3)' : 'none'
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      handleCheckTranslation(e);
                    }
                  }}
                />

                {/* Voice-to-Text Microphone Button inside input corner */}
                <button
                  type="button"
                  onClick={toggleSpeech}
                  title={isListening ? "Aufnahme stoppen" : "Auf Deutsch sprechen (Voice-to-Text)"}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '12px',
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isListening ? '#ef4444' : 'rgba(255, 255, 255, 0.08)',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    transition: 'all 0.2s ease',
                    boxShadow: isListening ? '0 0 10px rgba(239, 68, 68, 0.6)' : 'none'
                  }}
                >
                  {isListening ? '⏹️' : '🎙️'}
                </button>
              </div>

              {/* Listening Active Pulse Banner */}
              {isListening && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: '#ef4444',
                  fontWeight: '600',
                  animation: 'pulse 1.5s infinite'
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                  <span>Zuhören aktiv... Sprich deinen deutschen Satz (z.B. "Gestern musste ich...")</span>
                </div>
              )}

              {/* Action Buttons Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {userTranslation && (
                    <button
                      type="button"
                      onClick={() => setUserTranslation('')}
                      style={{
                        padding: '8px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        color: 'var(--text-secondary)',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Löschen
                    </button>
                  )}
                  {evaluation && (
                    <button
                      type="button"
                      onClick={() => generateNewExercise(selectedTopic, selectedLength)}
                      className="nav-button"
                      style={{ padding: '8px 16px', fontSize: '13px', background: 'rgba(255, 255, 255, 0.06)' }}
                    >
                      Nächste Übung ➔
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!userTranslation.trim() || isEvaluating}
                  className="feedback-btn good"
                  style={{
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '700',
                    width: 'auto',
                    maxWidth: 'none',
                    minHeight: 'auto',
                    opacity: (!userTranslation.trim() || isEvaluating) ? 0.5 : 1,
                    cursor: (!userTranslation.trim() || isEvaluating) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isEvaluating ? 'Überprüfe Übersetzung...' : 'Übersetzung prüfen ✨'}
                </button>
              </div>
            </form>

            {/* Evaluation Results Card */}
            {evaluation && (
              <div style={{
                marginTop: '10px',
                padding: '20px',
                borderRadius: '16px',
                background: evaluation.isCorrect ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: evaluation.isCorrect ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                {/* Result Status Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>
                      {evaluation.isCorrect ? '🎉' : '✍️'}
                    </span>
                    <span style={{
                      fontSize: '15px',
                      fontWeight: '800',
                      color: evaluation.isCorrect ? '#4ade80' : '#f87171'
                    }}>
                      {evaluation.score >= 90 ? 'Hervorragend! / Excellent' : (evaluation.isCorrect ? 'Sehr gut!' : 'Verbesserungswürdig')}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: evaluation.isCorrect ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: evaluation.isCorrect ? '#4ade80' : '#f87171',
                      fontWeight: '700'
                    }}>
                      {evaluation.score}/100
                    </span>
                  </div>

                  {/* Audio button for best translation */}
                  <button
                    type="button"
                    onClick={() => speakText(evaluation.bestTranslation)}
                    className="sound-btn"
                    title="Musterlösung auf Deutsch anhören"
                    style={{ fontSize: '13px', padding: '6px 12px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '10px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span>🔊</span>
                    <span>Anhören</span>
                  </button>
                </div>

                {/* Explanation text */}
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                  {evaluation.feedback}
                </p>

                {/* Corrections breakdown if any */}
                {evaluation.corrections && evaluation.corrections.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                      Korrekturen / Detailed Notes:
                    </span>
                    {evaluation.corrections.map((corr, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(0, 0, 0, 0.25)',
                          borderRadius: '10px',
                          padding: '10px 14px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          fontSize: '13px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ color: '#f87171', textDecoration: 'line-through' }}>{corr.original}</span>
                          <span style={{ color: 'var(--text-muted)' }}>➔</span>
                          <strong style={{ color: '#4ade80' }}>{corr.corrected}</strong>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {corr.explanation}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reference translations */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Musterlösung / Ideal Translations:
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>1. {evaluation.bestTranslation}</span>
                      <button
                        type="button"
                        onClick={() => speakText(evaluation.bestTranslation)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 6px', color: 'var(--color-verb)' }}
                        title="Anhören"
                      >
                        🔊
                      </button>
                    </div>
                    {evaluation.alternativeTranslations && evaluation.alternativeTranslations.map((alt, idx) => (
                      <div key={idx} style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>2. {alt}</span>
                        <button
                          type="button"
                          onClick={() => speakText(alt)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px 6px', color: 'var(--text-secondary)' }}
                          title="Anhören"
                        >
                          🔊
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom button: next exercise */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => generateNewExercise(selectedTopic, selectedLength)}
                    className="feedback-btn good"
                    style={{ padding: '10px 22px', fontSize: '13px', width: 'auto', maxWidth: 'none', minHeight: 'auto' }}
                  >
                    Nächster Satz ➔
                  </button>
                </div>

              </div>
            )}
          </>
        ) : null}

      </div>

    </div>
  );
}
