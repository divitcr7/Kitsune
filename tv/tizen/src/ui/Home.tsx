import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Show } from '@/lib/api';
import { year } from '@/lib/format';
import { imgUrl } from '@/lib/img';
import { api, rails, useData } from '../api';
import { openShow, playShow } from '../nav';
import { store, useStore } from '../store';
import { Btn, ContinueCard, EpisodeCard, Img, on, PosterCard, Rail, RankCard } from './kit';

const DWELL = 9000;

export function Home() {
  const featured = useData('featured', api.featured, rails);
  const popular = useData('popular', api.popular, rails);
  const latest = useData('latest', api.latest, { ...rails, stale: 2 * 60_000 });
  const seasonal = useData('seasonal', api.seasonal, rails);
  const trending = useData('trending', () => api.discover('trending', 1).then((r) => r.data), rails);
  const recent = useData('recent', api.recent, rails);
  const history = useStore((s) => s.history);
  const continueWatching = useMemo(() => Object.values(history).sort((a, b) => b.at - a.at).slice(0, 12), [history]);

  return (
    <div className="k-screen">
      <div className="k-page" data-page="150">
        <Hero items={featured.data} />
        {featured.error && !featured.data ? (
          <div className="k-error">
            <div className="t-title">Can’t reach anime.nexus</div>
            <div className="t-body k-dim">Check the TV’s connection, then press Back and open Kitsune again.</div>
          </div>
        ) : null}
        {continueWatching.length ? (
          <Rail
            id="continue"
            first
            title="Continue Watching"
            items={continueWatching}
            keyOf={(e) => e.show.id}
            width={400}
            height={225}
            render={(e, _i, k) => <ContinueCard key={k} entry={e} k={k} />}
          />
        ) : null}
        <Rail
          id="top10"
          first={!continueWatching.length}
          title="Top 10 Today"
          items={popular.data?.slice(0, 10)}
          keyOf={(s) => s.id}
          width={300}
          height={300}
          render={(s, i, k) => <RankCard key={k} show={s} rank={i + 1} k={k} />}
        />
        <Rail
          id="latest"
          title="New Episodes"
          items={latest.data}
          keyOf={(l) => l.episode.id}
          width={384}
          height={216}
          render={(l, _i, k) => <EpisodeCard key={k} item={l} k={k} />}
        />
        <Rail
          id="seasonal"
          title="Airing This Season"
          items={seasonal.data?.slice(0, 24)}
          keyOf={(s) => s.id}
          width={200}
          height={300}
          render={(s, _i, k) => <PosterCard key={k} show={s} width={200} k={k} />}
        />
        <Rail
          id="trending"
          title="Trending Now"
          items={trending.data}
          keyOf={(s) => s.id}
          width={240}
          height={360}
          render={(s, _i, k) => <PosterCard key={k} show={s} width={240} k={k} />}
        />
        <Rail
          id="recent"
          title="Recently Added"
          items={recent.data?.slice(0, 24)}
          keyOf={(s) => s.id}
          width={200}
          height={300}
          render={(s, _i, k) => <PosterCard key={k} show={s} width={200} k={k} />}
        />
        <div style={{ height: 120 }} />
      </div>
    </div>
  );
}

/**
 * Full-bleed key art with a slow push, title art and actions over a deep fade. It moves on by itself;
 * Left from Play or Right from My List steps through it by hand.
 */
function Hero({ items }: { items: Show[] | undefined }) {
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const count = items?.length ?? 0;

  const go = (step: number) => {
    if (!count) return;
    setPrev(index);
    setIndex((index + step + count) % count);
  };

  useEffect(() => {
    if (count < 2) return;
    const id = setTimeout(() => go(1), DWELL);
    return () => clearTimeout(id);
  }, [index, count]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items || !count) return <section className="k-hero" data-row="" />;
  const show = items[Math.min(index, count - 1)];

  return (
    <section
      className="k-hero"
      data-row=""
      {...on('kedge', (e) => {
        if (e.detail === 'left') go(-1);
        if (e.detail === 'right') go(1);
      })}
    >
      {prev !== null && prev !== index && items[prev] ? <Art key={`a${prev}`} show={items[prev]} active={false} /> : null}
      <Art key={`a${index}`} show={show} active />
      <div className="k-hero-fade" />
      <div className="k-hero-floor" />
      <div className="k-hero-info">
        <Title show={show} />
        <div className="k-hero-meta t-caption k-dim">
          {[...(show.genres ?? []).slice(0, 3).map((g) => g.name), year(show.release_date)].filter(Boolean).join('   ·   ')}
        </div>
        {show.description ? <div className="k-hero-syn t-body k-dim k-clamp3">{show.description.trim()}</div> : null}
        <HeroActions show={show} />
        <div className="k-dots">
          {items.map((s, i) => (
            <i key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** One slide's art: mounts transparent and fades in, so slides cross-fade. */
function Art({ show, active }: { show: Show; active: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // A beat after mounting, so the fade has a start state to run from.
    const id = setTimeout(() => setOn(active), 30);
    return () => clearTimeout(id);
  }, [active]);
  return (
    <div className={`k-hero-art${on ? ' on' : ''}`}>
      <Img src={imgUrl(show.background ?? show.backdrop, 'background', '1920x1080') ?? imgUrl(show.poster, 'poster', '1560x2340')} />
    </div>
  );
}

function Title({ show }: { show: Show }) {
  const logo = imgUrl(show.logo, 'logo', 'large');
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logo]);
  if (logo && !failed) return <img className="k-hero-logo" src={logo} alt={show.name} onError={() => setFailed(true)} />;
  return <div className="t-hero k-clamp2">{show.name}</div>;
}

function HeroActions({ show }: { show: Show }) {
  const inList = useStore((s) => s.myList.some((m) => m.id === show.id));
  return (
    <div className="k-btns">
      <Btn k="hero:play" autofocus primary icon="play" label="Play" onClick={() => playShow(show)} />
      <Btn k="hero:list" icon={inList ? 'check' : 'plus'} label={inList ? 'In My List' : 'My List'} onClick={() => store.toggleList(show)} />
      <Btn k="hero:info" icon="informationOutline" label="Details" onClick={() => openShow(show)} />
    </div>
  );
}
