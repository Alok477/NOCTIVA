# NOCTIVA — Movie Matcher & Tracker

A modern movie and TV discovery, matching, and tracking app built with **React 18**, **Vite**, and **Tailwind CSS**. Browse trending content, find titles for your mood, track viewing history, and manage a personal watchlist — all powered by the TMDB API.

## Preview

![NOCTIVA Preview]()

---

## Features

- **Trending by default** — Movies and TV Shows pages open with this week's trending content from TMDB
- **Sidebar navigation** — Collapsible icon sidebar with genre lists, special categories (Anime, K-Drama, C-Drama, Donghua), and smooth hover-expand
- **Genre filtering** — Browse any genre; URL updates so links are shareable (e.g. `/movies?genre=28`)
- **Sort options** — Sort by Most Popular, Top Rated, Newest, Oldest, or Highest Grossing (movies)
- **Special categories** — Curated filters for Anime, K-Drama, C-Drama, and Donghua on the TV Shows page
- **Global content** — No language restriction; shows movies and shows from all countries
- **Detail pages** — Full-bleed backdrop hero with poster, rating, genres, tagline, overview, and production info at `/movie/:slug` and `/tv/:slug`
- **In-browser player** — Embedded video player on every detail page with click-to-activate scroll overlay
- **Episode selector** — TV detail page includes season tabs and episode cards with thumbnails
- **Search** — Search movies and TV shows with live results; genre chips let you jump directly to a category
- **Infinite scroll** — Content grids load more as you scroll, with skeleton loaders and error handling
- **Slug URLs** — Human-readable URLs like `/movie/550-fight-club` for better sharing
- **User Authentication** — Secure login and signup powered by Firebase Auth
- **Personal Watchlist** — Save your favorite movies and TV shows to a personal, cloud-synced watchlist
- **Continue Watching** — Automatically tracks your viewing progress and displays a quick-resume row on the homepage seamlessly synced with Firestore
- **Dynamic SEO** — Auto-generated layout meta tags, and page titles updating dynamically per context

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) |
| Routing | [React Router v6](https://reactrouter.com/) |
| Animations | [Framer Motion](https://www.framer.com/motion/) |
| Icons | [react-icons](https://react-icons.github.io/react-icons/) (Boxicons + FontAwesome) |
| Backend & DB | [Firebase](https://firebase.google.com/) (Auth, Firestore DB, Hosting) |
| Data | [TMDB API](https://www.themoviedb.org/documentation/api) |

---
