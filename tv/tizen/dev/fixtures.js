// Offline stand-ins for the anime.nexus API, for looking at the TV UI without a TV or the network.
// Made-up shows and generated artwork only.
(function () {
  var NAMES = [
    'Starlight Relay', 'Ember Garden', 'The Quiet Ronin', 'Neon Tide', 'Paper Moon Café', 'Ironbloom',
    'Skyline Couriers', 'Hollow Crown', 'Mochi Detective', 'Azure Frontier', 'Last Train to Kyoto', 'Velvet Static',
    'Lantern Keepers', 'Gale Academy', 'Crimson Orbit', 'Tidecaller', 'Sakura Protocol', 'Midnight Atelier',
    'Wild Hunt Club', 'Glass Dragon', 'Northbound', 'Pixel Shrine', 'Bento Brigade', 'Echo Valley',
    'Silver Fang', 'Cloud Garden', 'Ramen Rebels', 'Moth & Flame', 'Ocean Archive', 'Thunder Lily',
  ];
  var GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Mystery', 'Isekai', 'Mecha'];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function set(kind, id, sizes) {
    var r = {};
    sizes.forEach(function (s) { r[s] = '/' + kind + '/' + id + '/' + s + '.jpg'; });
    return { resized: r };
  }
  var genres = GENRES.map(function (g, i) { return { id: 'g' + i, name: g, code: g.toLowerCase(), type: 'genre' }; });
  var shows = NAMES.map(function (name, i) {
    var id = 's' + i;
    return {
      id: id, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), name: name, name_alt: name + ' (JP)',
      description: 'When ' + name + ' begins, nobody expects the quiet town to become the centre of a story this big. A season of friendship, rivalry and a little magic, told one episode at a time.',
      type: i % 5 === 0 ? 'Movie' : 'TV', status: i % 3 ? 'Currently Airing' : 'Finished Airing',
      release_date: (2018 + (i % 8)) + '-04-01', premiered: 'spring', release_day: DAYS[i % 7], broadcast: (10 + (i % 12)) + ':30:00',
      episode_count: 12 + (i % 3) * 12, episode_count_current: 12 + (i % 3) * 12, parental_rating: 'PG-13 - Teens 13 or older',
      average: { score: 7 + (i % 20) / 10, users: 1200 + i },
      poster: set('poster', id, ['480x720', '640x960', '1560x2340', '240x360']),
      background: set('background', id, ['1920x1080', '960x540']),
      logo: i % 2 ? undefined : set('logo', id, ['large']),
      genres: [genres[i % 12], genres[(i + 3) % 12], genres[(i + 7) % 12]],
    };
  });
  function episodes(show, count) {
    var out = [];
    for (var n = 1; n <= count; n++) {
      out.push({ id: show.id + 'e' + n, slug: 'episode-' + n, title: ['The Arrival', 'A Promise Kept', 'Storm Season', 'Under the Lanterns', 'Second Wind', 'The Long Night'][n % 6], number: n, duration: 1420, image: set('episode', show.id + 'e' + n, ['640x360', '1280x720']), video_meta: { audio_languages: ['jpn', 'eng'] }, is_filler: n === 7 ? 1 : 0 });
    }
    return out;
  }
  function page(data) { return { data: data, meta: { current_page: 1, last_page: 1, total: data.length, per_page: 30 } }; }

  window.__FIXTURES = {
    shows: shows,
    byId: shows.reduce(function (m, s) { m[s.id] = s; return m; }, {}),
    route: function (url) {
      var m;
      if (/auth\/providers/.test(url)) return { status: 401, body: { message: 'Unauthenticated' } };
      if (/\/details\/episodes/.test(url)) { m = url.match(/id=([^&]+)/); var s = window.__FIXTURES.byId[m[1]]; return { body: page(episodes(s, s.episode_count)) }; }
      if (/\/details\/statistics/.test(url)) return { body: { data: { average: { score: 8.4, users: 5000 }, followers: 48200, audio_languages: ['jpn', 'eng'], subtitle_languages: ['eng', 'spa', 'por'] } } };
      if (/\/details/.test(url)) { m = url.match(/id=([^&]+)/); return { body: { data: window.__FIXTURES.byId[m[1]] } }; }
      if (/\/featured/.test(url)) return { body: { data: shows.slice(0, 5) } };
      if (/\/popular/.test(url)) return { body: { data: shows.slice(5, 15) } };
      if (/\/latest/.test(url)) return { body: page(shows.slice(10, 22).map(function (s, i) { var e = episodes(s, 12)[i % 12]; return Object.assign({}, s, { episode: e }); })) };
      if (/\/recent/.test(url)) return { body: page(shows.slice(12).concat(shows.slice(0, 6))) };
      if (/\/seasonal/.test(url)) return { body: { data: shows.slice(3, 21) } };
      if (/\/schedule/.test(url)) return { body: page(shows) };
      if (/\/genres/.test(url)) return { body: { data: genres } };
      if (/\/discover/.test(url)) return { body: page(shows.slice().reverse()) };
      if (/\/shows/.test(url)) return { body: page(shows.slice(0, 18)) };
      return { status: 404, body: {} };
    },
  };
})();
