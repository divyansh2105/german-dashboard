# 🇩🇪 Deutsch — B1 German Learning Dashboard

A premium, interactive web application designed to help language learners master B1 German vocabulary, pronunciation, and grammar. Built with React, Vite, and custom Vanilla CSS, the dashboard features glassmorphic designs, responsive animations, and pedagogical workflows tailored for optimal retention.

---

## 🚀 Key Features

### 1. 📖 Vocabulary Explorer & Advanced Filters
* **Over 2,500 B1 Entries**: Dynamic database comprising nouns, verbs, adjectives, and connectors.
* **Alphabetical Index Bar**: Filter words by starting letters. The bar dynamically highlights only letters with available words.
* **Semantic Category Filtering**: Filter nouns and verbs by daily-life situational topics (e.g., *Arbeit, Beruf & Büro*, *Gesundheit*, *Einkaufen, Geld & Finanzen*).
* **Usage Priority Filters**: Filter words by CEFR frequency:
  * 🟢 **High (Priority 1)**: Essential daily-life core words (e.g., *verstehen, brauchen, mieten*).
  * 🟡 **Medium (Priority 2)**: Functional situational words (e.g., *beantragen, verschreiben*).
  * 🔴 **Low (Priority 3)**: Specialized, technical, or niche terms (e.g., *herunterfahren, verurteilen*).
* **Live Word Counter**: Shows a real-time count of visible words matching your active filters.

### 2. 🗣️ Speech Engine & Pronunciation Controller
* **Premium German Voices**: Automatically detects and lets you choose between available system voices (such as macOS *Anna*, Apple Siri, or Chrome *Google Deutsch*).
* **Speech Parameters (Speed & Pitch)**: Customize pronunciation playback speed (rate) and pitch from `0.5x` to `1.5x` using smooth range sliders.
* **Instant Speech Triggers**: Click standard 🔊 buttons next to any word or example sentence to play audio instantly.

### 3. 🗂️ Ankii Leitner Flashcards (Spaced Repetition)
* **3D Card Flip**: Realistic, fluid 3D card rotation animations to test vocabulary and translations.
* **6:3:1 Prioritized Queue**: Practice queues are pedagogical. Every 10 cards drawn contain exactly 6 High priority, 3 Medium priority, and 1 Low priority word (shuffled dynamically).
* **Leitner Splice Loop**: Rate cards as *Hard*, *Medium*, *Easy*, or *Good*. Hard cards are spliced back into the queue 4 slots later for prompt repetition.

### 4. 🎧 Listening Practice (Hördiktat)
* **Word & Sentence Spelling Drills**: Type what you hear. Dictation reads a word or full example sentence out loud.
* **Keyboard Hotkeys**: Press `Spacebar` to repeat audio, and `Enter` to check spelling.
* **Lenient Spelling Check**: Ignorant of trivial punctuation, spacing, and casing differences so you focus on spelling accuracy.
* **Smart Stats Filtering**: Sentence-dictation attempts are kept separate from vocabulary statistics to avoid skewing word mastery.

### 5. 📝 Cloze Practice (Fill in the Blanks)
* **Sentence Contexts**: Fill in the blank using correct spelling. Context is pulled from real B1 example sentences.
* **Prioritized Interleaving**: The sentence queue respects the same 6:3:1 high/medium/low priority ratio.

### 6. 🧩 Satzbau (Reorder Practice)
* **Grammar Sentence Builder**: Drag and drop scrambled German word pills to construct correct German sentences.

### 7. ✍️ Sentence Creator
* **Writing Practice**: Prompted vocabulary cards challenge you to construct your own custom sentences and write translations.

### 8. ⭐ My List & Quick-Add Popover
* **Bookmark Sync**: Save standard vocabulary words to a personalized study list.
* **Custom Vocabulary Creator**: Add custom cards containing custom definitions, category details, and translations.
* **Double-Click Highlight Quick-Add**: Double-click any word anywhere on the dashboard to open a floating popover near the cursor. Star it instantly if it is a B1 word, or write an English translation to save it as a custom card.

### 9. 📈 Progress & Streaks Dashboard
* **Streaks Tracking**: Tracks daily practice streaks and review counts.
* **Progress Bars**: Detailed progress metrics for nouns, verbs, adjectives, and connectors.

### 10. 📱 Aesthetic & Mobile Responsive Design
* **Glassmorphism Design**: High-contrast, dark mode layout with glowing gradient backgrounds.
* **Horizontal Nav rails**: Main tabs and alphabetical letter bars format into touch-scrollable, swipeable rails on mobile viewports.
* **Layout Scaling**: A text-scaler controls scaling (70% - 150%) across all components.
* **Viewport Safeguards**: Dynamic columns auto-collapse to single rows on phone viewports. Spacing and forms are optimized to prevent iOS Safari auto-zooming.

---

## 🛠️ Tech Stack & Development

* **Frontend**: React 19, Vite 8
* **Styling**: Vanilla CSS (Modern CSS variables, flexbox, grid, glassmorphism)
* **Build tool**: Rolldown (Vite 8 compiler)
* **Deployment**: Configured for Vercel with single-page application rewriting.

### Running Locally:
```bash
npm install
npm run dev
```

### Production Build:
```bash
npm run build
```
