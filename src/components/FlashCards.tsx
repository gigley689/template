import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Loader2,
  Shuffle,
  ChevronLeft,
  ChevronRight,
  Search,
  RotateCcw,
  CheckCircle2,
  Circle,
  Layers,
  RefreshCw,
  X,
} from 'lucide-react';
import { Document } from '../lib/supabase';

export interface Flashcard {
  topic: string;
  front: string;
  back: string;
}

interface FlashCardsProps {
  documents: Document[];
  notebookId: string;
}

type CardStatus = 'new' | 'known' | 'review';

interface CardWithMeta extends Flashcard {
  id: string;
  status: CardStatus;
}

function loadProgress(notebookId: string): Record<string, CardStatus> {
  try {
    const raw = localStorage.getItem(`flashcards-progress-${notebookId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgress(notebookId: string, progress: Record<string, CardStatus>) {
  try {
    localStorage.setItem(`flashcards-progress-${notebookId}`, JSON.stringify(progress));
  } catch {
    // ignore
  }
}

function makeCardId(card: Flashcard): string {
  return `${card.topic}::${card.front}`.slice(0, 100);
}

function stripCodeFences(raw: string): string {
  let s = raw.trim();
  // Remove markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  } else {
    // Handle cases where fences are present but not at the very start/end
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return s;
}

function parseFlashcards(raw: string): Flashcard[] {
  const cleaned = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.cards)) {
      return parsed.cards.filter(
        (c: Flashcard) => c.front && c.back && c.topic,
      );
    }
  } catch {
    // not valid JSON
  }
  return [];
}

export default function FlashCards({ documents, notebookId }: FlashCardsProps) {
  const [cards, setCards] = useState<CardWithMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTopic, setActiveTopic] = useState<string>('all');
  const [progress, setProgress] = useState<Record<string, CardStatus>>({});
  const [cacheKey, setCacheKey] = useState<string>('');
  const [loadedFromCache, setLoadedFromCache] = useState(false);

  const docKey = useMemo(
    () => documents.map((d) => d.id).sort().join(','),
    [documents],
  );

  // Load from cache or auto-generate
  useEffect(() => {
    if (documents.length === 0) {
      setCards([]);
      return;
    }

    const key = `flashcards-cache-${notebookId}-${docKey}`;
    setCacheKey(key);
    setLoadedFromCache(false);

    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed = parseFlashcards(cached);
        if (parsed.length > 0) {
          const savedProgress = loadProgress(notebookId);
          setProgress(savedProgress);
          const withMeta = parsed.map((c) => ({
            ...c,
            id: makeCardId(c),
            status: savedProgress[makeCardId(c)] || 'new',
          }));
          setCards(withMeta);
          setLoadedFromCache(true);
          return;
        }
      }
    } catch {
      // ignore
    }

    generateCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, notebookId]);

  const generateCards = useCallback(async () => {
    if (documents.length === 0) return;
    setLoading(true);
    setError(null);
    setFlipped(false);
    setCurrentIndex(0);

    try {
      const sources = documents.map((d) => ({
        name: d.name,
        type: d.type,
        content: d.content,
        file_url: d.file_url,
      }));

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            question: 'GENERATE_FLASHCARDS',
            sources,
          }),
        },
      );
      const data = await res.json();
      const parsed = parseFlashcards(data.answer || '');

      if (parsed.length === 0) {
        setError('Could not generate flashcards. Please try again.');
        return;
      }

      const savedProgress = loadProgress(notebookId);
      setProgress(savedProgress);
      const withMeta = parsed.map((c) => ({
        ...c,
        id: makeCardId(c),
        status: savedProgress[makeCardId(c)] || 'new',
      }));
      setCards(withMeta);

      try {
        localStorage.setItem(cacheKey, JSON.stringify(parsed));
      } catch {
        // ignore
      }
    } catch {
      setError('Failed to generate flashcards. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [documents, notebookId, cacheKey]);

  const topics = useMemo(() => {
    const set = new Set(cards.map((c) => c.topic));
    return ['all', ...Array.from(set)];
  }, [cards]);

  const filteredCards = useMemo(() => {
    let result = cards;
    if (activeTopic !== 'all') {
      result = result.filter((c) => c.topic === activeTopic);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.front.toLowerCase().includes(q) ||
          c.back.toLowerCase().includes(q) ||
          c.topic.toLowerCase().includes(q),
      );
    }
    return result;
  }, [cards, activeTopic, search]);

  const stats = useMemo(() => {
    const known = cards.filter((c) => c.status === 'known').length;
    const review = cards.filter((c) => c.status === 'review').length;
    const newCards = cards.filter((c) => c.status === 'new').length;
    return { known, review, newCards, total: cards.length };
  }, [cards]);

  function updateCardStatus(id: string, status: CardStatus) {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status } : c)),
    );
    const newProgress = { ...progress, [id]: status };
    setProgress(newProgress);
    saveProgress(notebookId, newProgress);
  }

  function shuffleCards() {
    setFlipped(false);
    setCurrentIndex(0);
    setCards((prev) => {
      const arr = [...(filteredCards.length > 0 ? filteredCards : prev)];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
  }

  function resetProgress() {
    const cleared: Record<string, CardStatus> = {};
    setProgress(cleared);
    saveProgress(notebookId, cleared);
    setCards((prev) => prev.map((c) => ({ ...c, status: 'new' })));
  }

  function nextCard() {
    setFlipped(false);
    setTimeout(() => {
      setCurrentIndex((i) => (i + 1) % filteredCards.length);
    }, 150);
  }

  function prevCard() {
    setFlipped(false);
    setTimeout(() => {
      setCurrentIndex((i) => (i - 1 + filteredCards.length) % filteredCards.length);
    }, 150);
  }

  // Reset index when filter changes
  useEffect(() => {
    setCurrentIndex(0);
    setFlipped(false);
  }, [activeTopic, search]);

  if (documents.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mx-auto mb-4">
          <Layers className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">No sources yet</h3>
        <p className="text-slate-600 dark:text-slate-400">Add sources to generate flash cards.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600 mb-4" />
        <p className="text-slate-600 dark:text-slate-300 font-medium">Generating flash cards...</p>
        <p className="text-sm text-slate-400 mt-1">Analyzing your sources</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
          <X className="w-8 h-8 text-red-500" />
        </div>
        <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">Something went wrong</h3>
        <p className="text-slate-600 dark:text-slate-400 mb-6">{error}</p>
        <button
          onClick={generateCards}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-5 h-5" />
          Try Again
        </button>
      </div>
    );
  }

  if (cards.length === 0) return null;

  const currentCard = filteredCards[currentIndex];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-7 h-7 text-blue-600" />
            Flashcards
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
            {loadedFromCache ? 'Loaded from cache' : 'Generated from your sources'}
            {' · '}{stats.total} cards · {stats.known} known · {stats.review} review
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={shuffleCards}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <Shuffle className="w-4 h-4" />
            Shuffle
          </button>
          <button
            onClick={generateCards}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Regenerate
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Study Progress</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {stats.known}/{stats.total} known
          </span>
        </div>
        <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
            style={{ width: `${stats.total > 0 ? (stats.known / stats.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Search + Topic filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Layers className="w-4 h-4 text-slate-400 flex-shrink-0" />
          {topics.map((topic) => (
            <button
              key={topic}
              onClick={() => setActiveTopic(topic)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTopic === topic
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {topic === 'all' ? 'All Topics' : topic}
            </button>
          ))}
        </div>
      </div>

      {/* Card area */}
      {filteredCards.length === 0 ? (
        <div className="text-center py-16 text-slate-500 dark:text-slate-400">
          No cards match your search.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center">
            <div className="relative w-full max-w-2xl" style={{ perspective: '1200px' }}>
              <div
                className="relative w-full h-80 cursor-pointer transition-transform duration-500"
                style={{
                  transformStyle: 'preserve-3d',
                  transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
                onClick={() => setFlipped(!flipped)}
              >
                {/* Front */}
                <div
                  className="absolute inset-0 bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-200 dark:border-slate-700 shadow-lg flex flex-col items-center justify-center p-8"
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  <span className="absolute top-4 left-4 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full">
                    {currentCard.topic}
                  </span>
                  <span className="absolute top-4 right-4 text-xs text-slate-400">
                    {currentIndex + 1} / {filteredCards.length}
                  </span>
                  <p className="text-xl font-bold text-slate-900 dark:text-slate-100 text-center">
                    {currentCard.front}
                  </p>
                  <p className="absolute bottom-4 text-xs text-slate-400">
                    Click to flip
                  </p>
                </div>
                {/* Back */}
                <div
                  className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800 dark:from-slate-700 dark:to-slate-900 rounded-2xl shadow-lg flex flex-col items-center justify-center p-8"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <span className="absolute top-4 left-4 text-xs font-medium text-cyan-300 bg-cyan-900/40 px-2.5 py-1 rounded-full">
                    {currentCard.topic}
                  </span>
                  <p className="text-lg text-white text-center leading-relaxed">
                    {currentCard.back}
                  </p>
                  <p className="absolute bottom-4 text-xs text-slate-400">
                    Click to flip back
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={prevCard}
              className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex gap-2">
              <button
                onClick={() => updateCardStatus(currentCard.id, 'review')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all ${
                  currentCard.status === 'review'
                    ? 'bg-amber-500 text-white shadow-md'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-300'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
                Review Again
              </button>
              <button
                onClick={() => updateCardStatus(currentCard.id, 'known')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all ${
                  currentCard.status === 'known'
                    ? 'bg-emerald-500 text-white shadow-md'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-300'
                }`}
              >
                {currentCard.status === 'known' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Circle className="w-4 h-4" />
                )}
                Known
              </button>
            </div>

            <button
              onClick={nextCard}
              className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Reset progress */}
          {stats.known > 0 || stats.review > 0 ? (
            <div className="flex justify-center">
              <button
                onClick={resetProgress}
                className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset study progress
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
