import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Headphones,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sun,
  Volume2,
  X,
} from 'lucide-solid';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from 'solid-js';

type PodcastTag = {
  tagName: string;
  searchName?: string;
};

type Chapter = {
  startTime: number;
  title: string;
};

type Podcast = {
  id: string;
  legacyID?: string;
  num: number;
  title: string;
  date: string;
  originalPublicationDate?: string | null;
  length: number;
  description: string;
  tags: PodcastTag[];
  chapters?: Chapter[];
  urls: {
    audio?: string;
    thumbnail?: string;
    youtube?: string;
    rumble?: string;
    lbry?: string;
    bitchute?: string;
    x?: string;
    substack?: string;
    freedomain_members?: string;
  };
};

type PodcastResponse = {
  podcasts: Podcast[];
  pageSize: number;
  pageNumber: number;
  totalPodcasts: number;
};

type PopularTag = {
  tagName: string;
  searchName: string;
  podcastCount: number;
};

type DurationFilter = 'any' | 'short' | 'medium' | 'long' | 'epic';
type DateFilter = 'any' | 'year' | '2020s' | '2010s' | 'early';
type SortOrder = 'date desc' | 'date asc';
type DetailExitMode = 'dismiss' | 'player' | null;

const API_URL = 'https://fdpodcasts.com/api/v2/podcasts/';
const PAGE_SIZE = 12;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

const FORMAT_OPTIONS = [
  { key: 'solo', label: 'Solo', count: 68 },
  { key: 'livestream', label: 'Livestreams', count: 503 },
  { key: 'call-in-show', label: 'Call-in shows', count: 1339 },
  { key: 'interview', label: 'Interviews', count: 284 },
  { key: 'debate', label: 'Debates', count: 101 },
] as const;

const FORMAT_TAGS = new Set([
  ...FORMAT_OPTIONS.map((item) => item.key),
  'conversation',
  'listener-questions',
  'Q&A',
  'ask-me-anything',
  'movie-review',
  'speech',
  'live-speech',
  'stef-and-izzy',
  'true-news',
]);

const FALLBACK_TOPICS: PopularTag[] = [
  ['philosophy', 'philosophy', 1400],
  ['relationships', 'relationships', 930],
  ['parenting', 'parenting', 720],
  ['psychology', 'psychology', 650],
  ['politics', 'politics', 630],
  ['morality', 'morality', 590],
  ['libertarianism', 'libertarianism', 520],
  ['childhood', 'childhood', 480],
  ['family', 'family', 450],
  ['bitcoin', 'bitcoin', 190],
].map(([tagName, searchName, podcastCount]) => ({
  tagName: String(tagName),
  searchName: String(searchName),
  podcastCount: Number(podcastCount),
}));

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' });

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
};

const formatClock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
};

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));

const episodeTags = (episode: Podcast) =>
  (episode.tags ?? []).map((tag) => tag.tagName);

const primaryFormat = (episode: Podcast) => {
  const tags = episodeTags(episode);
  const direct = FORMAT_OPTIONS.find((option) => tags.includes(option.key));
  if (direct) return direct.label.replace(/s$/, '');
  if (tags.includes('listener-questions') || tags.includes('Q&A')) return 'Listener Q&A';
  if (tags.includes('conversation')) return 'Conversation';
  if (tags.includes('movie-review')) return 'Movie review';
  if (tags.includes('speech') || tags.includes('live-speech')) return 'Speech';
  if (tags.includes('stef-and-izzy')) return 'Stefan & Izzy';
  if (tags.includes('true-news')) return 'True News';
  return 'Other';
};

const cleanDescription = (description = '') => {
  const markers = [
    '\n\nJOIN ME',
    '\n\nGET FREEDOMAIN',
    '\n\nSUBSCRIBE TO ME',
    '\n\nJoin the PREMIUM',
  ];
  const cutAt = markers
    .map((marker) => description.indexOf(marker))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  return (cutAt ? description.slice(0, cutAt) : description).trim();
};

const durationMatches = (seconds: number, filter: DurationFilter) => {
  if (filter === 'short') return seconds < 1800;
  if (filter === 'medium') return seconds >= 1800 && seconds < 3600;
  if (filter === 'long') return seconds >= 3600 && seconds < 7200;
  if (filter === 'epic') return seconds >= 7200;
  return true;
};

const dateMatches = (date: string, filter: DateFilter) => {
  if (filter === 'any') return true;
  const year = new Date(date).getFullYear();
  if (filter === 'year') return Date.now() - new Date(date).getTime() < 365 * 86400000;
  if (filter === '2020s') return year >= 2020;
  if (filter === '2010s') return year >= 2010 && year < 2020;
  return year < 2010;
};

export default function App() {
  const [theme, setTheme] = createSignal<'light' | 'dark'>('light');
  const [query, setQuery] = createSignal('');
  const [debouncedQuery, setDebouncedQuery] = createSignal('');
  const [selectedFormats, setSelectedFormats] = createSignal<string[]>([]);
  const [selectedTopics, setSelectedTopics] = createSignal<string[]>([]);
  const [durationFilter, setDurationFilter] = createSignal<DurationFilter>('any');
  const [dateFilter, setDateFilter] = createSignal<DateFilter>('any');
  const [sortOrder, setSortOrder] = createSignal<SortOrder>('date desc');
  const [topicSearch, setTopicSearch] = createSignal('');
  const [popularTopics, setPopularTopics] = createSignal<PopularTag[]>(FALLBACK_TOPICS);
  const [episodes, setEpisodes] = createSignal<Podcast[]>([]);
  const [estimatedTotal, setEstimatedTotal] = createSignal(6386);
  const [page, setPage] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [selectedEpisode, setSelectedEpisode] = createSignal<Podcast>();
  const [detailExitMode, setDetailExitMode] = createSignal<DetailExitMode>(null);
  const [currentEpisode, setCurrentEpisode] = createSignal<Podcast>();
  const [playing, setPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [audioDuration, setAudioDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(1);
  const [playbackRate, setPlaybackRate] = createSignal(1);
  const [speedMenuOpen, setSpeedMenuOpen] = createSignal(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = createSignal(false);
  let searchInput!: HTMLInputElement;
  let audioRef!: HTMLAudioElement;
  let speedControlRef!: HTMLDivElement;
  let requestSerial = 0;
  let detailExitTimer: number | undefined;
  let episodeClickTimer: number | undefined;

  const filteredTopics = createMemo(() => {
    const needle = topicSearch().trim().toLowerCase();
    return popularTopics()
      .filter((tag) => !FORMAT_TAGS.has(tag.tagName))
      .filter((tag) => !needle || tag.searchName.toLowerCase().includes(needle))
      .slice(0, needle ? 40 : 24);
  });

  const visibleEpisodes = createMemo(() => {
    const formats = selectedFormats();
    const topics = selectedTopics();
    const numericQuery = /^\d+(?:\.\d+)?$/.test(debouncedQuery())
      ? Number(debouncedQuery())
      : null;
    return episodes().filter((episode) => {
      const tags = episodeTags(episode);
      const formatMatch = !formats.length || formats.some((format) => tags.includes(format));
      const topicMatch = topics.every((topic) => tags.includes(topic));
      return (
        (numericQuery === null || episode.num === numericQuery) &&
        formatMatch &&
        topicMatch &&
        durationMatches(episode.length, durationFilter()) &&
        dateMatches(episode.date, dateFilter())
      );
    });
  });

  const activeFilterCount = createMemo(
    () =>
      selectedFormats().length +
      selectedTopics().length +
      Number(durationFilter() !== 'any') +
      Number(dateFilter() !== 'any') +
      Number(Boolean(query().trim())),
  );

  const totalPages = createMemo(() => Math.max(1, Math.ceil(estimatedTotal() / PAGE_SIZE)));

  const paginationItems = createMemo<Array<number | 'ellipsis'>>(() => {
    const last = totalPages();
    const current = page() + 1;
    const candidates = new Set([1, last, current - 2, current - 1, current, current + 1, current + 2]);
    const pages = [...candidates].filter((value) => value >= 1 && value <= last).sort((a, b) => a - b);
    const items: Array<number | 'ellipsis'> = [];
    pages.forEach((value, index) => {
      if (index && value - pages[index - 1] > 1) items.push('ellipsis');
      items.push(value);
    });
    return items;
  });

  const loadEpisodes = async (nextPage: number) => {
    const serial = ++requestSerial;
    setLoading(true);
    setError('');
    const formats = selectedFormats();
    const topics = selectedTopics();
    const baseTag = topics[0] ?? formats[0];

    try {
      const params = new URLSearchParams({
        includeTagNames: 'true',
        sort: sortOrder(),
        pageNumber: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      const search = debouncedQuery().trim();
      if (/^\d+(?:\.\d+)?$/.test(search)) params.set('findWithPage', search);
      else if (search) params.set('search', search);
      if (baseTag) params.set('tag', baseTag);

      const apiResponse = await fetch(`${API_URL}?${params}`);
      const response: PodcastResponse = apiResponse.status === 404
        ? { podcasts: [], totalPodcasts: 0, pageNumber: nextPage, pageSize: PAGE_SIZE }
        : await apiResponse.json();
      if (!apiResponse.ok && apiResponse.status !== 404) {
        throw new Error(`The archive returned ${apiResponse.status}.`);
      }

      if (serial !== requestSerial) return;
      const nextEpisodes = [...(response.podcasts ?? [])].sort((a, b) =>
        sortOrder() === 'date desc'
          ? new Date(b.date).getTime() - new Date(a.date).getTime()
          : new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      setEstimatedTotal(response.totalPodcasts ?? 0);
      setEpisodes(nextEpisodes);
    } catch (caught) {
      if (serial !== requestSerial) return;
      setError(caught instanceof Error ? caught.message : 'The archive could not be reached.');
      setEpisodes([]);
    } finally {
      if (serial === requestSerial) {
        setLoading(false);
      }
    }
  };

  createEffect(() => {
    const nextQuery = query().trim();
    const timer = window.setTimeout(() => setDebouncedQuery(nextQuery), 350);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(
    on(
      [debouncedQuery, selectedFormats, selectedTopics, durationFilter, dateFilter, sortOrder],
      () => {
        setPage(0);
        void loadEpisodes(0);
      },
      { defer: false },
    ),
  );

  const openDetails = (episode: Podcast) => {
    if (detailExitTimer) window.clearTimeout(detailExitTimer);
    setDetailExitMode(null);
    setSelectedEpisode(episode);
  };

  const closeDetails = (mode: Exclude<DetailExitMode, null> = 'dismiss') => {
    if (!selectedEpisode()) return;
    if (detailExitTimer) window.clearTimeout(detailExitTimer);
    setDetailExitMode(mode);
    detailExitTimer = window.setTimeout(() => {
      setSelectedEpisode(undefined);
      setDetailExitMode(null);
      detailExitTimer = undefined;
    }, mode === 'player' ? 240 : 150);
  };

  onMount(() => {
    const savedTheme = localStorage.getItem('fdr-theme');
    const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
    applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : preferredTheme);

    const savedVolume = localStorage.getItem('fdr-volume');
    if (savedVolume !== null) {
      const parsedVolume = Number(savedVolume);
      if (Number.isFinite(parsedVolume) && parsedVolume >= 0 && parsedVolume <= 1) {
        setVolume(parsedVolume);
        audioRef.volume = parsedVolume;
      }
    } else {
      setVolume(1);
      audioRef.volume = 1;
    }

    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchInput.focus();
      }
      if (event.key === 'Escape') {
        setSpeedMenuOpen(false);
        closeDetails();
      }
    };
    const closeSpeedMenu = (event: PointerEvent) => {
      if (
        speedMenuOpen() &&
        speedControlRef &&
        !speedControlRef.contains(event.target as Node)
      ) {
        setSpeedMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeys);
    window.addEventListener('pointerdown', closeSpeedMenu);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeys);
      window.removeEventListener('pointerdown', closeSpeedMenu);
      if (detailExitTimer) window.clearTimeout(detailExitTimer);
      if (episodeClickTimer) window.clearTimeout(episodeClickTimer);
    });

    void fetch('https://fdpodcasts.com/api/?method=ListPopularTags')
      .then((response) => response.json())
      .then((data) => {
        const tags = (data?.result?.podcastTags ?? []) as PopularTag[];
        const sorted = tags
          .filter((tag) => tag.podcastCount > 0)
          .sort((a, b) => b.podcastCount - a.podcastCount);
        if (sorted.length) setPopularTopics(sorted);
      })
      .catch(() => undefined);
  });

  const applyTheme = (nextTheme: 'light' | 'dark') => {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      nextTheme === 'dark' ? '#0d0e0f' : '#f3f3f2',
    );
    localStorage.setItem('fdr-theme', nextTheme);
  };

  const toggleValue = (
    setter: (value: string[] | ((previous: string[]) => string[])) => void,
    value: string,
  ) => {
    setter((previous: string[]) =>
      previous.includes(value)
        ? previous.filter((item) => item !== value)
        : [...previous, value],
    );
  };

  const clearFilters = () => {
    setQuery('');
    setDebouncedQuery('');
    setSelectedFormats([]);
    setSelectedTopics([]);
    setDurationFilter('any');
    setDateFilter('any');
    setTopicSearch('');
  };

  const clearSearch = () => {
    setQuery('');
    setDebouncedQuery('');
    searchInput.focus();
  };

  const beginPlayback = (episode: Podcast, startAt = 0) => {
    if (!episode.urls.audio) return;
    const isNew = currentEpisode()?.id !== episode.id;
    setCurrentEpisode(episode);
    closeDetails('player');
    queueMicrotask(() => {
      if (isNew) audioRef.load();
      audioRef.volume = volume();
      audioRef.playbackRate = playbackRate();
      audioRef.currentTime = startAt;
      void audioRef.play().catch(() => setPlaying(false));
    });
  };

  const openEpisodeOnSingleClick = (episode: Podcast) => {
    if (episodeClickTimer) window.clearTimeout(episodeClickTimer);
    episodeClickTimer = window.setTimeout(() => {
      openDetails(episode);
      episodeClickTimer = undefined;
    }, 240);
  };

  const playEpisodeOnDoubleClick = (episode: Podcast) => {
    if (episodeClickTimer) window.clearTimeout(episodeClickTimer);
    episodeClickTimer = undefined;
    beginPlayback(episode);
  };

  const togglePlayback = () => {
    if (!currentEpisode()) return;
    if (audioRef.paused) void audioRef.play();
    else audioRef.pause();
  };

  const seekTo = (nextTime: number) => {
    if (!currentEpisode()) return;
    audioRef.currentTime = Math.max(0, Math.min(audioRef.duration || Infinity, nextTime));
    setCurrentTime(audioRef.currentTime);
  };

  const updateVolume = (nextVolume: number) => {
    setVolume(nextVolume);
    audioRef.volume = nextVolume;
    localStorage.setItem('fdr-volume', String(nextVolume));
  };

  const choosePlaybackSpeed = (nextRate: number) => {
    setPlaybackRate(nextRate);
    audioRef.playbackRate = nextRate;
    setSpeedMenuOpen(false);
  };

  const closePlayer = () => {
    audioRef.pause();
    setSpeedMenuOpen(false);
    setPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    setCurrentEpisode(undefined);
    queueMicrotask(() => audioRef.load());
  };

  const goToPage = (nextPage: number) => {
    const bounded = Math.max(0, Math.min(totalPages() - 1, nextPage));
    if (bounded === page() && episodes().length) return;
    setPage(bounded);
    void loadEpisodes(bounded);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div class="app-shell" classList={{ 'has-player': Boolean(currentEpisode()) }}>
      <audio
        ref={audioRef}
        src={currentEpisode()?.urls.audio}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(audioRef.currentTime)}
        onLoadedMetadata={() => setAudioDuration(audioRef.duration)}
        onDurationChange={() => setAudioDuration(audioRef.duration)}
      />

      <header class="topbar">
        <a class="brand" href="#top" aria-label="Freedomain Archive home">
          <img class="brand-logo" src="/freedomain-logo.png" alt="Freedomain" />
        </a>
        <button
          class="theme-toggle"
          type="button"
          onClick={() => applyTheme(theme() === 'dark' ? 'light' : 'dark')}
          aria-label={`Use ${theme() === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme() === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          <span>{theme() === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </header>

      <main class="dashboard" id="top">
        <button
          class="mobile-filter-toggle"
          type="button"
          onClick={() => setMobileFiltersOpen((open) => !open)}
          aria-expanded={mobileFiltersOpen()}
          aria-controls="podcast-filters"
        >
          <SlidersHorizontal size={15} />
          <span>Filters</span>
          <Show when={activeFilterCount()}><small>{activeFilterCount()}</small></Show>
          <ChevronDown class={mobileFiltersOpen() ? 'filter-chevron open' : 'filter-chevron'} size={15} />
        </button>

        <aside
          id="podcast-filters"
          class="filter-sidebar"
          classList={{ 'mobile-open': mobileFiltersOpen() }}
          aria-label="Podcast filters"
        >
          <div class="sidebar-search">
            <Search class="sidebar-search-icon" size={15} aria-hidden="true" />
            <input
              ref={searchInput}
              aria-label="Search the archive"
              placeholder="Search episodes"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <Show when={query()}>
              <button class="search-clear" type="button" onClick={clearSearch} aria-label="Clear search"><X size={14} /></button>
            </Show>
          </div>

          <div class="filter-section">
            <span class="filter-label">Format</span>
            <button class="filter-option" classList={{ active: selectedFormats().length === 0 }} type="button" onClick={() => setSelectedFormats([])}>
              <span>All episodes</span>
              <small>6.4k</small>
            </button>
            <For each={FORMAT_OPTIONS}>{(format) => (
              <button
                class="filter-option"
                classList={{ active: selectedFormats().includes(format.key) }}
                type="button"
                onClick={() => setSelectedFormats(selectedFormats().includes(format.key) ? [] : [format.key])}
              >
                <span>{format.label}</span>
                <small>{compactNumber.format(format.count)}</small>
              </button>
            )}</For>
          </div>

          <div class="filter-section topic-section">
            <span class="filter-label">Topics</span>
            <label class="topic-filter-input">
              <Search size={13} />
              <input placeholder="Filter topics" value={topicSearch()} onInput={(event) => setTopicSearch(event.currentTarget.value)} />
            </label>
            <div class="sidebar-topics">
              <For each={filteredTopics()}>{(topic) => (
                <button
                  type="button"
                  classList={{ active: selectedTopics().includes(topic.tagName) }}
                  onClick={() => toggleValue(setSelectedTopics, topic.tagName)}
                >
                  <span class="topic-check"><Show when={selectedTopics().includes(topic.tagName)}><Check size={11} /></Show></span>
                  <span>{topic.searchName}</span>
                  <small>{compactNumber.format(topic.podcastCount)}</small>
                </button>
              )}</For>
            </div>
          </div>

          <div class="filter-section select-section">
            <label>
              <span>Duration</span>
              <select value={durationFilter()} onInput={(event) => setDurationFilter(event.currentTarget.value as DurationFilter)}>
                <option value="any">Any</option>
                <option value="short">Under 30 min</option>
                <option value="medium">30—60 min</option>
                <option value="long">1—2 hours</option>
                <option value="epic">Over 2 hours</option>
              </select>
            </label>
            <label>
              <span>Date</span>
              <select value={dateFilter()} onInput={(event) => setDateFilter(event.currentTarget.value as DateFilter)}>
                <option value="any">Any</option>
                <option value="year">Past year</option>
                <option value="2020s">2020s</option>
                <option value="2010s">2010s</option>
                <option value="early">Before 2010</option>
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select value={sortOrder()} onInput={(event) => setSortOrder(event.currentTarget.value as SortOrder)}>
                <option value="date desc">Newest</option>
                <option value="date asc">Oldest</option>
              </select>
            </label>
          </div>

          <button class="clear-filters" type="button" disabled={!activeFilterCount()} onClick={clearFilters}>
            Clear filters <Show when={activeFilterCount()}><span>{activeFilterCount()}</span></Show>
          </button>
        </aside>

        <section class="content-panel" aria-busy={loading()}>
          <Show when={loading()}>
            <div class="loading-list" aria-label="Loading episodes">
              <For each={Array.from({ length: PAGE_SIZE })}>{() => <div class="loading-row"><i /><i /></div>}</For>
            </div>
          </Show>

          <Show when={!loading() && error()}>
            <div class="state-card">
              <CircleAlert size={22} />
              <h3>Could not reach the archive</h3>
              <button type="button" onClick={() => void loadEpisodes(page())}>Retry</button>
            </div>
          </Show>

          <Show when={!loading() && !error() && visibleEpisodes().length === 0}>
            <div class="state-card">
              <Search size={22} />
              <h3>No matching episodes</h3>
              <button type="button" onClick={clearFilters}>Clear filters</button>
            </div>
          </Show>

          <Show when={!loading() && visibleEpisodes().length}>
            <div class="episode-list">
              <div class="episode-list-head" aria-hidden="true">
                <span>#</span><span>Length</span><span>Play</span><span>Episode</span><span>Published</span><span />
              </div>
              <For each={visibleEpisodes()}>{(episode) => (
                <div class="episode-row">
                  <button
                    class="episode-open"
                    type="button"
                    onClick={(event) => {
                      if (event.detail === 1) openEpisodeOnSingleClick(episode);
                    }}
                    onDblClick={() => playEpisodeOnDoubleClick(episode)}
                    aria-label={`View details for ${episode.title}; double-click to play`}
                    title="Double-click to play"
                  />
                  <span class="episode-number">{episode.num}</span>
                  <span class="episode-row-duration">{formatDuration(episode.length)}</span>
                  <button
                    class="episode-quick-play"
                    type="button"
                    disabled={!episode.urls.audio}
                    onClick={(event) => {
                      event.stopPropagation();
                      beginPlayback(episode);
                    }}
                    aria-label={`Play ${episode.title}`}
                  >
                    <Play size={12} fill="currentColor" />
                  </button>
                  <span class="episode-row-title"><strong>{episode.title}</strong><i>{primaryFormat(episode)}</i></span>
                  <time class="episode-date">{formatDate(episode.date)}</time>
                  <ChevronRight class="row-arrow" size={15} />
                </div>
              )}</For>
            </div>
          </Show>

          <Show when={!loading() && !error() && totalPages() > 1}>
            <nav class="pagination" aria-label="Episode pages">
              <button type="button" onClick={() => goToPage(page() - 1)} disabled={page() === 0} aria-label="Previous page"><ChevronLeft size={15} /></button>
              <For each={paginationItems()}>{(item) => (
                <Show when={item !== 'ellipsis'} fallback={<span>…</span>}>
                  <button classList={{ active: item === page() + 1 }} type="button" onClick={() => goToPage(Number(item) - 1)}>{item}</button>
                </Show>
              )}</For>
              <button type="button" onClick={() => goToPage(page() + 1)} disabled={page() + 1 >= totalPages()} aria-label="Next page"><ChevronRight size={15} /></button>
            </nav>
          </Show>
        </section>
      </main>

      <Show when={selectedEpisode()} keyed>{(episode) => (
        <div
          class="detail-layer"
          classList={{
            dismissing: detailExitMode() === 'dismiss',
            'to-player': detailExitMode() === 'player',
          }}
          role="presentation"
        >
          <button class="detail-scrim" type="button" onClick={() => closeDetails()} aria-label="Close episode details" />
          <aside class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <div class="detail-toolbar">
              <span>Episode #{episode.num}</span>
              <button type="button" onClick={() => closeDetails()} aria-label="Close details">
                <X size={15} />
              </button>
            </div>

            <div class="detail-hero">
              <Show when={episode.urls.thumbnail} fallback={<div class="detail-art-fallback">FDR<br />{episode.num}</div>}>
                <img src={episode.urls.thumbnail} alt={`${episode.title} cover`} />
              </Show>
              <div>
                <span class="episode-meta detail-meta">
                  <b>{primaryFormat(episode)}</b>
                  <span>{formatDate(episode.date)}</span>
                  <span>{formatDuration(episode.length)}</span>
                </span>
                <h2 id="detail-title">{episode.title}</h2>
                <button class="primary-play" type="button" onClick={() => beginPlayback(episode)} disabled={!episode.urls.audio}>
                  <Show when={currentEpisode()?.id === episode.id && playing()} fallback={<Play size={18} fill="currentColor" />}>
                    <Pause size={18} fill="currentColor" />
                  </Show>
                  {currentEpisode()?.id === episode.id && playing() ? 'Playing now' : 'Play episode'}
                </button>
              </div>
            </div>

            <section class="detail-section">
              <span class="detail-label">About this episode</span>
              <For each={cleanDescription(episode.description).split(/\n\n+/).filter(Boolean)}>
                {(paragraph) => <p>{paragraph}</p>}
              </For>
            </section>

            <Show when={episode.chapters?.length}>
              <section class="detail-section">
                <span class="detail-label">Chapters</span>
                <div class="chapter-list">
                  <For each={episode.chapters?.slice(0, 16)}>{(chapter) => (
                    <button type="button" onClick={() => beginPlayback(episode, chapter.startTime)}>
                      <time>{formatClock(chapter.startTime)}</time>
                      <span>{chapter.title}</span>
                      <Play size={13} fill="currentColor" />
                    </button>
                  )}</For>
                </div>
              </section>
            </Show>

            <section class="detail-section">
              <span class="detail-label">Topics</span>
              <div class="detail-tags">
                <For each={episode.tags}>{(tag) => (
                  <button
                    type="button"
                    onClick={() => {
                      if (!FORMAT_TAGS.has(tag.tagName)) toggleValue(setSelectedTopics, tag.tagName);
                      closeDetails();
                    }}
                  >
                    {tag.searchName ?? tag.tagName}
                  </button>
                )}</For>
              </div>
            </section>

            <section class="detail-section platform-section">
              <span class="detail-label">Also available on</span>
              <div class="platform-links">
                <Show when={episode.urls.youtube}><a href={episode.urls.youtube} target="_blank" rel="noreferrer">YouTube <ArrowUpRight size={14} /></a></Show>
                <Show when={episode.urls.rumble}><a href={episode.urls.rumble} target="_blank" rel="noreferrer">Rumble <ArrowUpRight size={14} /></a></Show>
                <Show when={episode.urls.lbry}><a href={episode.urls.lbry} target="_blank" rel="noreferrer">Odysee <ArrowUpRight size={14} /></a></Show>
                <Show when={episode.urls.substack}><a href={episode.urls.substack} target="_blank" rel="noreferrer">Substack <ArrowUpRight size={14} /></a></Show>
              </div>
            </section>
          </aside>
        </div>
      )}</Show>

      <Show when={currentEpisode()}>
      <footer class="player-shell" aria-label="Audio player">
        <button
          class="player-episode"
          type="button"
          disabled={!currentEpisode()}
          onClick={() => currentEpisode() && openDetails(currentEpisode()!)}
        >
          <Show
            when={currentEpisode()?.urls.thumbnail}
            fallback={<div class="player-placeholder"><Headphones size={22} /></div>}
          >
            <img src={currentEpisode()?.urls.thumbnail} alt="" />
          </Show>
          <div>
            <span>{currentEpisode()?.title ?? 'Ready when you are'}</span>
            <small>
              {currentEpisode()
                ? `${primaryFormat(currentEpisode()!)} · Episode #${currentEpisode()!.num}`
                : 'Choose an episode to start listening'}
            </small>
          </div>
        </button>

        <div class="player-center">
          <div class="player-controls-row">
            <div class="speed-control" ref={speedControlRef}>
              <button
                class="speed-button"
                type="button"
                onClick={() => setSpeedMenuOpen((open) => !open)}
                aria-label="Choose playback speed"
                aria-haspopup="menu"
                aria-expanded={speedMenuOpen()}
              >
                {playbackRate()}×
              </button>
              <Show when={speedMenuOpen()}>
                <div class="speed-menu" role="menu" aria-label="Playback speed">
                  <For each={PLAYBACK_RATES}>{(rate) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={playbackRate() === rate}
                      classList={{ active: playbackRate() === rate }}
                      onClick={() => choosePlaybackSpeed(rate)}
                    >
                      <span>{rate}×</span>
                      <Show when={playbackRate() === rate}><Check size={12} /></Show>
                    </button>
                  )}</For>
                </div>
              </Show>
            </div>

            <div class="transport-controls">
              <button class="skip-button" type="button" disabled={!currentEpisode()} onClick={() => seekTo(currentTime() - 15)} aria-label="Go back 15 seconds">
                <RotateCcw size={21} /><small>15</small>
              </button>
              <button class="main-play" type="button" disabled={!currentEpisode()} onClick={togglePlayback} aria-label={playing() ? 'Pause' : 'Play'}>
                <Show when={playing()} fallback={<Play size={20} fill="currentColor" />}>
                  <Pause size={19} fill="currentColor" />
                </Show>
              </button>
              <button class="skip-button" type="button" disabled={!currentEpisode()} onClick={() => seekTo(currentTime() + 30)} aria-label="Go forward 30 seconds">
                <RotateCw size={21} /><small>30</small>
              </button>
            </div>

            <div class="volume-control">
              <Volume2 size={16} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume()}
                aria-label="Volume"
                style={{ '--progress': `${volume() * 100}%` }}
                onInput={(event) => updateVolume(Number(event.currentTarget.value))}
              />
            </div>
          </div>
          <div class="timeline-row">
            <time>{formatClock(currentTime())}</time>
            <input
              type="range"
              min="0"
              max={audioDuration() || 1}
              step="1"
              value={currentTime()}
              disabled={!currentEpisode()}
              aria-label="Episode progress"
              style={{ '--progress': `${audioDuration() ? (currentTime() / audioDuration()) * 100 : 0}%` }}
              onInput={(event) => seekTo(Number(event.currentTarget.value))}
            />
            <time>{formatClock(audioDuration())}</time>
          </div>
        </div>

        <button class="player-close" type="button" onClick={closePlayer} aria-label="Close player and stop playback">
          <X size={16} />
        </button>
      </footer>
      </Show>
    </div>
  );
}
