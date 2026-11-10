// 65 High-Frequency B1 Verbs with Fixed Prepositions, Cases, and Pronominal Adverbs (da- / wo-)
// Organized into 9 conceptual preposition groups

export const FIXED_VERBS_GROUPS = [
  {
    id: 'auf_akk',
    title: 'auf + Akkusativ',
    concept: 'Expectation, Target & Focus',
    prep: 'auf',
    defaultCase: 'Akk',
    verbs: [
      { id: 1, tier: 1, verb: 'warten', prep: 'auf', case: 'Akk', meaning: 'to wait for', daWo: 'darauf / worauf' },
      { id: 2, tier: 1, verb: 'sich freuen', prep: 'auf', case: 'Akk', meaning: 'to look forward to (future)', daWo: 'darauf / worauf' },
      { id: 3, tier: 1, verb: 'hoffen', prep: 'auf', case: 'Akk', meaning: 'to hope for', daWo: 'darauf / worauf' },
      { id: 4, tier: 1, verb: 'achten', prep: 'auf', case: 'Akk', meaning: 'to pay attention to', daWo: 'darauf / worauf' },
      { id: 5, tier: 1, verb: 'sich vorbereiten', prep: 'auf', case: 'Akk', meaning: 'to prepare for', daWo: 'darauf / worauf' },
      { id: 6, tier: 1, verb: 'verzichten', prep: 'auf', case: 'Akk', meaning: 'to give up / do without', daWo: 'darauf / worauf' },
      { id: 7, tier: 1, verb: 'reagieren', prep: 'auf', case: 'Akk', meaning: 'to react to', daWo: 'darauf / worauf' },
      { id: 8, tier: 1, verb: 'ankommen', prep: 'auf', case: 'Akk', meaning: 'to depend on (es kommt an auf...)', daWo: 'darauf / worauf' },
      { id: 9, tier: 1, verb: 'sich verlassen', prep: 'auf', case: 'Akk', meaning: 'to rely on', daWo: 'darauf / worauf' },
      { id: 10, tier: 2, verb: 'sich konzentrieren', prep: 'auf', case: 'Akk', meaning: 'to concentrate on', daWo: 'darauf / worauf' },
      { id: 11, tier: 2, verb: 'bestehen', prep: 'auf', case: 'Akk', meaning: 'to insist on', daWo: 'darauf / worauf' },
      { id: 12, tier: 2, verb: 'hinweisen', prep: 'auf', case: 'Akk', meaning: 'to point out / indicate', daWo: 'darauf / worauf' }
    ]
  },
  {
    id: 'ueber_akk',
    title: 'über + Akkusativ',
    concept: 'Topics, Thoughts & Emotional Reactions',
    prep: 'über',
    defaultCase: 'Akk',
    verbs: [
      { id: 13, tier: 1, verb: 'sprechen / reden', prep: 'über', case: 'Akk', meaning: 'to talk about', daWo: 'darüber / worüber' },
      { id: 14, tier: 1, verb: 'diskutieren', prep: 'über', case: 'Akk', meaning: 'to discuss', daWo: 'darüber / worüber' },
      { id: 15, tier: 1, verb: 'nachdenken', prep: 'über', case: 'Akk', meaning: 'to reflect / ponder on', daWo: 'darüber / worüber' },
      { id: 16, tier: 1, verb: 'sich freuen', prep: 'über', case: 'Akk', meaning: 'to be pleased about (present/past)', daWo: 'darüber / worüber' },
      { id: 17, tier: 1, verb: 'sich ärgern', prep: 'über', case: 'Akk', meaning: 'to be annoyed / angry about', daWo: 'darüber / worüber' },
      { id: 18, tier: 1, verb: 'sich beschweren', prep: 'über', case: 'Akk', meaning: 'to complain about', daWo: 'darüber / worüber' },
      { id: 19, tier: 1, verb: 'sich informieren', prep: 'über', case: 'Akk', meaning: 'to inform oneself about', daWo: 'darüber / worüber' },
      { id: 20, tier: 1, verb: 'lachen', prep: 'über', case: 'Akk', meaning: 'to laugh about', daWo: 'darüber / worüber' },
      { id: 21, tier: 2, verb: 'berichten', prep: 'über', case: 'Akk', meaning: 'to report about', daWo: 'darüber / worüber' },
      { id: 22, tier: 2, verb: 'sich wundern', prep: 'über', case: 'Akk', meaning: 'to be surprised / wonder at', daWo: 'darüber / worüber' },
      { id: 23, tier: 2, verb: 'streiten', prep: 'über', case: 'Akk', meaning: 'to argue about', daWo: 'darüber / worüber' },
      { id: 24, tier: 2, verb: 'weinen', prep: 'über', case: 'Akk', meaning: 'to cry over', daWo: 'darüber / worüber' }
    ]
  },
  {
    id: 'fuer_akk',
    title: 'für + Akkusativ',
    concept: 'Advocacy, Purpose & Benefit',
    prep: 'für',
    defaultCase: 'Akk',
    verbs: [
      { id: 25, tier: 1, verb: 'sich interessieren', prep: 'für', case: 'Akk', meaning: 'to be interested in', daWo: 'dafür / wofür' },
      { id: 26, tier: 1, verb: 'danken / sich bedanken', prep: 'für', case: 'Akk', meaning: 'to thank for', daWo: 'dafür / wofür' },
      { id: 27, tier: 1, verb: 'sich entscheiden', prep: 'für', case: 'Akk', meaning: 'to decide in favor of', daWo: 'dafür / wofür' },
      { id: 28, tier: 1, verb: 'ausgeben', prep: 'für', case: 'Akk', meaning: 'to spend (money) on', daWo: 'dafür / wofür' },
      { id: 29, tier: 1, verb: 'kämpfen', prep: 'für', case: 'Akk', meaning: 'to fight for', daWo: 'dafür / wofür' },
      { id: 30, tier: 2, verb: 'halten', prep: 'für', case: 'Akk', meaning: 'to consider / deem to be (ich halte das für...)', daWo: 'dafür / wofür' },
      { id: 31, tier: 2, verb: 'sorgen', prep: 'für', case: 'Akk', meaning: 'to look after / care for', daWo: 'dafür / wofür' },
      { id: 32, tier: 2, verb: 'sein (zuständig / verantwortlich)', prep: 'für', case: 'Akk', meaning: 'to be responsible for', daWo: 'dafür / wofür' }
    ]
  },
  {
    id: 'um_akk',
    title: 'um + Akkusativ',
    concept: 'Effort, Contest & Inquiry',
    prep: 'um',
    defaultCase: 'Akk',
    verbs: [
      { id: 33, tier: 1, verb: 'bitten', prep: 'um', case: 'Akk', meaning: 'to ask / request for', daWo: 'darum / worum' },
      { id: 34, tier: 1, verb: 'sich bewerben', prep: 'um', case: 'Akk', meaning: 'to apply for (a job)', daWo: 'darum / worum' },
      { id: 35, tier: 1, verb: 'sich kümmern', prep: 'um', case: 'Akk', meaning: 'to take care of / look after', daWo: 'darum / worum' },
      { id: 36, tier: 1, verb: 'es geht', prep: 'um', case: 'Akk', meaning: 'it is about (es geht um...)', daWo: 'darum / worum' },
      { id: 37, tier: 2, verb: 'es handelt sich', prep: 'um', case: 'Akk', meaning: 'it is a matter of / it concerns', daWo: 'darum / worum' },
      { id: 38, tier: 2, verb: 'streiten', prep: 'um', case: 'Akk', meaning: 'to quarrel / fight over', daWo: 'darum / worum' }
    ]
  },
  {
    id: 'an_akk_dat',
    title: 'an + Akkusativ vs. an + Dativ',
    concept: 'Mental Link vs. Status / Physical',
    prep: 'an',
    defaultCase: 'Both',
    verbs: [
      { id: 39, tier: 1, verb: 'denken', prep: 'an', case: 'Akk', meaning: 'to think of', daWo: 'daran / woran' },
      { id: 40, tier: 1, verb: 'sich erinnern', prep: 'an', case: 'Akk', meaning: 'to remember', daWo: 'daran / woran' },
      { id: 41, tier: 1, verb: 'glauben', prep: 'an', case: 'Akk', meaning: 'to believe in', daWo: 'daran / woran' },
      { id: 42, tier: 2, verb: 'sich gewöhnen', prep: 'an', case: 'Akk', meaning: 'to get used to', daWo: 'daran / woran' },
      { id: 43, tier: 1, verb: 'teilnehmen', prep: 'an', case: 'Dat', meaning: 'to participate in', daWo: 'daran / woran' },
      { id: 44, tier: 1, verb: 'arbeiten', prep: 'an', case: 'Dat', meaning: 'to work on', daWo: 'daran / woran' },
      { id: 45, tier: 2, verb: 'leiden', prep: 'an', case: 'Dat', meaning: 'to suffer from (a disease)', daWo: 'daran / woran' },
      { id: 46, tier: 2, verb: 'zweifeln', prep: 'an', case: 'Dat', meaning: 'to doubt', daWo: 'daran / woran' }
    ]
  },
  {
    id: 'mit_dat',
    title: 'mit + Dativ',
    concept: 'Interaction, Completion & Handling',
    prep: 'mit',
    defaultCase: 'Dat',
    verbs: [
      { id: 47, tier: 1, verb: 'anfangen / beginnen', prep: 'mit', case: 'Dat', meaning: 'to begin with', daWo: 'damit / womit' },
      { id: 48, tier: 1, verb: 'aufhören', prep: 'mit', case: 'Dat', meaning: 'to stop / quit doing', daWo: 'damit / womit' },
      { id: 49, tier: 1, verb: 'sprechen / telefonieren', prep: 'mit', case: 'Dat', meaning: 'to speak / talk with (a person)', daWo: 'damit / womit' },
      { id: 50, tier: 1, verb: 'umgehen', prep: 'mit', case: 'Dat', meaning: 'to deal with / handle', daWo: 'damit / womit' },
      { id: 51, tier: 2, verb: 'rechnen', prep: 'mit', case: 'Dat', meaning: 'to expect / count on', daWo: 'damit / womit' },
      { id: 52, tier: 2, verb: 'sich beschäftigen', prep: 'mit', case: 'Dat', meaning: 'to occupy oneself with', daWo: 'damit / womit' }
    ]
  },
  {
    id: 'von_dat',
    title: 'von + Dativ',
    concept: 'Origin, Dependency & Evaluation',
    prep: 'von',
    defaultCase: 'Dat',
    verbs: [
      { id: 53, tier: 1, verb: 'abhängen', prep: 'von', case: 'Dat', meaning: 'to depend on', daWo: 'davon / wovon' },
      { id: 54, tier: 1, verb: 'erzählen', prep: 'von', case: 'Dat', meaning: 'to tell / recount of', daWo: 'davon / wovon' },
      { id: 55, tier: 1, verb: 'träumen', prep: 'von', case: 'Dat', meaning: 'to dream of', daWo: 'davon / wovon' },
      { id: 56, tier: 1, verb: 'halten', prep: 'von', case: 'Dat', meaning: 'to think of / have an opinion on', daWo: 'davon / wovon' },
      { id: 57, tier: 2, verb: 'handeln', prep: 'von', case: 'Dat', meaning: 'to be about (book/film theme)', daWo: 'davon / wovon' },
      { id: 58, tier: 2, verb: 'überzeugen', prep: 'von', case: 'Dat', meaning: 'to convince of', daWo: 'davon / wovon' }
    ]
  },
  {
    id: 'zu_dat',
    title: 'zu + Dativ',
    concept: 'Connection, Result & Purpose',
    prep: 'zu',
    defaultCase: 'Dat',
    verbs: [
      { id: 59, tier: 1, verb: 'gehören', prep: 'zu', case: 'Dat', meaning: 'to belong to', daWo: 'dazu / wozu' },
      { id: 60, tier: 1, verb: 'passen', prep: 'zu', case: 'Dat', meaning: 'to match / suit', daWo: 'dazu / wozu' },
      { id: 61, tier: 1, verb: 'gratulieren', prep: 'zu', case: 'Dat', meaning: 'to congratulate on', daWo: 'dazu / wozu' },
      { id: 62, tier: 1, verb: 'einladen', prep: 'zu', case: 'Dat', meaning: 'to invite to', daWo: 'dazu / wozu' },
      { id: 63, tier: 2, verb: 'führen', prep: 'zu', case: 'Dat', meaning: 'to lead to', daWo: 'dazu / wozu' },
      { id: 64, tier: 2, verb: 'beitragen', prep: 'zu', case: 'Dat', meaning: 'to contribute to', daWo: 'dazu / wozu' }
    ]
  },
  {
    id: 'nach_vor_dat',
    title: 'nach + Dativ & vor + Dativ',
    concept: 'Inquiry vs. Caution / Fear',
    prep: 'nach / vor',
    defaultCase: 'Dat',
    verbs: [
      { id: 65, tier: 1, verb: 'fragen', prep: 'nach', case: 'Dat', meaning: 'to ask about / for', daWo: 'danach / wonach' },
      { id: 66, tier: 2, verb: 'suchen', prep: 'nach', case: 'Dat', meaning: 'to search / look for', daWo: 'danach / wonach' },
      { id: 67, tier: 1, verb: 'Angst haben', prep: 'vor', case: 'Dat', meaning: 'to be afraid of', daWo: 'davor / wovor' },
      { id: 68, tier: 2, verb: 'warnen', prep: 'vor', case: 'Dat', meaning: 'to warn against', daWo: 'davor / wovor' }
    ]
  }
];

// Flat list of all 68 items
export const ALL_FIXED_VERBS = FIXED_VERBS_GROUPS.flatMap(group =>
  group.verbs.map(v => ({
    ...v,
    groupId: group.id,
    groupTitle: group.title,
    groupConcept: group.concept,
    formula: `$$\\textbf{${v.verb}} + \\textbf{${v.prep}} + \\textbf{${v.case === 'Akk' ? 'Akkusativ' : 'Dativ'}}$$`
  }))
);

export const formatVerbFormula = (verb, prep, grammarCase) => {
  const caseDisplay = (grammarCase || '').toLowerCase().startsWith('akk') ? 'Akkusativ' : 'Dativ';
  return `$$\\textbf{${verb}} + \\textbf{${prep}} + \\textbf{${caseDisplay}}$$`;
};
