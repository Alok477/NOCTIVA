import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BiUpArrowAlt, BiHomeAlt, BiMoviePlay, BiTv, BiSearch, BiBookmark } from 'react-icons/bi';
import { FaUserCircle, FaSignOutAlt, FaMagic } from 'react-icons/fa';
import Sidebar from './Sidebar';
import { buildBrowsePath, getCategoryBySlug } from './urlFilters';
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../../firebase";
import AuthModal from "../../components/AuthModal";

function ParentComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [scrollPosition, setScrollPosition] = useState(0);
  const [user, setUser] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    localStorage.removeItem('noctiva_theme');
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        localStorage.setItem('noctiva_user', JSON.stringify({
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
        }));
      } else {
        localStorage.removeItem('noctiva_user');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleOpenAuthModal = () => setIsAuthModalOpen(true);
    window.addEventListener('openAuthModal', handleOpenAuthModal);
    return () => window.removeEventListener('openAuthModal', handleOpenAuthModal);
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('noctiva_user');
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const activePage =
    location.pathname === '/'                  ? 'home'
    : location.pathname.startsWith('/movies')  ? 'movies'
    : location.pathname.startsWith('/series')  ? 'series'
    : location.pathname.startsWith('/search')  ? 'search'
    : location.pathname.startsWith('/watchlist') ? 'watchlist'
    : location.pathname.startsWith('/match-mood') ? 'match-mood'
    : location.pathname.startsWith('/movie/')  ? 'movies'
    : location.pathname.startsWith('/tv/')     ? 'series'
    : 'home';

  const handleScroll = useCallback(() => {
    setScrollPosition(window.scrollY);
  }, []);
  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const selectedGenreId = (() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'movies' && pathParts[1]) {
      return getCategoryBySlug('movie', pathParts[1])?.id ?? null;
    }
    if (pathParts[0] === 'series' && pathParts[1]) {
      return getCategoryBySlug('tv', pathParts[1])?.id ?? null;
    }
    return searchParams.get('genre') ? Number(searchParams.get('genre')) : null;
  })();

  const handleNavigation = (page) => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (page === 'home')        navigate('/');
    else if (page === 'movies') navigate('/movies');
    else if (page === 'series') navigate('/series');
    else if (page === 'match-mood') navigate('/match-mood');
    else                        navigate(`/${page}`);
  };

  const handleGenreSelect = (genreId) => {
    const type = activePage === 'series' ? 'tv' : 'movie';
    window.scrollTo({ top: 0, behavior: 'auto' });
    navigate(buildBrowsePath(type, genreId, 'popularity.desc'));
  };

  return (
    <div className="min-h-screen relative text-white">
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigation}
        selectedGenreId={selectedGenreId}
        onGenreSelect={handleGenreSelect}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        user={user}
      />

      {scrollPosition > 300 && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4 right-4 z-50 text-white p-3 rounded-full bg-white/10 hover:bg-white/20 shadow-lg hover:scale-110 transition-all duration-300"
          aria-label="Scroll to Top"
        >
          <BiUpArrowAlt className="text-2xl" />
        </button>
      )}

      {/* Page content */}
      <div className="md:pl-[84px] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />

        {/* Footer — home page only */}
        {location.pathname === '/' && <footer className="bg-[#0a0c12]">
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-gray-600">
            <div className="flex items-center gap-3">
              <span className="text-white font-black text-sm">NOC<span className="text-red-500">TIVA</span></span>
              <span>Developed by - ALOK KUMAR</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <span>© {new Date().getFullYear()} NOCTIVA</span>
                <span>·</span>
                <span>
                  Data by{' '}
                  <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white underline underline-offset-2 transition-colors">
                    TMDB
                  </a>
                </span>
              </div>
            </div>
          </div>
        </footer>}
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-[60] grid grid-cols-7 items-stretch border-t border-white/[0.08] bg-[#070b14]/95 px-1 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] shadow-[0_-10px_30px_rgba(0,0,0,0.55)] backdrop-blur-xl md:hidden">
        {[
          { id: 'match-mood', icon: FaMagic, label: 'Match Mood' },
          { id: 'home',   icon: BiHomeAlt,   label: 'Home'    },
          { id: 'search', icon: BiSearch,    label: 'Search'  },
          { id: 'movies', icon: BiMoviePlay, label: 'Movies'  },
          { id: 'series', icon: BiTv,        label: 'TV Shows' },
          { id: 'watchlist', icon: BiBookmark, label: 'Saved' },
        ].map(({ id, icon: Icon, label }) => {
          const isActive = activePage === id;
          return (
            <button
              key={id}
              onClick={() => handleNavigation(id)}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-colors ${
                isActive ? 'text-red-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="text-xl sm:text-2xl" />
              <span className="max-w-full truncate text-[9px] font-medium sm:text-[10px]">{label}</span>
            </button>
          );
        })}
        {/* Mobile Profile/Auth Button */}
        {user ? (
          <button
            onClick={handleLogout}
            className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1.5 text-red-500/80 transition-colors hover:text-red-400"
          >
            <FaSignOutAlt className="text-xl sm:text-2xl" />
            <span className="max-w-full truncate text-[9px] font-bold uppercase tracking-wider sm:text-[10px]">Log Out</span>
          </button>
        ) : (
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1.5 text-gray-500 transition-colors hover:text-gray-300"
          >
            <FaUserCircle className="text-xl sm:text-2xl" />
            <span className="max-w-full truncate text-[9px] font-medium sm:text-[10px]">Log In</span>
          </button>
        )}
      </nav>

      {/* Auth Modal Form */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  );
}

export default ParentComponent;
