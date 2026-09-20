import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  memo,
  useRef,
} from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import PropTypes from "prop-types";
import { fetchSeriesDetails, fetchAllEpisodes, fetchRelatedSeries, fetchSeriesWatchProviders } from "../Fetcher";
import { getIdFromDetailSlug, toDetailPath } from "../urlUtils";
import { db } from "../../../firebase";
import { collection, onSnapshot, addDoc, serverTimestamp } from "firebase/firestore";
import { FaRedo, FaStar, FaArrowLeft, FaBookmark } from "react-icons/fa";
import { BiCalendar, BiTv, BiSearch } from "react-icons/bi";
import DetailPageSkeleton from "../reused/DetailPageSkeleton";
import VideoPlayer from "./VideoPlayer";
import SEO from "../SEO";
import ContentCard from "../ContentCard";
import CastRow from "../reused/CastRow";
import AuthModal from "../../../components/AuthModal";
import { useWatchlist } from "../../../context/WatchlistContext";

const MemoizedVideoPlayer = memo(VideoPlayer);

const BACKDROP = "https://image.tmdb.org/t/p/original";
const POSTER = "https://image.tmdb.org/t/p/w342";
const STILL = "https://image.tmdb.org/t/p/w300";
const LOGO = "https://image.tmdb.org/t/p/w500";

const fetchLogoPath = async (mediaType, id) => {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_BASE_URL}/${mediaType}/${id}/images?api_key=${import.meta.env.VITE_TMDB_API}&include_image_language=en,null`
    );
    const data = await response.json();
    const logo = (data.logos ?? []).find(image => image.iso_639_1 === 'en') ?? (data.logos ?? [])[0];
    return logo?.file_path ?? null;
  } catch {
    return null;
  }
};

const getValidParamNumber = (params, key) => {
  const raw = params.get(key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
};

const TvDetails = ({ tvId: tvIdProp }) => {
  const { slug } = useParams();
  const location = useLocation();
  const tvId = tvIdProp ?? getIdFromDetailSlug(slug);
  const navigate = useNavigate();
  const [tv, setTv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logoPath, setLogoPath] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [allSeasons, setAllSeasons] = useState([]);
  const [viewingSeason, setViewingSeason] = useState(null);
  const [showOverview, setShowOverview] = useState(false);
  const [episodeQuery, setEpisodeQuery] = useState('');
  const [isDraggingEpisodes, setIsDraggingEpisodes] = useState(false);
  const [isDraggingSeasons, setIsDraggingSeasons] = useState(false);
  const [isDraggingRelated, setIsDraggingRelated] = useState(false);
  const [related, setRelated] = useState([]);
  const [watchProviders, setWatchProviders] = useState({ results: {} });
  const [reviews, setReviews] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { user, watchlistIds, toggleWatchlist: ctxToggleWatchlist } = useWatchlist();
  const inWatchlist = tv?.id ? watchlistIds.has(String(tv.id)) : false;
  const numericTvId = Number(tvId);

  const handleBack = () => {
    if (location.state?.from) {
      navigate(location.state.from);
      return;
    }
    navigate(-1);
  };

  const episodeListRef = useRef(null);
  const dragStateRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const suppressClickRef = useRef(false);
  const seasonListRef = useRef(null);
  const seasonDragStateRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const suppressSeasonClickRef = useRef(false);
  const relatedListRef = useRef(null);
  const loadRequestRef = useRef(0);
  const relatedDragStateRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const suppressRelatedClickRef = useRef(false);

  // Prevent one-frame stale detail flash when navigating between related titles.
  useLayoutEffect(() => {
    setLoading(true);
    setError(null);
    setTv(null);
    setLogoPath(null);
    setAllSeasons([]);
    setViewingSeason(null);
    setShowOverview(false);
    setEpisodeQuery('');
    setRelated([]);
    setWatchProviders({ results: {} });
    setReviews([]);
    setReviewText('');
    setReviewRating(5);
    setReviewError('');
    setIsDraggingEpisodes(false);
    setIsDraggingSeasons(false);
    setIsDraggingRelated(false);
    setIsAuthModalOpen(false);
    suppressClickRef.current = false;
    suppressSeasonClickRef.current = false;
    suppressRelatedClickRef.current = false;
  }, [tvId]);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    setRetrying(true);
    try {
      const [seriesData, seasonsData, relatedData, detailLogoPath, providersData] = await Promise.all([
        fetchSeriesDetails(tvId),
        fetchAllEpisodes(tvId),
        fetchRelatedSeries(tvId),
        fetchLogoPath('tv', tvId),
        fetchSeriesWatchProviders(tvId),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setTv(seriesData);
      setLogoPath(detailLogoPath);
      setRelated((relatedData ?? []).filter((item) => item?.id && item.id !== seriesData.id).slice(0, 18));
      setWatchProviders(providersData ?? { results: {} });
      const filtered = (seasonsData ?? [])
        .filter(s => s.season_number > 0)
        .sort((a, b) => a.season_number - b.season_number);
      setAllSeasons(filtered);

      if (filtered.length > 0) {
        // Read URL params at fetch time so the correct season/episode is set as the
        // initial state directly — prevents S1E1 flash before URL sync can override.
        const urlParams = new URLSearchParams(window.location.search);
        let urlSeason = getValidParamNumber(urlParams, 'season');

        // ++ Progress Tracking: Resume from exact episode if found in Continue Watching cache ++
        if (urlSeason === null) {
          try {
            const cacheKey = user?.uid ? `noctiva_cw_cache_items_${user.uid}` : null;
            const cwCache = cacheKey
              ? JSON.parse(localStorage.getItem(cacheKey) || '[]')
              : [];
            const cwMatch = cwCache.find(cw => cw.id === numericTvId);
            if (cwMatch?.season) {
              urlSeason = cwMatch.season;
            }
          } catch (error) {
            console.warn('Unable to restore TV progress cache:', error);
          }
        }

        const selectedSeason =
          (urlSeason && filtered.find((s) => s.season_number === urlSeason))
          ?? filtered[0];
        setViewingSeason(selectedSeason.season_number);
      }
    } catch {
      if (requestId !== loadRequestRef.current) return;
      setError("Failed to load TV show details. Please try again.");
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
        setRetrying(false);
      }
    }
  }, [tvId, user, numericTvId]);

  useEffect(() => {
    load();
    return () => {
      setTv(null); setAllSeasons([]);
      setViewingSeason(null);
    };
  }, [load]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [tvId]);

  useEffect(() => {
    if (!tv?.id) return;

    const unsubscribe = onSnapshot(collection(db, 'reviews'), (snapshot) => {
      const nextReviews = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => item.mediaId === String(tv.id) && item.mediaType === 'tv')
        .sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() ?? 0;
          const bTime = b.createdAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });
      setReviews(nextReviews);
      setReviewError('');
    }, (error) => {
      console.error('Failed to load TV reviews:', error);
      setReviewError('Reviews are temporarily unavailable. Please try again shortly.');
    });

    return () => unsubscribe();
  }, [tv?.id]);

  useEffect(() => {
    if (!tv?.id) return;
    const isLegacyRoute = location.pathname.startsWith('/tv/');
    if (!isLegacyRoute) return;
    const canonicalPath = toDetailPath('tv', tv.id, tv.name);
    if (location.pathname !== canonicalPath) {
      navigate({ pathname: canonicalPath, search: location.search }, { replace: true, state: location.state });
    }
  }, [tv, location.pathname, location.search, location.state, navigate]);

  const toggleWatchlist = () => {
    if (!tv?.id) return;
    ctxToggleWatchlist(
      {
        mediaId: tv.id,
        type: 'tv',
        title: tv.name,
        poster_path: tv.poster_path,
        vote_average: tv.vote_average,
        release_date: tv.first_air_date,
      },
      () => setIsAuthModalOpen(true)
    );
  };

  useEffect(() => {
    if (!allSeasons.length) return;
    if (loading) return;
    if (!tv?.id || Number(tv.id) !== numericTvId) return;

    const params = new URLSearchParams(location.search);
    const urlSeason = getValidParamNumber(params, 'season');
    if (urlSeason === null) return;

    const selectedSeason = allSeasons.find((s) => s.season_number === urlSeason) ?? allSeasons[0];

    if (viewingSeason !== selectedSeason.season_number) {
      setViewingSeason(selectedSeason.season_number);
    }
  }, [allSeasons, location.search, loading, tv, numericTvId, viewingSeason]);

  const currentSeasonData = allSeasons.find(s => s.season_number === viewingSeason);
  const sortedEpisodes = [...(currentSeasonData?.episodes ?? [])].sort((a, b) => a.episode_number - b.episode_number);
  const filteredEpisodes = sortedEpisodes.filter((ep) => {
    const q = episodeQuery.trim().toLowerCase();
    if (!q) return true;
    const title = (ep.name || '').toLowerCase();
    return title.includes(q) || String(ep.episode_number).includes(q);
  });

  const regionPriority = ['IN', 'US', 'GB', 'AU', 'CA', 'DE', 'FR', 'ES', 'BR', 'MX', 'NL', 'SE', 'NO', 'DK', 'FI', 'IE'];
  const regionLabels = {
    IN: 'India 🇮🇳',
    US: 'United States 🇺🇸',
    GB: 'United Kingdom 🇬🇧',
    AU: 'Australia 🇦🇺',
    CA: 'Canada 🇨🇦',
    DE: 'Germany 🇩🇪',
    FR: 'France 🇫🇷',
    ES: 'Spain 🇪🇸',
    BR: 'Brazil 🇧🇷',
    MX: 'Mexico 🇲🇽',
    NL: 'Netherlands 🇳🇱',
    SE: 'Sweden 🇸🇪',
    NO: 'Norway 🇳🇴',
    DK: 'Denmark 🇩🇰',
    FI: 'Finland 🇫🇮',
    IE: 'Ireland 🇮🇪',
  };

  const providerResults = watchProviders?.results ?? {};
  const selectedRegionCode = regionPriority.find((code) => Boolean(providerResults[code])) ?? 'IN';
  const countryProviders = providerResults[selectedRegionCode] ?? {
    link: providerResults.IN?.link ?? null,
    flatrate: [],
    free: [],
    ads: [],
    rent: [],
    buy: [],
  };
  const selectedRegionLabel = regionLabels[selectedRegionCode] ?? selectedRegionCode;
  const providerTypeLabels = {
    flatrate: 'Streaming',
    free: 'Free',
    ads: 'Free with ads',
    rent: 'Rental',
    buy: 'Purchase',
  };

  const getProviderDirectLink = (providerName) => {
    const normalized = (providerName || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    const directLinks = {
      netflix: 'https://www.netflix.com/in/',
      'prime video': 'https://www.primevideo.com/',
      'amazon prime video': 'https://www.primevideo.com/',
      primevideo: 'https://www.primevideo.com/',
      jiocinema: 'https://www.jiocinema.com/',
      'jio cinema': 'https://www.jiocinema.com/',
      jiostar: 'https://www.hotstar.com/in',
      hotstar: 'https://www.hotstar.com/in',
      'disney hotstar': 'https://www.hotstar.com/in',
      'disneyplus hotstar': 'https://www.hotstar.com/in',
      'jio hotstar': 'https://www.hotstar.com/in',
      youtube: 'https://www.youtube.com/',
      'youtube premium': 'https://www.youtube.com/premium',
      'google play movies': 'https://play.google.com/store/movies',
      'google play': 'https://play.google.com/store/movies',
      zee5: 'https://www.zee5.com/',
      'zee 5': 'https://www.zee5.com/',
      'sony liv': 'https://www.sonyliv.com/',
      sonyliv: 'https://www.sonyliv.com/',
      'mx player': 'https://www.mxplayer.in/',
      mxplayer: 'https://www.mxplayer.in/',
      'apple tv': 'https://tv.apple.com/',
      'apple tv plus': 'https://tv.apple.com/',
      aha: 'https://www.aha.video/',
      'aha video': 'https://www.aha.video/',
      'eros now': 'https://erosnow.com/',
      'vi movies and tv': 'https://www.viaplay.com/',
      voot: 'https://www.voot.com/',
      'voot select': 'https://www.voot.com/',
      'sun nxt': 'https://www.sunnxt.com/',
      sunnxt: 'https://www.sunnxt.com/',
      'lionsgate play': 'https://www.lionsgateplay.com/',
      'shemaroo me': 'https://www.shemaroome.com/',
      'hungama play': 'https://www.hungama.com/play/',
      crunchyroll: 'https://www.crunchyroll.com/',
      mubi: 'https://mubi.com/',
      ahaott: 'https://www.aha.video/',
      playflix: 'https://playflix.in/',
      iflix: 'https://www.iflix.com/',
    };

    return directLinks[normalized] || directLinks[normalized.replace(/\s+/g, '')] || countryProviders?.link || null;
  };

  const providerCards = (() => {
    const providerMap = new Map();
    const providerGroups = ['flatrate', 'free', 'ads', 'rent', 'buy'];

    providerGroups.forEach((group) => {
      (countryProviders[group] ?? []).forEach((provider) => {
        const existing = providerMap.get(provider.provider_id);
        if (existing) {
          existing.types = Array.from(new Set([...existing.types, group]));
          return;
        }

        providerMap.set(provider.provider_id, {
          ...provider,
          types: [group],
        });
      });
    });

    return [...providerMap.values()].sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999));
  })();

  const availablePlatformCount = providerCards.length;
  const lastUpdated = countryProviders?.last_updated || watchProviders?.last_updated || providerResults.IN?.last_updated;
  const formattedLastUpdated = lastUpdated
    ? new Date(lastUpdated).toLocaleString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const onEpisodeMouseDown = useCallback((e) => {
    const el = episodeListRef.current;
    if (!el) return;
    dragStateRef.current = {
      active: true,
      startX: e.pageX,
      startScrollLeft: el.scrollLeft,
      moved: false,
    };
    setIsDraggingEpisodes(true);
  }, []);

  const onEpisodeMouseMove = useCallback((e) => {
    const el = episodeListRef.current;
    const drag = dragStateRef.current;
    if (!el || !drag.active) return;

    const delta = e.pageX - drag.startX;
    if (Math.abs(delta) > 4) drag.moved = true;
    el.scrollLeft = drag.startScrollLeft - delta;
  }, []);

  const endEpisodeDrag = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag.active) return;
    drag.active = false;
    suppressClickRef.current = drag.moved;
    setIsDraggingEpisodes(false);

    // Clear click suppression after the current event loop.
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!tv?.id) return;
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }
    const cleaned = reviewText.trim();
    if (!cleaned) {
      setReviewError('Please write a short review before submitting.');
      return;
    }

    setReviewSubmitting(true);
    setReviewError('');

    try {
      await addDoc(collection(db, 'reviews'), {
        userId: user.uid,
        userName: user.displayName || user.email || 'Noctiva user',
        userPhoto: user.photoURL || null,
        mediaId: String(tv.id),
        mediaType: 'tv',
        title: tv.name,
        rating: Number(reviewRating) || 5,
        review: cleaned,
        createdAt: serverTimestamp(),
      });
      setReviewText('');
      setReviewRating(5);
    } catch {
      setReviewError('Something went wrong while posting your review.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const onRelatedMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const el = relatedListRef.current;
    if (!el) return;
    relatedDragStateRef.current = {
      active: true,
      startX: e.pageX,
      startScrollLeft: el.scrollLeft,
      moved: false,
    };
    setIsDraggingRelated(true);
  }, []);

  const onRelatedMouseMove = useCallback((e) => {
    const el = relatedListRef.current;
    const drag = relatedDragStateRef.current;
    if (!el || !drag.active) return;

    const delta = e.pageX - drag.startX;
    if (Math.abs(delta) > 4) drag.moved = true;
    el.scrollLeft = drag.startScrollLeft - delta;
  }, []);

  const endRelatedDrag = useCallback(() => {
    const drag = relatedDragStateRef.current;
    if (!drag.active) return;
    drag.active = false;
    suppressRelatedClickRef.current = drag.moved;
    setIsDraggingRelated(false);

    setTimeout(() => {
      suppressRelatedClickRef.current = false;
    }, 0);
  }, []);

  const onSeasonMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const el = seasonListRef.current;
    if (!el) return;
    seasonDragStateRef.current = {
      active: true,
      startX: e.pageX,
      startScrollLeft: el.scrollLeft,
      moved: false,
    };
    setIsDraggingSeasons(true);
  }, []);

  const onSeasonMouseMove = useCallback((e) => {
    const el = seasonListRef.current;
    const drag = seasonDragStateRef.current;
    if (!el || !drag.active) return;

    const delta = e.pageX - drag.startX;
    if (Math.abs(delta) > 4) drag.moved = true;
    el.scrollLeft = drag.startScrollLeft - delta;
  }, []);

  const endSeasonDrag = useCallback(() => {
    const drag = seasonDragStateRef.current;
    if (!drag.active) return;
    drag.active = false;
    suppressSeasonClickRef.current = drag.moved;
    setIsDraggingSeasons(false);

    setTimeout(() => {
      suppressSeasonClickRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', endSeasonDrag);
    return () => window.removeEventListener('mouseup', endSeasonDrag);
  }, [endSeasonDrag]);

  useEffect(() => {
    window.addEventListener('mouseup', endEpisodeDrag);
    return () => window.removeEventListener('mouseup', endEpisodeDrag);
  }, [endEpisodeDrag]);

  useEffect(() => {
    window.addEventListener('mouseup', endRelatedDrag);
    return () => window.removeEventListener('mouseup', endRelatedDrag);
  }, [endRelatedDrag]);

  if (loading) return (
    <DetailPageSkeleton type="tv" />
  );

  if (error) return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-red-900/20 border border-red-700/50 rounded-2xl p-8 max-w-sm w-full text-center">
        <p className="text-red-300 mb-6">{error}</p>
        <button
          onClick={load}
          disabled={retrying}
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          <FaRedo className={retrying ? "animate-spin" : ""} />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </div>
    </div>
  );

  if (!tv) return null;

  const rating = tv.vote_average > 0 ? tv.vote_average.toFixed(1) : null;
  const year = (tv.first_air_date ?? "").slice(0, 4);
  const overview = tv.overview ?? "";
  const truncated = overview.length > 240 && !showOverview
    ? overview.slice(0, 240) + "…"
    : overview;

  const handleRelatedSelect = (item) => {
    navigate({ pathname: toDetailPath('tv', item.id, item.name || item.title), search: '' }, {
      state: { from: '/series' },
    });
  };

  return (
    <div className="min-h-screen bg-[#07080a] text-gray-200 selection:bg-red-500/30">
      <SEO
        title={`${tv.name}${year ? ` (${year})` : ''} — TV Show Details | NOCTIVA`}
        description={
          tv.overview
            ? `${tv.overview.slice(0, 150).trim()}… Explore ${tv.name}, find where it is available, and track it on NOCTIVA.`
            : `Explore ${tv.name}, check availability, and track it on NOCTIVA.`
        }
        image={
          tv.backdrop_path
            ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}`
            : tv.poster_path
              ? `https://image.tmdb.org/t/p/w780${tv.poster_path}`
              : undefined
        }
        type="video.episode"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'TVSeries',
          name: tv.name,
          description: tv.overview,
          image: tv.poster_path ? `https://image.tmdb.org/t/p/w780${tv.poster_path}` : undefined,
          startDate: tv.first_air_date,
          numberOfSeasons: allSeasons.length || undefined,
          ...(tv.vote_average > 0 && {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: tv.vote_average.toFixed(1),
              bestRating: 10,
              ratingCount: tv.vote_count,
            },
          }),
          genre: (tv.genres ?? []).map(g => g.name),
        }}
      />

      {/* ── HERO SECTION ── */}
      <div className="relative w-full min-h-[70vh] flex flex-col justify-end pt-32 pb-20">
        {/* Backdrop Image */}
        <div className="absolute inset-0 z-0 select-none overflow-hidden">
          {tv.backdrop_path ? (
            <img
              src={`${BACKDROP}${tv.backdrop_path}`}
              alt=""
              className="w-full h-full object-cover object-top"
              style={{ filter: "brightness(0.6) contrast(1.1) saturate(1.1)", transform: "scale(1.02)" }}
            />
          ) : (
            <div className="w-full h-full bg-[#111319] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-800 to-[#111319]" />
          )}
          {/* Gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07080a] via-[#07080a]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#07080a]/90 via-[#07080a]/50 to-transparent" />
        </div>

        {/* Back Button */}
        <div className="absolute top-0 left-0 right-0 z-20 p-6 md:p-10 flex">
          <button
            onClick={handleBack}
            className="group flex items-center gap-2 bg-black/30 hover:bg-black/50 backdrop-blur-md border border-white/10 text-gray-200 hover:text-white text-sm font-medium px-5 py-2.5 rounded-full transition-all duration-300"
          >
            <FaArrowLeft className="group-hover:-translate-x-1 transition-transform duration-300" />
            <span>Back</span>
          </button>
        </div>

        {/* Hero Content */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-12 flex flex-col md:flex-row items-end gap-8 lg:gap-14">
          
          {/* Poster */}
          {tv.poster_path && (
            <div className="hidden md:block shrink-0 z-10">
              <img
                src={`${POSTER}${tv.poster_path}`}
                alt={tv.name}
                className="w-48 lg:w-64 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] ring-1 ring-white/10 group-hover:scale-105 transition-transform duration-700"
              />
            </div>
          )}

          {/* Info */}
          <div className="flex-1 max-w-3xl pb-2">
            {tv.tagline && (
              <p className="text-red-400 font-semibold tracking-wider text-xs md:text-sm uppercase mb-3 drop-shadow-md">
                {tv.tagline}
              </p>
            )}

            <div className="w-[min(78vw,30rem)] h-28 md:h-40 flex items-center mb-5 shrink-0">
              {logoPath ? (
                <img
                  src={`${LOGO}${logoPath}`}
                  alt={tv.name}
                  className="w-full h-full object-contain object-left drop-shadow-2xl"
                />
              ) : (
                <h1 className="w-full text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.05] drop-shadow-2xl font-sans">
                  {tv.name}
                </h1>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-gray-300 mb-6 drop-shadow-md">
              {year && <span className="flex items-center gap-1.5"><BiCalendar className="text-gray-400 text-base" /> {year}</span>}
              {allSeasons.length > 0 && <span className="flex items-center gap-1.5"><BiTv className="text-gray-400 text-base" /> {allSeasons.length} Season{allSeasons.length !== 1 ? 's' : ''}</span>}
              {rating && <span className="flex items-center gap-1.5"><FaStar className="text-yellow-500 text-base" /> {rating}</span>}
            </div>

            {(tv.genres ?? []).length > 0 && (
               <div className="flex flex-wrap gap-2 mb-6">
                 {(tv.genres ?? []).map(g => (
                   <span key={g.id} className="bg-white/10 hover:bg-white/20 transition-colors backdrop-blur-md border border-white/10 px-3 py-1 rounded-full text-xs font-semibold text-gray-200 shadow-sm">
                     {g.name}
                   </span>
                 ))}
               </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-4 mb-6">
               <button
                 onClick={toggleWatchlist}
                 className={`flex items-center gap-2 backdrop-blur-md text-white font-bold px-6 py-3 rounded-xl transition-all active:scale-[0.98] ${
                   inWatchlist 
                     ? 'bg-red-600/20 hover:bg-red-600/30 border border-red-500/50' 
                     : 'bg-white/10 hover:bg-white/20 border border-white/10'
                 }`}
               >
                 <FaBookmark className={inWatchlist ? "text-red-400" : ""} /> 
                 {inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}
               </button>
            </div>

            {overview && (
              <div className="relative">
                <p className="text-gray-300/90 leading-relaxed md:text-lg drop-shadow-md max-w-2xl">
                  {truncated}
                </p>
                {overview.length > 240 && (
                  <button
                    onClick={() => setShowOverview(p => !p)}
                    className="mt-3 text-white font-semibold hover:text-red-400 transition-colors text-sm underline underline-offset-4"
                  >
                    {showOverview ? "Show Less" : "Read More"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── PLAYER SECTION ── */}
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 md:px-12 -mt-4 md:-mt-10 mb-12">
        <div className="relative max-w-4xl mx-auto mb-6">
          {/* Subtle Video Player Glow Backdrop */}
          <div className="absolute -inset-1 bg-gradient-to-r from-red-600/30 to-blue-600/30 blur-2xl opacity-50 z-0 rounded-2xl md:rounded-[2rem]"></div>
          
          <div className="relative z-10 bg-[#0f1117]/80 backdrop-blur-xl border border-white/5 rounded-2xl md:rounded-[2rem] p-2 md:p-4 shadow-2xl ring-1 ring-white/5">
            <div className="px-2 pt-1 pb-3 text-sm font-semibold text-gray-300">Trailer</div>
            <MemoizedVideoPlayer tvId={tvId} />

          </div>
        </div>
      </div>

          
      {/* ── EPISODES SELECTOR ── */}
      {allSeasons.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 pb-16">
          <section className="bg-[#111319]/50 backdrop-blur-md rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 md:px-8 border-b border-white/[0.04]">
              <div className="flex items-center gap-4 min-w-0 w-full sm:w-auto">
                <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-500/5 border border-red-500/20 shrink-0">
                  <BiTv className="text-red-400 text-lg" />
                </div>
                <div>
                  <h2 className="text-lg md:text-xl font-bold text-white mb-0.5">Episodes</h2>
                  <p className="text-gray-400 text-xs font-medium">
                    {currentSeasonData?.episodes?.length ?? 0} episodes in Season {viewingSeason}
                  </p>
                </div>
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-64">
                <BiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                <input
                  type="text"
                  value={episodeQuery}
                  onChange={(e) => setEpisodeQuery(e.target.value)}
                  placeholder="Search episodes…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:bg-white/[0.05] transition-all"
                />
              </div>
            </div>

            {/* Seasons List */}
            {allSeasons.length > 1 && (
              <div className="px-5 md:px-8 pt-6 pb-2">
                <div
                  ref={seasonListRef}
                  onMouseDown={onSeasonMouseDown}
                  onMouseMove={onSeasonMouseMove}
                  onMouseLeave={endSeasonDrag}
                  className={`flex gap-3 overflow-x-auto hide-scrollbar ${isDraggingSeasons ? 'cursor-grabbing' : 'cursor-grab'}`}
                >
                  {allSeasons.map(season => {
                    const isViewing = viewingSeason === season.season_number;
                    return (
                      <button
                        key={season.id ?? season.season_number}
                        onClick={(e) => {
                          if (suppressSeasonClickRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                          }
                          setViewingSeason(season.season_number);
                        }}
                        className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${isViewing ? 'bg-red-600 text-white shadow-[0_4px_14px_rgba(220,38,38,0.4)]' : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-white border border-white/5'}`}
                      >
                        Season {season.season_number}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Episodes List */}
            <div className="p-5 md:px-8 pt-4 pb-8">
              {filteredEpisodes.length > 0 ? (
                <div
                  ref={episodeListRef}
                  onMouseDown={onEpisodeMouseDown}
                  onMouseMove={onEpisodeMouseMove}
                  onMouseLeave={endEpisodeDrag}
                  className={`grid grid-flow-col auto-cols-[180px] sm:auto-cols-[220px] gap-4 overflow-x-auto hide-scrollbar pb-4 select-none ${isDraggingEpisodes ? 'cursor-grabbing' : 'cursor-grab'}`}
                >
                  {filteredEpisodes.map(ep => {
                    return (
                      <div
                        key={ep.id ?? ep.episode_number}
                        aria-label={`${ep.name || `Episode ${ep.episode_number}`}, preview only`}
                        className="group relative flex flex-col rounded-2xl overflow-hidden text-left bg-black shrink-0"
                        style={{
                          ringWidth: '1px',
                          ringColor: 'rgba(255,255,255,0.1)'
                        }}
                      >
                        <div className="absolute inset-0 border-2 border-white/5 rounded-2xl pointer-events-none z-20"></div>
                        
                        {/* Thumbnail */}
                        <div className="relative w-full aspect-video bg-[#0d1117] overflow-hidden">
                          {ep.still_path ? (
                            <img
                              src={`${STILL}${ep.still_path}`}
                              alt=""
                              className="w-full h-full object-cover"
                              draggable={false}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <BiTv className="text-gray-700 text-2xl" />
                            </div>
                          )}

                          <span className="absolute top-2 left-2 bg-black/80 backdrop-blur-md text-white/90 text-[10px] font-bold px-2 py-1 rounded-md border border-white/10 z-10">
                            E{ep.episode_number}
                          </span>

                        </div>

                        {/* Info */}
                        <div className="px-4 py-3.5 flex-1 relative z-10 bg-[#151821]">
                          <p className="text-sm font-bold line-clamp-2 leading-snug text-gray-300">
                            {ep.name || `Episode ${ep.episode_number}`}
                          </p>
                          {ep.runtime && (
                            <p className="text-[11px] text-gray-500 font-medium mt-1.5">{ep.runtime} min</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-10 text-center text-gray-500 bg-white/[0.02] rounded-2xl border border-white/5">
                  <p className="text-sm">{episodeQuery.trim() ? 'No episodes found matching your search.' : 'No episodes available for this season.'}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── WATCH PROVIDERS ── */}
      <section className="px-4 sm:px-6 md:px-12 pb-12">
        <div className="max-w-7xl mx-auto rounded-[2rem] border border-white/10 bg-white/[0.02] p-5 sm:p-6 md:p-8 backdrop-blur-md shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
            <div>
              <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-red-400">Availability</p>
              <h3 className="mt-2 text-2xl md:text-3xl font-black text-white">Available in {selectedRegionLabel}</h3>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-200">
              <span className="text-lg">{availablePlatformCount}</span>
              <span className="text-gray-400">platform{availablePlatformCount === 1 ? '' : 's'}</span>
            </div>
          </div>

          {providerCards.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {providerCards.map((provider) => {
                const providerLink = getProviderDirectLink(provider.provider_name) || `https://www.justwatch.com/in/search?q=${encodeURIComponent(provider.provider_name)}`;
                const badgeLabels = provider.types.map((type) => providerTypeLabels[type]).filter(Boolean);

                return (
                  <a
                    key={provider.provider_id}
                    href={providerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#10141b] px-4 py-3 text-left transition-all duration-300 hover:-translate-y-1 hover:border-red-500/40 hover:bg-[#141b25]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {provider.logo_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w92${provider.logo_path}`}
                          alt={provider.provider_name}
                          className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-xs font-bold text-white ring-1 ring-white/10">
                          {provider.provider_name?.slice(0, 2).toUpperCase() || 'TV'}
                        </div>
                      )}

                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-white">{provider.provider_name}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {badgeLabels.map((label) => (
                            <span key={`${provider.provider_id}-${label}`} className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-200">
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-lg bg-red-600/15 px-2.5 py-1.5 text-xs font-bold text-red-300 transition-colors group-hover:bg-red-600 group-hover:text-white">
                      Watch
                    </span>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-6 text-center text-gray-400">
              <p className="text-lg font-semibold text-white">No watch providers are currently listed for this title in {selectedRegionLabel}.</p>
            </div>
          )}

          {formattedLastUpdated && (
            <p className="mt-5 text-xs text-gray-400">
              Last updated: {formattedLastUpdated}
            </p>
          )}
        </div>
      </section>

      {/* ── REVIEWS ── */}
      <section className="px-4 sm:px-6 md:px-12 pb-16">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h3 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-3">
              <span className="w-1.5 h-6 bg-red-500 rounded-full inline-block"></span>
              Reviews
            </h3>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-gray-300">
              {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.02] p-5 sm:p-6">
              {reviews.length > 0 ? (
                <div className="space-y-4">
                  {reviews.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-[#10141b] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-red-500/25 to-white/10 text-sm font-bold text-white ring-1 ring-white/10">
                            {(item.userName || 'N').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{item.userName || 'Noctiva user'}</p>
                            <p className="text-[11px] text-gray-400">
                              {item.createdAt?.toDate ? new Date(item.createdAt.toDate()).toLocaleDateString('en-IN', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              }) : 'Just now'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-yellow-400">
                          {Array.from({ length: 5 }).map((_, index) => (
                            <FaStar key={index} className={index < (Number(item.rating) || 0) ? 'fill-current' : 'text-gray-600'} />
                          ))}
                        </div>
                      </div>
                      <p className="mt-3 leading-relaxed text-sm text-gray-300">{item.review}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-6 text-center text-gray-400">
                  {reviewError || 'No reviews yet. Be the first to share your thoughts.'}
                </div>
              )}
            </div>

            <form onSubmit={handleReviewSubmit} className="rounded-[2rem] border border-white/10 bg-white/[0.02] p-5 sm:p-6">
              <h4 className="text-lg font-bold text-white">Write a review</h4>
              <p className="mt-1 text-sm text-gray-400">
                {user ? 'Share your experience with this show.' : 'Sign in to add your review.'}
              </p>

              <div className="mt-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Your rating</label>
                <div className="flex items-center gap-1.5 text-2xl">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setReviewRating(index + 1)}
                      className="transition-colors"
                      aria-label={`Rate ${index + 1} star${index === 0 ? '' : 's'}`}
                    >
                      <FaStar className={index < reviewRating ? 'text-yellow-400' : 'text-gray-600'} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Review</label>
                <textarea
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  rows={6}
                  maxLength={500}
                  placeholder={user ? 'What did you like or dislike about this show?' : 'Please sign in to leave a review.'}
                  disabled={!user || reviewSubmitting}
                  className="w-full rounded-2xl border border-white/10 bg-[#0d1117] px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:border-red-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {reviewError && (
                <p className="mt-3 text-sm text-red-400">{reviewError}</p>
              )}

              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500">{reviewText.trim().length}/500</span>
                <button
                  type="submit"
                  disabled={!user || reviewSubmitting || !reviewText.trim()}
                  className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-900/40"
                >
                  {reviewSubmitting ? 'Posting...' : 'Post Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ── CAST & CREW ── */}
      {tv.credits?.cast && tv.credits.cast.length > 0 && (
        <CastRow cast={tv.credits.cast} />
      )}

      {/* ── RELATED TITLES ── */}
      {related.length > 0 && (
        <section className="px-4 sm:px-6 md:px-12 pb-16">
          <div className="max-w-7xl mx-auto">
            <h3 className="text-xl md:text-2xl font-bold text-white mb-6 tracking-tight flex items-center gap-3">
              <span className="w-1.5 h-6 bg-red-500 rounded-full inline-block"></span>
              More Like This
            </h3>
            
            <div
              ref={relatedListRef}
              onMouseDown={onRelatedMouseDown}
              onMouseMove={onRelatedMouseMove}
              onMouseLeave={endRelatedDrag}
              className={`grid grid-flow-col auto-cols-[140px] md:auto-cols-[180px] gap-4 md:gap-5 overflow-x-auto hide-scrollbar px-4 pt-6 pb-6 -mx-4 -mt-6 select-none ${isDraggingRelated ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
              {related.map((item) => (
                <div key={item.id} className="shrink-0 transition-transform duration-300 hover:-translate-y-2">
                  <ContentCard
                    title={item.name || item.title}
                    poster={item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/placeholder.svg'}
                    rating={item.vote_average}
                    releaseDate={item.first_air_date}
                    onClick={() => {
                      if (suppressRelatedClickRef.current) return;
                      handleRelatedSelect(item);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FOOTER ── */}
      <footer className="bg-[#040507] border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs md:text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <span className="text-white font-black text-base">NOCTIVA</span>
            <span className="mx-2 opacity-50">|</span>
          </div>
          <div className="flex items-center gap-2">
            <span>© {new Date().getFullYear()} NOCTIVA</span>
            <span className="mx-2 opacity-50">|</span>
            <span>
              Data by{' '}
              <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors font-medium">
                TMDB
              </a>
            </span>
          </div>
        </div>
      </footer>
      
      {/* Auth Modal Form */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  );
};

TvDetails.propTypes = {
  tvId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default memo(TvDetails);
