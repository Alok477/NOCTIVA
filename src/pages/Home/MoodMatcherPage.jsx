import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { FaMagic, FaStar, FaClock, FaRedo, FaCommentDots, FaPlus, FaCheck } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { fetchMoodCandidates } from './Fetcher';
import { toDetailPath } from './urlUtils';
import SEO from './SEO';
import { useWatchlist } from '../../context/WatchlistContext';

const MOODS = [
  { id: 'scary', label: 'Scary', emoji: '😱', genres: [27], intensity: 4 },
  { id: 'funny', label: 'Funny', emoji: '😂', genres: [35], intensity: 1 },
  { id: 'romantic', label: 'Romantic', emoji: '❤️', genres: [10749], intensity: 1 },
  { id: 'emotional', label: 'Emotional', emoji: '😭', genres: [18], intensity: 2 },
  { id: 'thoughtful', label: 'Thought-provoking', emoji: '🧠', genres: [18, 9648], intensity: 2 },
  { id: 'chill', label: 'Chill', emoji: '😌', genres: [16, 35], intensity: 1 },
  { id: 'intense', label: 'Intense', emoji: '🔥', genres: [28, 53], intensity: 4 },
  { id: 'feel-good', label: 'Feel-good', emoji: '✨', genres: [35, 10751], intensity: 1 },
];

const COMPANY = [
  { id: 'alone', label: 'Alone', emoji: '🙋', genres: [] },
  { id: 'partner', label: 'Partner', emoji: '👫', genres: [10749] },
  { id: 'family', label: 'Family', emoji: '👨‍👩‍👧', genres: [10751, 16] },
  { id: 'friends', label: 'Friends', emoji: '👯', genres: [35, 12] },
];

const TIMES = [
  { id: 'short', label: '< 90 min', runtime: { max: 90 } },
  { id: 'standard', label: '90–120 min', runtime: { min: 90, max: 120 } },
  { id: 'long', label: '2–3 hours', runtime: { min: 120, max: 180 } },
  { id: 'epic', label: '3+ hours', runtime: { min: 180 } },
];

const INTENSITIES = [
  { id: 'light', label: 'Light', emoji: '🌿', level: 1 },
  { id: 'medium', label: 'Medium', emoji: '🙂', level: 2 },
  { id: 'high', label: 'High', emoji: '🔥', level: 3 },
  { id: 'extreme', label: 'Extreme', emoji: '💀', level: 4 },
];

const GENRES = [
  { id: 28, label: 'Action', emoji: '💥' },
  { id: 12, label: 'Adventure', emoji: '🗺️' },
  { id: 16, label: 'Animation', emoji: '🎨' },
  { id: 35, label: 'Comedy', emoji: '😂' },
  { id: 80, label: 'Crime', emoji: '🕵️' },
  { id: 99, label: 'Documentary', emoji: '🎥' },
  { id: 18, label: 'Drama', emoji: '🎭' },
  { id: 14, label: 'Fantasy', emoji: '🧙' },
  { id: 27, label: 'Horror', emoji: '😱' },
  { id: 9648, label: 'Mystery', emoji: '🔎' },
  { id: 10749, label: 'Romance', emoji: '❤️' },
  { id: 878, label: 'Sci-Fi', emoji: '🚀' },
  { id: 53, label: 'Thriller', emoji: '🔪' },
];

const TEXT_SIGNALS = [
  { words: ['scary', 'horror', 'terrifying', 'ghost', 'haunted'], mood: 'scary', genres: [27] },
  { words: ['funny', 'comedy', 'hilarious', 'laugh'], mood: 'funny', genres: [35] },
  { words: ['romantic', 'romance', 'love', 'date'], mood: 'romantic', genres: [10749] },
  { words: ['emotional', 'sad', 'cry', 'heartwarming'], mood: 'emotional', genres: [18] },
  { words: ['thought provoking', 'thoughtful', 'smart', 'mind bending'], mood: 'thoughtful', genres: [18, 9648] },
  { words: ['chill', 'relaxing', 'calm', 'comfort'], mood: 'chill', genres: [35, 16] },
  { words: ['intense', 'thrilling', 'adrenaline', 'action packed'], mood: 'intense', genres: [28, 53] },
  { words: ['feel good', 'uplifting', 'positive', 'happy'], mood: 'feel-good', genres: [35, 10751] },
  { words: ['action'], genres: [28] },
  { words: ['adventure'], genres: [12] },
  { words: ['animation', 'animated'], genres: [16] },
  { words: ['crime', 'criminal', 'heist'], genres: [80] },
  { words: ['documentary', 'real life'], genres: [99] },
  { words: ['drama'], genres: [18] },
  { words: ['fantasy', 'magic'], genres: [14] },
  { words: ['mystery', 'detective'], genres: [9648] },
  { words: ['sci fi', 'science fiction', 'space'], genres: [878] },
  { words: ['thriller', 'suspense'], genres: [53] },
];

const normalizeText = (value) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const MOOD_MATCH_PAGES = [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_MOOD_MATCHES = 48;

const analyzeMoodText = (value) => {
  const text = normalizeText(value);
  const signals = TEXT_SIGNALS.filter((signal) => signal.words.some((word) => text.includes(word)));
  const genreIds = [...new Set(signals.flatMap((signal) => signal.genres ?? []))];
  const inferredMood = signals.find((signal) => signal.mood)?.mood ?? '';
  let runtime;
  if (text.match(/under|less than|short/)) runtime = { max: 90 };
  else if (text.match(/two hours|2 hours|90 minutes|two hour/)) runtime = { min: 90, max: 120 };
  else if (text.match(/long|three hours|3 hours|epic/)) runtime = { min: 120 };
  return { text, genreIds, inferredMood, runtime };
};

const OptionGroup = ({ title, options, value, onChange, onClear }) => (
  <section>
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-gray-400">{title}</h2>
      <button
        type="button"
        onClick={onClear}
        disabled={!value}
        className="text-xs font-semibold text-gray-500 transition-colors hover:text-red-300 disabled:cursor-default disabled:opacity-30"
      >
        Clear
      </button>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(value === String(option.id) ? '' : String(option.id))}
          className={`rounded-2xl border px-3 py-4 text-left transition-all ${
            value === String(option.id)
              ? 'border-red-400 bg-red-500/15 text-white shadow-lg shadow-red-950/30'
              : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/25 hover:bg-white/[0.07]'
          }`}
        >
          <span className="block text-2xl">{option.emoji}</span>
          <span className="mt-2 block text-sm font-semibold">{option.label}</span>
        </button>
      ))}
    </div>
  </section>
);

OptionGroup.propTypes = {
  title: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(PropTypes.object).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
};

const scoreMovie = (movie, mood, company, intensity, genreId, textAnalysis) => {
  const genreSet = new Set(movie.genre_ids ?? []);
  const hasMoodFit = Boolean(mood?.genres.some((id) => genreSet.has(id)));
  const hasCompanyFit = Boolean(company?.genres.some((id) => genreSet.has(id)));
  const hasGenreFit = Boolean(genreId && genreSet.has(genreId));
  const rating = Number(movie.vote_average) || 0;
  const voteCount = Number(movie.vote_count) || 0;
  const popularity = Number(movie.popularity) || 0;

  // Weighted score: explicit preferences matter more than popularity.
  let score = 0;
  if (genreId) score += hasGenreFit ? 30 : 0;
  if (mood) score += hasMoodFit ? 20 : 0;
  if (company?.genres.length) score += hasCompanyFit ? 12 : 0;
  if (mood && intensity) {
    const intensityDistance = Math.abs(mood.intensity - intensity.level);
    score += Math.max(0, 15 - intensityDistance * 5);
  }
  // Rating quality is normalized to 12 points; vote confidence adds up to 6.
  score += Math.min(12, (rating / 10) * 12);
  score += Math.min(6, Math.log10(voteCount + 1) / 4 * 6);
  // Popularity breaks ties without overwhelming preference matches.
  score += Math.min(5, Math.log10(popularity + 1) / 2 * 5);
  if (movie.poster_path) score += 2;
  if (textAnalysis?.text) {
    const searchable = normalizeText(`${movie.title ?? ''} ${movie.overview ?? ''}`);
    const textWords = textAnalysis.text.split(' ').filter((word) => word.length > 3);
    const matchedWords = textWords.filter((word) => searchable.includes(word)).length;
    score += Math.min(12, matchedWords * 3);
  }
  return Math.round(Math.min(99, Math.max(1, score)));
};

export default function MoodMatcherPage() {
  const navigate = useNavigate();
  const { user, ready: watchlistReady, watchlistIds, toggleWatchlist } = useWatchlist();
  const [mood, setMood] = useState('');
  const [company, setCompany] = useState('');
  const [time, setTime] = useState('');
  const [intensity, setIntensity] = useState('');
  const [genre, setGenre] = useState('');
  const [language, setLanguage] = useState('en');
  const [moodText, setMoodText] = useState('');
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedMood = useMemo(() => MOODS.find((item) => item.id === mood), [mood]);
  const selectedCompany = useMemo(() => COMPANY.find((item) => item.id === company), [company]);
  const selectedTime = useMemo(() => TIMES.find((item) => item.id === time), [time]);
  const selectedIntensity = useMemo(() => INTENSITIES.find((item) => item.id === intensity), [intensity]);
  const selectedGenre = useMemo(() => GENRES.find((item) => String(item.id) === String(genre)), [genre]);
  const selectedCount = [selectedMood, selectedCompany, selectedTime, selectedIntensity, selectedGenre].filter(Boolean).length;
  const toggleMatchedMovie = async (event, movie) => {
    event.stopPropagation();
    if (!user) {
      window.dispatchEvent(new Event('openAuthModal'));
      return;
    }
    try {
      await toggleWatchlist({
        mediaId: movie.id,
        type: 'movie',
        title: movie.title,
        poster_path: movie.poster_path || null,
        vote_average: movie.vote_average || 0,
        release_date: movie.release_date || null,
      });
    } catch (watchlistError) {
      console.error('Unable to update watchlist:', watchlistError);
    }
  };
  const clearSelections = () => {
    setMood('');
    setCompany('');
    setTime('');
    setIntensity('');
    setGenre('');
    setLanguage('');
    setMoodText('');
    setMatches([]);
    setError('');
  };

  const handleMatch = async () => {
    const textAnalysis = analyzeMoodText(moodText);
    if (selectedCount < 2 && !moodText.trim()) return;
    setLoading(true);
    setError('');
    try {
      const genreIds = [...new Set([
        ...(selectedGenre ? [selectedGenre.id] : []),
        ...(selectedMood?.genres ?? []),
        ...(selectedCompany?.genres ?? []),
        ...textAnalysis.genreIds,
      ])];
      const candidatePages = await Promise.all(
        MOOD_MATCH_PAGES.map((page) => fetchMoodCandidates({
          genreIds,
          runtime: selectedTime?.runtime ?? textAnalysis.runtime,
          language,
          page,
        }))
      );
      const candidates = [...new Map(
        candidatePages.flat().map((movie) => [movie.id, movie])
      ).values()];
      const ranked = candidates
        .map((movie) => ({
          ...movie,
          matchScore: scoreMovie(
            movie,
            selectedMood,
            selectedCompany,
            selectedIntensity,
            selectedGenre?.id,
            textAnalysis
          ),
          matchConfidence: Math.min(98, 54 + selectedCount * 8 + textAnalysis.genreIds.length * 4 + (moodText.trim() ? 8 : 0)),
        }))
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, MAX_MOOD_MATCHES);
      setMatches(ranked);
      if (!ranked.length) setError('No exact matches were found. Try another combination.');
    } catch (matchError) {
      setError(matchError.message || 'Unable to create your matches right now.');
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  const ready = selectedCount >= 2 || moodText.trim().length >= 3;
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07080a] px-4 py-10 text-gray-200 sm:px-8 lg:px-12">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-cover bg-center opacity-35"
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=2200&q=85')" }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-gradient-to-b from-[#07080a]/20 via-[#07080a]/65 to-[#07080a]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_10%,rgba(220,38,38,0.18),transparent_34%)]" />
      <SEO title="Match Mood — NOCTIVA" description="Find a movie that matches your mood, time, intensity, and company." noSuffix />
      <div className="relative mx-auto max-w-6xl">
        <div className="mb-10 flex max-w-4xl flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div aria-hidden="true" className="h-11" />
            <h1 className="max-w-3xl text-5xl font-black leading-[0.95] tracking-[-0.045em] text-white sm:text-6xl md:text-7xl">
              <span className="block">What are you in the</span>
              <span className="mr-3 inline-block bg-gradient-to-r from-red-400 via-rose-300 to-orange-300 bg-clip-text font-serif text-6xl font-bold italic text-transparent sm:text-7xl md:text-8xl">
                mood
              </span>
              <span className="inline-block">for?</span>
            </h1>
            <div className="mt-6 flex items-center gap-3">
              <span className="h-1 w-16 rounded-full bg-gradient-to-r from-red-500 to-orange-400" />
              <span className="text-xs font-bold uppercase tracking-[0.28em] text-red-300/80">Your night, perfectly matched</span>
            </div>
            <p className="mt-4 text-gray-400">Answer four quick questions and get a ranked movie match built around your night.</p>
          </div>
        </div>

        <div className="space-y-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 sm:p-8">
          <section className="rounded-2xl border border-red-400/20 bg-red-500/[0.06] p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-3">
              <FaCommentDots className="text-red-300" />
              <div>
                <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-gray-200">Describe your perfect watch</h2>
                <p className="mt-1 text-xs text-gray-500">Try: “a funny feel-good movie under two hours”</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                value={moodText}
                onChange={(event) => setMoodText(event.target.value)}
                placeholder="Tell us what you feel like watching…"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-red-400"
              />
              {moodText && (
                <button type="button" onClick={() => setMoodText('')} className="rounded-xl border border-white/10 px-3 text-xs font-bold text-gray-400 hover:border-red-400/40 hover:text-red-300">
                  Clear
                </button>
              )}
            </div>
          </section>
          <OptionGroup title="What's your mood?" options={MOODS} value={mood} onChange={setMood} onClear={() => setMood('')} />
          <OptionGroup title="Who are you watching with?" options={COMPANY} value={company} onChange={setCompany} onClear={() => setCompany('')} />
          <OptionGroup title="How much time do you have?" options={TIMES} value={time} onChange={setTime} onClear={() => setTime('')} />
          <OptionGroup title="How intense?" options={INTENSITIES} value={intensity} onChange={setIntensity} onClear={() => setIntensity('')} />
          <OptionGroup title="Choose a genre" options={GENRES} value={genre} onChange={setGenre} onClear={() => setGenre('')} />
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="match-language" className="text-sm font-bold uppercase tracking-[0.18em] text-gray-400">Language</label>
              <button
                type="button"
                onClick={() => setLanguage('')}
                disabled={!language}
                className="text-xs font-semibold text-gray-500 transition-colors hover:text-red-300 disabled:cursor-default disabled:opacity-30"
              >
                Clear
              </button>
            </div>
            <select id="match-language" value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded-xl border border-white/10 bg-[#11151e] px-4 py-3 text-sm text-white outline-none focus:border-red-400">
              <option value="">Any language</option>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="ko">Korean</option>
              <option value="ja">Japanese</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
            </select>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleMatch}
              disabled={!ready || loading}
              className="flex flex-1 items-center justify-center gap-3 rounded-2xl bg-red-600 px-6 py-4 text-lg font-black text-white shadow-xl shadow-red-950/30 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
            {loading ? <FaRedo className="animate-spin" /> : <FaMagic />} {loading ? 'MATCHING…' : '✨ MATCH MY MOVIE'}
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={clearSelections}
                className="rounded-2xl border border-white/10 px-5 py-4 text-sm font-bold text-gray-400 transition hover:border-red-400/40 hover:text-red-300"
              >
                Clear all
              </button>
            )}
          </div>
          {!ready && <p className="text-center text-xs text-gray-500">Choose any 2 sections or describe your mood to unlock your match.</p>}
          {error && <p className="text-center text-sm text-red-300">{error}</p>}
        </div>

        {matches.length > 0 && (
          <section className="mt-12">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-2xl font-black text-white">Your mood matches</h2>
                <p className="mt-2 text-sm text-gray-500">Availability is filtered for India through TMDB watch-region data.</p>
              </div>
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-red-300">{matches.length} movies found</span>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 lg:grid-cols-6">
              {matches.map((movie) => (
                <article
                  key={movie.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(toDetailPath('movie', movie.id, movie.title))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(toDetailPath('movie', movie.id, movie.title));
                    }
                  }}
                  className="group cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-left transition hover:-translate-y-1 hover:border-red-400/50"
                >
                  <div className="relative aspect-[2/3] bg-[#111319]">
                    {movie.poster_path ? <img src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-gray-600">No poster</div>}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={watchlistReady && watchlistIds.has(String(movie.id)) ? `Remove ${movie.title} from watchlist` : `Add ${movie.title} to watchlist`}
                      onClick={(event) => toggleMatchedMovie(event, movie)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') toggleMatchedMovie(event, movie);
                      }}
                      className={`absolute left-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition ${
                        watchlistReady && watchlistIds.has(String(movie.id))
                          ? 'bg-red-600 text-white'
                          : 'bg-black/70 text-white hover:bg-red-600'
                      }`}
                    >
                      {watchlistReady && watchlistIds.has(String(movie.id)) ? <FaCheck className="text-[10px]" /> : <FaPlus className="text-[10px]" />}
                    </span>
                    <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
                      <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-black text-white sm:px-2 sm:text-[10px]">{movie.matchScore}%</span>
                      <span className="rounded-full bg-black/70 px-1.5 py-0.5 text-[8px] font-bold text-gray-200 sm:text-[9px]">{movie.matchConfidence}%</span>
                    </div>
                  </div>
                  <div className="px-2.5 pb-2.5 pt-2">
                    <h3 className="line-clamp-1 text-[13px] font-semibold leading-tight text-white sm:line-clamp-2">{movie.title}</h3>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400 sm:gap-3 sm:text-xs">
                      <span className="flex items-center gap-1"><FaStar className="text-yellow-400" /> {(movie.vote_average || 0).toFixed(1)}</span>
                      <span className="flex items-center gap-1"><FaClock /> {movie.release_date?.slice(0, 4) || '—'}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
