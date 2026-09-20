import { memo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { FaPlay } from 'react-icons/fa';

const API_KEY = import.meta.env.VITE_TMDB_API;
const BASE_URL = import.meta.env.VITE_BASE_URL;

const VideoPlayer = ({ movieId }) => {
    const [trailerKey, setTrailerKey] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!movieId) return undefined;
        let cancelled = false;
        setLoading(true);
        setTrailerKey(null);
        fetch(`${BASE_URL}/movie/${movieId}/videos?api_key=${API_KEY}&language=en-US`)
            .then(response => response.json())
            .then(data => {
                if (cancelled) return;
                const youtubeVideos = data.results?.filter(video => video.site === 'YouTube') ?? [];
                const trailer = youtubeVideos.find(video => video.type === 'Trailer') ?? youtubeVideos[0];
                setTrailerKey(trailer?.key ?? null);
            })
            .catch(() => { if (!cancelled) setTrailerKey(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [movieId]);

    if (!movieId) return null;

    return (
        <div className="w-full flex flex-col gap-3">
            <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden ring-1 ring-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                {loading && <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">Loading trailer...</div>}
                {!loading && trailerKey && (
                    <iframe
                        src={`https://www.youtube.com/embed/${trailerKey}?rel=0&modestbranding=1&playsinline=1`}
                        title="Movie trailer"
                        className="absolute inset-0 w-full h-full border-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="origin"
                    />
                )}
                {!loading && !trailerKey && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-gray-400">
                        <FaPlay className="text-red-500 text-xl" />
                        <p className="text-sm">No trailer is available for this title.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

VideoPlayer.propTypes = {
    movieId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    title: PropTypes.string,
};

export default memo(VideoPlayer);
