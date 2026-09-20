import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const STORAGE_KEY = (uid) => `noctiva_watchlist_${uid}`;

const WatchlistContext = createContext(null);

export function WatchlistProvider({ children }) {
  const [user, setUser] = useState(null);
  const [watchlistIds, setWatchlistIds] = useState(new Set());
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [ready, setReady] = useState(false);

  // Track auth state
  useEffect(() => {
    let signOutTimer;
    const unsub = onAuthStateChanged(auth, (u) => {
      clearTimeout(signOutTimer);
      if (!u) {
        // Firebase can briefly report null while restoring auth after sleep.
        // Preserve the current state until that restoration settles.
        signOutTimer = setTimeout(() => {
          setUser(null);
          setWatchlistIds(new Set());
          setWatchlistItems([]);
          setReady(true);
        }, 500);
        return;
      }

      setUser(u);

      // ── Load from localStorage cache immediately so buttons show right away ──
      setWatchlistIds(new Set());
      setWatchlistItems([]);
      setReady(false);
      try {
        const cached = localStorage.getItem(STORAGE_KEY(u.uid));
        if (cached) {
          const { ids, items } = JSON.parse(cached);
          const validIds = Array.isArray(ids) ? ids.map(String) : [];
          const validItems = Array.isArray(items) ? items : [];
          setWatchlistIds(new Set(validIds));
          setWatchlistItems(validItems);
          setReady(true); // already ready from cache
        }
      } catch (error) {
        console.warn('Unable to restore watchlist cache:', error);
      }
    });
    return () => {
      clearTimeout(signOutTimer);
      unsub();
    };
  }, []);

  // Subscribe to Firestore — confirms / corrects the localStorage cache
  useEffect(() => {
    if (!user) return;

    const ref = collection(db, 'users', user.uid, 'watchlist');
    const unsub = onSnapshot(ref, (snapshot) => {
      if (snapshot.empty && snapshot.metadata.fromCache) {
        setReady(true);
        return;
      }

      const ids = new Set();
      const items = [];
      snapshot.forEach((d) => {
        ids.add(String(d.data().mediaId));
        items.push({ id: d.id, ...d.data() });
      });

      const sorted = items.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
      setWatchlistIds(ids);
      setWatchlistItems(sorted);
      setReady(true);

      // Persist to localStorage so next refresh is instant
      try {
        localStorage.setItem(STORAGE_KEY(user.uid), JSON.stringify({ ids: [...ids], items: sorted }));
      } catch { /* quota exceeded — ignore */ }
    }, (error) => {
      console.error('Failed to sync watchlist:', error);
      // Keep the last known cache instead of replacing it with an empty list
      // when Firebase is temporarily unavailable after a server restart.
      setReady(true);
    });

    return () => unsub();
  }, [user]);

  const toggleWatchlist = useCallback(async (item, onNeedAuth) => {
    if (!user) {
      onNeedAuth?.();
      return;
    }
    const id = String(item.mediaId);
    const ref = doc(db, 'users', user.uid, 'watchlist', id);
    try {
      if (watchlistIds.has(id)) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, {
          ...item,
          addedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Failed to update watchlist:', error);
      throw error;
    }

  }, [user, watchlistIds]);

  WatchlistProvider.propTypes = {
    children: PropTypes.node.isRequired,
  };

  return (
    <WatchlistContext.Provider value={{ watchlistIds, watchlistItems, toggleWatchlist, ready, user }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlist must be used inside WatchlistProvider');
  return ctx;
}
