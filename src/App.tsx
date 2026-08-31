import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FastForward,
  Headphones,
  ListFilter,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  RotateCcw,
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

const API_URL = 'https://fdpodcasts.com/api/v2/podcasts/';
const PAGE_SIZE = 48;

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
  const [topicMenuOpen, setTopicMenuOpen] = createSignal(false);
  const [popularTopics, setPopularTopics] = createSignal<PopularTag[]>(FALLBACK_TOPICS);
  const [episodes, setEpisodes] = createSignal<Podcast[]>([]);
  const [estimatedTotal, setEstimatedTotal] = createSignal(6386);
  const [page, setPage] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [error, setError] = createSignal('');
  const [selectedEpisode, setSelectedEpisode] = createSignal<Podcast>();
  const [currentEpisode, setCurrentEpisode] = createSignal<Podcast>();
  const [playing, setPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [audioDuration, setAudioDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(0.85);
  const [playbackRate, setPlaybackRate] = createSignal(1);
  let searchInput!: HTMLInputElement;
  let audioRef!: HTMLAudioElement;
  let requestSerial = 0;

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

  const canLoadMore = createMemo(
    () => episodes().length < estimatedTotal() && !loading() && !loadingMore(),
  );

  const loadEpisodes = async (nextPage: number, append: boolean) => {
    const serial = ++requestSerial;
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    const formats = selectedFormats();
    const topics = selectedTopics();
    const baseTags: Array<string | undefined> = topics.length
      ? [topics[0]]
      : formats.length
        ? formats
        : [undefined];

    try {
      const responses = await Promise.all(
        baseTags.map(async (tag) => {
          const params = new URLSearchParams({
            includeTagNames: 'true',
            sort: sortOrder(),
            pageNumber: String(nextPage),
            pageSize: String(PAGE_SIZE),
          });
          const search = debouncedQuery().trim();
          if (/^\d+(?:\.\d+)?$/.test(search)) params.set('findWithPage', search);
          else if (search) params.set('search', search);
          if (tag) params.set('tag', tag);
          const response = await fetch(`${API_URL}?${params}`);
          if (response.status === 404) {
            return {
              podcasts: [],
              totalPodcasts: 0,
              pageNumber: nextPage,
              pageSize: PAGE_SIZE,
            } as PodcastResponse;
          }
          if (!response.ok) throw new Error(`The archive returned ${response.status}.`);
          return response.json() as Promise<PodcastResponse>;
        }),
      );

      if (serial !== requestSerial) return;
      const merged = new Map<string, Podcast>();
      for (const response of responses) {
        for (const episode of response.podcasts ?? []) merged.set(episode.id, episode);
      }
      const nextEpisodes = [...merged.values()].sort((a, b) =>
        sortOrder() === 'date desc'
          ? new Date(b.date).getTime() - new Date(a.date).getTime()
          : new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      const totals = responses.reduce((sum, response) => sum + (response.totalPodcasts ?? 0), 0);
      setEstimatedTotal(totals);
      setEpisodes((previous) => {
        if (!append) return nextEpisodes;
        const combined = new Map(previous.map((episode) => [episode.id, episode]));
        nextEpisodes.forEach((episode) => combined.set(episode.id, episode));
        return [...combined.values()].sort((a, b) =>
          sortOrder() === 'date desc'
            ? new Date(b.date).getTime() - new Date(a.date).getTime()
            : new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      });
    } catch (caught) {
      if (serial !== requestSerial) return;
      setError(caught instanceof Error ? caught.message : 'The archive could not be reached.');
      if (!append) setEpisodes([]);
    } finally {
      if (serial === requestSerial) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  createEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query().trim()), 350);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(
    on(
      [debouncedQuery, selectedFormats, selectedTopics, sortOrder],
      () => {
        setPage(0);
        void loadEpisodes(0, false);
      },
      { defer: false },
    ),
  );

  onMount(() => {
    const savedTheme = localStorage.getItem('fdr-theme');
    const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
    applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : preferredTheme);

    const savedVolume = Number(localStorage.getItem('fdr-volume'));
    if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) {
      setVolume(savedVolume);
      audioRef.volume = savedVolume;
    }

    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchInput.focus();
      }
      if (event.key === 'Escape') {
        setSelectedEpisode(undefined);
        setTopicMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeys);
    onCleanup(() => window.removeEventListener('keydown', handleKeys));

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
      nextTheme === 'dark' ? '#121513' : '#f6f2e9',
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
    setSelectedFormats([]);
    setSelectedTopics([]);
    setDurationFilter('any');
    setDateFilter('any');
    setTopicSearch('');
    setTopicMenuOpen(false);
  };

  const beginPlayback = (episode: Podcast, startAt = 0) => {
    if (!episode.urls.audio) return;
    const isNew = currentEpisode()?.id !== episode.id;
    setCurrentEpisode(episode);
    queueMicrotask(() => {
      if (isNew) audioRef.load();
      audioRef.currentTime = startAt;
      void audioRef.play().catch(() => setPlaying(false));
    });
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

  const cycleSpeed = () => {
    const rates = [1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(playbackRate()) + 1) % rates.length];
    setPlaybackRate(next);
    audioRef.playbackRate = next;
  };

  const loadNextPage = () => {
    const next = page() + 1;
    setPage(next);
    void loadEpisodes(next, true);
  };

  return (
    <div class="app-shell">
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
          <span class="brand-mark"><span /></span>
          <span>
            <strong>Freedomain</strong>
            <small>Archive</small>
          </span>
        </a>

        <label class="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchInput}
            aria-label="Search the archive"
            placeholder="Search ideas, people, or episode numbers"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <Show when={query()}>
            <button class="search-clear" type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={15} />
            </button>
          </Show>
          <kbd>/</kbd>
        </label>

        <button
          class="icon-button"
          type="button"
          onClick={() => applyTheme(theme() === 'dark' ? 'light' : 'dark')}
          aria-label={`Use ${theme() === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme() === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      </header>

      <main id="top">
        <section class="filters" aria-label="Podcast filters">
          <div class="filter-heading">
            <span>
              <ListFilter size={16} /> Refine the archive
              <Show when={activeFilterCount()}>
                <b>{activeFilterCount()}</b>
              </Show>
            </span>
            <button type="button" disabled={!activeFilterCount()} onClick={clearFilters}>Clear all</button>
          </div>

          <div class="format-filter-row">
            <button
              class="filter-pill"
              classList={{ active: selectedFormats().length === 0 }}
              type="button"
              onClick={() => setSelectedFormats([])}
            >
              All formats
            </button>
            <For each={FORMAT_OPTIONS}>{(format) => (
              <button
                class="filter-pill"
                classList={{ active: selectedFormats().includes(format.key) }}
                type="button"
                aria-pressed={selectedFormats().includes(format.key)}
                onClick={() => toggleValue(setSelectedFormats, format.key)}
              >
                <Show when={selectedFormats().includes(format.key)}><Check size={14} /></Show>
                {format.label}
                <small>{compactNumber.format(format.count)}</small>
              </button>
            )}</For>
          </div>

          <div class="advanced-filter-row">
            <div class="topic-menu-wrap">
              <button
                class="filter-menu"
                classList={{ active: selectedTopics().length > 0 }}
                type="button"
                aria-expanded={topicMenuOpen()}
                aria-haspopup="dialog"
                onClick={() => setTopicMenuOpen(!topicMenuOpen())}
              >
                <SlidersHorizontal size={15} />
                Topics
                <Show when={selectedTopics().length}><b>{selectedTopics().length}</b></Show>
                <ChevronDown size={15} />
              </button>

              <Show when={topicMenuOpen()}>
                <div class="topic-popover" role="dialog" aria-label="Choose topics">
                  <div class="topic-popover-head">
                    <strong>Topics</strong>
                    <button type="button" onClick={() => setTopicMenuOpen(false)} aria-label="Close topics">
                      <X size={17} />
                    </button>
                  </div>
                  <label class="topic-search">
                    <Search size={15} />
                    <input
                      placeholder="Find a topic"
                      value={topicSearch()}
                      onInput={(event) => setTopicSearch(event.currentTarget.value)}
                    />
                  </label>
                  <div class="topic-options">
                    <For each={filteredTopics()}>{(topic) => (
                      <button
                        type="button"
                        classList={{ selected: selectedTopics().includes(topic.tagName) }}
                        onClick={() => toggleValue(setSelectedTopics, topic.tagName)}
                      >
                        <span class="topic-check">
                          <Show when={selectedTopics().includes(topic.tagName)}><Check size={13} /></Show>
                        </span>
                        <span>{topic.searchName}</span>
                        <small>{compactNumber.format(topic.podcastCount)}</small>
                      </button>
                    )}</For>
                  </div>
                  <Show when={selectedTopics().length}>
                    <button class="topic-done" type="button" onClick={() => setTopicMenuOpen(false)}>
                      Show matching episodes
                    </button>
                  </Show>
                </div>
              </Show>
            </div>

            <label class="select-filter">
              <Clock3 size={15} />
              <select
                aria-label="Filter by duration"
                value={durationFilter()}
                onInput={(event) => setDurationFilter(event.currentTarget.value as DurationFilter)}
              >
                <option value="any">Any duration</option>
                <option value="short">Under 30 minutes</option>
                <option value="medium">30—60 minutes</option>
                <option value="long">1—2 hours</option>
                <option value="epic">Over 2 hours</option>
              </select>
              <ChevronDown size={15} />
            </label>

            <label class="select-filter">
              <CalendarDays size={15} />
              <select
                aria-label="Filter by date"
                value={dateFilter()}
                onInput={(event) => setDateFilter(event.currentTarget.value as DateFilter)}
              >
                <option value="any">Any date</option>
                <option value="year">Past year</option>
                <option value="2020s">2020s</option>
                <option value="2010s">2010s</option>
                <option value="early">Before 2010</option>
              </select>
              <ChevronDown size={15} />
            </label>

            <label class="select-filter sort-filter">
              <select
                aria-label="Sort episodes"
                value={sortOrder()}
                onInput={(event) => setSortOrder(event.currentTarget.value as SortOrder)}
              >
                <option value="date desc">Newest first</option>
                <option value="date asc">Oldest first</option>
              </select>
              <ChevronDown size={15} />
            </label>
          </div>

          <Show when={selectedTopics().length}>
            <div class="selected-topics" aria-label="Selected topics">
              <For each={selectedTopics()}>{(topic) => (
                <button type="button" onClick={() => toggleValue(setSelectedTopics, topic)}>
                  {popularTopics().find((item) => item.tagName === topic)?.searchName ?? topic}
                  <X size={13} />
                </button>
              )}</For>
            </div>
          </Show>
        </section>

        <section class="episode-section" aria-busy={loading()}>
          <div class="section-heading">
            <div>
              <h2>{debouncedQuery() ? `Results for “${debouncedQuery()}”` : 'Explore episodes'}</h2>
              <span>
                <Show when={!loading()} fallback="Searching the archive…">
                  {visibleEpisodes().length} shown · {estimatedTotal().toLocaleString()} in this collection
                </Show>
              </span>
            </div>
            <span class="api-note"><i /> Live archive</span>
          </div>

          <Show when={loading()}>
            <div class="loading-list" aria-label="Loading episodes">
              <For each={[1, 2, 3, 4]}>{() => (
                <div class="loading-row">
                  <span /><div><i /><i /><i /></div>
                </div>
              )}</For>
            </div>
          </Show>

          <Show when={!loading() && error()}>
            <div class="state-card">
              <CircleAlert size={25} />
              <h3>The archive is taking a moment</h3>
              <p>{error()}</p>
              <button type="button" onClick={() => void loadEpisodes(0, false)}>Try again</button>
            </div>
          </Show>

          <Show when={!loading() && !error() && visibleEpisodes().length === 0}>
            <div class="state-card">
              <Search size={25} />
              <h3>No episodes match every filter</h3>
              <p>Remove one topic or broaden the date and duration to keep exploring.</p>
              <button type="button" onClick={clearFilters}>Reset filters</button>
            </div>
          </Show>

          <Show when={!loading() && visibleEpisodes().length}>
            <div class="episode-list">
              <For each={visibleEpisodes()}>{(episode) => (
                <button class="episode-row" type="button" onClick={() => setSelectedEpisode(episode)}>
                  <span class="episode-number">#{episode.num}</span>
                  <span class="episode-row-title">
                    <strong>{episode.title}</strong>
                    <i>{primaryFormat(episode)}</i>
                  </span>
                  <time class="episode-date">{formatDate(episode.date)}</time>
                  <span class="episode-row-duration"><Clock3 size={13} /> {formatDuration(episode.length)}</span>
                  <ArrowUpRight class="row-arrow" size={15} />
                </button>
              )}</For>
            </div>

            <Show when={canLoadMore()}>
              <button class="load-more" type="button" onClick={loadNextPage} disabled={loadingMore()}>
                <Show when={loadingMore()} fallback="Load more episodes">
                  <LoaderCircle size={17} class="spin" /> Loading more
                </Show>
              </button>
            </Show>
          </Show>
        </section>
      </main>

      <Show when={selectedEpisode()} keyed>{(episode) => (
        <div class="detail-layer" role="presentation">
          <button class="detail-scrim" type="button" onClick={() => setSelectedEpisode(undefined)} aria-label="Close episode details" />
          <aside class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <div class="detail-toolbar">
              <span>Episode #{episode.num}</span>
              <button type="button" onClick={() => setSelectedEpisode(undefined)} aria-label="Close details">
                <X size={20} />
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
                      setSelectedEpisode(undefined);
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

      <footer class="player-shell" aria-label="Audio player">
        <button
          class="player-episode"
          type="button"
          disabled={!currentEpisode()}
          onClick={() => currentEpisode() && setSelectedEpisode(currentEpisode())}
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
          <div class="transport-controls">
            <button type="button" disabled={!currentEpisode()} onClick={() => seekTo(currentTime() - 15)} aria-label="Go back 15 seconds">
              <RotateCcw size={18} /><small>15</small>
            </button>
            <button class="main-play" type="button" disabled={!currentEpisode()} onClick={togglePlayback} aria-label={playing() ? 'Pause' : 'Play'}>
              <Show when={playing()} fallback={<Play size={20} fill="currentColor" />}>
                <Pause size={19} fill="currentColor" />
              </Show>
            </button>
            <button type="button" disabled={!currentEpisode()} onClick={() => seekTo(currentTime() + 30)} aria-label="Go forward 30 seconds">
              <FastForward size={18} /><small>30</small>
            </button>
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

        <div class="player-extras">
          <button class="speed-button" type="button" onClick={cycleSpeed} aria-label="Change playback speed">
            {playbackRate()}×
          </button>
          <Volume2 size={17} />
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
      </footer>
    </div>
  );
}
