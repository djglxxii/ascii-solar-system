// The catalogue: every body you can visit, with its size, mass, orbit, spin, look and a few facts.
// Radii are km ([equatorial, polar] or triaxial [a, b, c]); GM in km^3/s^2. Moon orbits use JPL mean
// elements (epoch J2000) relative to the parent's equator unless `plane` says otherwise; angles in
// degrees. Rotation uses IAU poles (RA/Dec of the north pole) and prime meridians W = W0 + Wd * days.
// Feature longitudes elsewhere are planetocentric east longitudes.

import { GM_SUN } from './astro.js';

// Glyph ramp families (see asciify.js).
export const K = { SPACE: 0, ROCK: 1, ICE: 2, GAS: 3, UI: 4, OCEAN: 5, CLOUD: 6, LAND: 7, RING: 8, SUN: 9, HAZE: 10, FLAT: 12, DUST: 13 };

const info = (o) => o;

export const BODIES = [
  {
    id: 'sun', name: 'Sun', kind: 'star', parent: null, R: [695700, 695700], gm: GM_SUN,
    rot: { ra: 286.13, dec: 63.87, W0: 84.176, Wd: 14.1844 },
    look: { ramp: K.SUN, col: [1.0, 0.86, 0.62] },
    info: info({
      type: 'G2V main-sequence star', diameter: '1,392,700 km', mass: '333,000 Earths', gravity: '274 m/s2 (28 g)',
      day: '25.4 days at the equator, 34 near the poles', temp: 'photosphere 5,500 C, corona above 1,000,000 C',
      facts: ['Holds 99.86% of the mass of the Solar System.', 'Light from its surface takes 8 min 20 s to reach Earth.'],
    }),
  },
  // ---------------------------------------------------------------------------------------- MERCURY
  {
    id: 'mercury', name: 'Mercury', kind: 'planet', parent: 'sun', R: [2440.5, 2438.3], gm: 22031.8,
    orbit: { planet: 'mercury' }, rot: { ra: 281.0103, dec: 61.4155, W0: 329.5988, Wd: 6.1385108 },
    look: { ramp: K.ROCK, col: [0.56, 0.53, 0.5], paint: 'mercury', tex: 512 },
    info: info({
      type: 'Terrestrial planet', diameter: '4,879 km', mass: '0.055 Earths', gravity: '3.7 m/s2',
      day: '58.6 days (sidereal), 176 days sunrise to sunrise', year: '88 days', temp: '-180 C at night to 430 C by day',
      atmo: 'none (a thin exosphere of sodium and potassium)', moons: 'none',
      facts: ['The Caloris basin, 1,550 km wide, is one of the largest impact scars known.', 'Spins exactly three times for every two orbits.'],
    }),
  },
  // ------------------------------------------------------------------------------------------ VENUS
  {
    id: 'venus', name: 'Venus', kind: 'planet', parent: 'sun', R: [6051.8 + 68, 6051.8 + 68], solidR: 6051.8, gm: 324858.6,
    orbit: { planet: 'venus' }, rot: { ra: 272.76, dec: 67.16, W0: 160.20, Wd: -1.4813688 },
    look: { ramp: K.CLOUD, col: [0.93, 0.85, 0.66], paint: 'venus', tex: 512, cloudDrift: -88.5, minnaert: 0.75 },
    atmo: {
      top: 32, minAlt: 6, P0: 0.08, T: 250, label: 'sulfuric-acid haze above the cloud deck',
      comps: [
        { H: 5.5, beta: [0.0015, 0.0024, 0.0042], abs: [0, 0, 0.0008], g: 0 },
        { H: 4.0, beta: [0.050, 0.044, 0.030], abs: [0.001, 0.003, 0.010], g: 0.7, ms: 0.5 },
      ],
    },
    info: info({
      type: 'Terrestrial planet', diameter: '12,104 km', mass: '0.815 Earths', gravity: '8.87 m/s2',
      day: '243 days, retrograde (longer than its year)', year: '224.7 days', temp: '465 C at the surface; about -10 C at the cloud tops',
      atmo: '96% carbon dioxide, 92 bar at the surface, clouds of sulfuric acid', moons: 'none',
      facts: ['The cloud deck races around the planet every four days, sixty times faster than the ground turns.', 'You are flying above the clouds: the surface is 65 km below, hidden in permanent overcast.'],
    }),
  },
  // ------------------------------------------------------------------------------------------ EARTH
  {
    id: 'earth', name: 'Earth', kind: 'planet', parent: 'sun', R: [6378.137, 6356.752], gm: 398600.4418,
    orbit: { emb: true }, rot: { ra: 0, dec: 90, W0: 190.147, Wd: 360.9856235 },
    look: { ramp: K.LAND, col: [0.35, 0.48, 0.7], paint: 'earth', tex: 1024 },
    atmo: {
      top: 100, minAlt: 18, P0: 1.013, T: 288, label: 'nitrogen and oxygen',
      comps: [
        { H: 8.0, beta: [0.0058, 0.0135, 0.0331], abs: [0, 0, 0], g: 0 },
        { H: 1.2, beta: [0.0040, 0.0040, 0.0040], abs: [0.0004, 0.0004, 0.0004], g: 0.76 },
      ],
      aurora: { poleLat: 80.7, poleLon: -72.7, lat: 67, col: [0.25, 1.0, 0.45], col2: [0.9, 0.25, 0.4] },
    },
    info: info({
      type: 'Terrestrial planet', diameter: '12,742 km', mass: '5.97 x 10^24 kg', gravity: '9.81 m/s2',
      day: '23 h 56 min', year: '365.25 days', temp: 'average 15 C', atmo: '78% nitrogen, 21% oxygen, 1 bar',
      moons: '1', facts: ['The only world known to have liquid water on its surface, and life.', 'At night the coasts and river valleys glow with city light.'],
    }),
  },
  {
    id: 'moon', name: 'Moon', kind: 'moon', parent: 'earth', R: [1738.1, 1736.0], gm: 4902.8,
    orbit: { lunar: true }, rot: { locked: true },
    look: { ramp: K.ROCK, col: [0.6, 0.58, 0.55], paint: 'moon', tex: 1024, ls: 0.7 },
    info: info({
      type: 'Natural satellite of Earth', diameter: '3,474 km', mass: '0.0123 Earths', gravity: '1.62 m/s2',
      day: 'tidally locked: 27.3 days', year: 'orbits Earth every 27.3 days at 384,400 km', temp: '-170 C to 120 C',
      facts: ['The dark maria are ancient lava plains; the bright highlands are older still.', 'Tycho\'s rays of bright ejecta reach 1,500 km across the near side.'],
    }),
  },
  // ------------------------------------------------------------------------------------------- MARS
  {
    id: 'mars', name: 'Mars', kind: 'planet', parent: 'sun', R: [3396.2, 3376.2], gm: 42828.37,
    orbit: { planet: 'mars' }, rot: { ra: 317.68143, dec: 52.88650, W0: 176.630, Wd: 350.89198226 },
    look: { ramp: K.ROCK, col: [0.74, 0.45, 0.27], paint: 'mars', tex: 1024, relief: 1.4 },
    atmo: {
      top: 70, minAlt: 7, P0: 0.006, T: 210, label: 'thin carbon dioxide, full of fine dust',
      comps: [
        { H: 11.1, beta: [0.00008, 0.00018, 0.00045], abs: [0, 0, 0], g: 0 },
        { H: 11.0, beta: [0.022, 0.015, 0.009], abs: [0.002, 0.006, 0.012], g: [0.62, 0.7, 0.86], ms: 0.25 },
      ],
    },
    info: info({
      type: 'Terrestrial planet', diameter: '6,779 km', mass: '0.107 Earths', gravity: '3.72 m/s2',
      day: '24 h 37 min', year: '687 days', temp: 'average -60 C', atmo: '95% carbon dioxide, 0.006 bar',
      moons: '2', facts: ['Olympus Mons rises 22 km above the plains of Tharsis.', 'Valles Marineris runs 4,000 km and plunges 7 km deep.', 'Its polar caps grow and shrink with the seasons.'],
    }),
  },
  {
    id: 'phobos', name: 'Phobos', kind: 'moon', parent: 'mars', R: [13.0, 11.4, 9.1], gm: 7.087e-4,
    orbit: { a: 9376, e: 0.0151, i: 1.075, node: 207.8, argp: 150.1, M0: 91.0 }, rot: { locked: true },
    shape: { amp: 0.11, freq: 1.6, seed: 31 },
    look: { ramp: K.ROCK, col: [0.36, 0.33, 0.3], paint: 'phobos', tex: 256 },
    info: info({ type: 'Moon of Mars', diameter: '27 x 22 x 18 km', gravity: '0.0057 m/s2', year: 'orbits every 7 h 39 min, faster than Mars turns', facts: ['Stickney crater is 9 km wide, a third of the moon.', 'Spiralling inward; in ~50 million years it will break up into a ring.'] }),
  },
  {
    id: 'deimos', name: 'Deimos', kind: 'moon', parent: 'mars', R: [7.8, 6.0, 5.1], gm: 9.6e-5,
    orbit: { a: 23458, e: 0.0002, i: 1.788, node: 24.5, argp: 290.5, M0: 296.2 }, rot: { locked: true },
    shape: { amp: 0.08, freq: 1.4, seed: 32 },
    look: { ramp: K.ROCK, col: [0.42, 0.38, 0.34], tex: 256, craters: 0.4, smooth: 0.6 },
    info: info({ type: 'Moon of Mars', diameter: '15 x 12 x 11 km', year: 'orbits every 30.3 hours', facts: ['A smooth little moon, its craters half buried in fine dust.'] }),
  },
  // --------------------------------------------------------------------------------- ASTEROID BELT
  {
    id: 'ceres', name: 'Ceres', kind: 'dwarf', parent: 'sun', R: [482.1, 482.1, 445.9], gm: 62.6284, belt: true,
    orbit: { helio: true, a: 2.7675, e: 0.0758, i: 10.594, node: 80.31, argp: 73.6, M0: 95.99, epoch: 2451545.0 },
    rot: { ra: 291.418, dec: 66.764, W0: 170.650, Wd: 952.1532 },
    look: { ramp: K.ROCK, col: [0.32, 0.31, 0.3], paint: 'ceres', tex: 512 },
    info: info({ type: 'Dwarf planet, largest body of the asteroid belt', diameter: '940 km', mass: '1/3 of the whole belt', gravity: '0.28 m/s2', day: '9 h 4 min', year: '4.6 years',
      facts: ['The bright spots in Occator crater are salts left by briny water that welled up from below.', 'Ahuna Mons is a lone 4 km ice volcano.'] }),
  },
  {
    id: 'vesta', name: 'Vesta', kind: 'asteroid', parent: 'sun', R: [286.3, 278.6, 223.2], gm: 17.288, belt: true,
    orbit: { helio: true, a: 2.3615, e: 0.0887, i: 7.14, node: 103.85, argp: 151.2, M0: 205.5, epoch: 2451545.0 },
    rot: { ra: 309.031, dec: 42.235, W0: 285.39, Wd: 1617.3329428 },
    shape: { amp: 0.06, freq: 1.2, seed: 41 },
    look: { ramp: K.ROCK, col: [0.55, 0.52, 0.48], paint: 'vesta', tex: 512 },
    info: info({ type: 'Asteroid (protoplanet)', diameter: '573 x 557 x 446 km', day: '5 h 20 min', year: '3.6 years',
      facts: ['Rheasilvia, a 505 km impact basin, gouges out its south pole with a central peak 22 km high.', 'Many meteorites found on Earth were blasted off Vesta.'] }),
  },
  {
    id: 'pallas', name: 'Pallas', kind: 'asteroid', parent: 'sun', R: [284, 266, 224], gm: 13.63, belt: true,
    orbit: { helio: true, a: 2.7730, e: 0.2302, i: 34.84, node: 173.08, argp: 310.15, M0: 352.5, epoch: 2451545.0 },
    rot: { elon: 30, elat: -16, W0: 0, Wd: 1105.8 },
    shape: { amp: 0.05, freq: 1.3, seed: 42 },
    look: { ramp: K.ROCK, col: [0.4, 0.41, 0.43], tex: 512, craters: 1.2 },
    info: info({ type: 'Asteroid', diameter: '512 km', day: '7 h 49 min', year: '4.6 years', facts: ['Its orbit is tilted 35 degrees, so it slams through the belt at high speed: its surface is unusually battered.'] }),
  },
  {
    id: 'hygiea', name: 'Hygiea', kind: 'asteroid', parent: 'sun', R: [225, 215, 212], gm: 5.78, belt: true,
    orbit: { helio: true, a: 3.1415, e: 0.1125, i: 3.83, node: 283.2, argp: 312.3, M0: 168.0, epoch: 2451545.0 },
    rot: { elon: 115, elat: 30, W0: 0, Wd: 624.7 },
    look: { ramp: K.ROCK, col: [0.27, 0.26, 0.25], tex: 512, craters: 0.8 },
    info: info({ type: 'Asteroid (dwarf planet candidate)', diameter: '434 km', day: '13 h 50 min', year: '5.6 years', facts: ['Almost perfectly round: it may have reassembled after a huge collision.'] }),
  },
  {
    id: 'juno', name: 'Juno', kind: 'asteroid', parent: 'sun', R: [160, 133.5, 100], gm: 1.82, belt: true,
    orbit: { helio: true, a: 2.6694, e: 0.2562, i: 12.99, node: 169.85, argp: 248.14, M0: 30.0, epoch: 2451545.0 },
    rot: { elon: 103, elat: 27, W0: 0, Wd: 1198.3 },
    shape: { amp: 0.12, freq: 1.5, seed: 43 },
    look: { ramp: K.ROCK, col: [0.56, 0.5, 0.42], tex: 256, craters: 0.9 },
    info: info({ type: 'Asteroid (stony)', diameter: '254 km', day: '7 h 13 min', year: '4.4 years', facts: ['One of the first four asteroids found, in 1804.'] }),
  },
  {
    id: 'psyche', name: 'Psyche', kind: 'asteroid', parent: 'sun', R: [139, 119, 85.5], gm: 1.53, belt: true,
    orbit: { helio: true, a: 2.924, e: 0.134, i: 3.10, node: 150.04, argp: 229.2, M0: 120.0, epoch: 2451545.0 },
    rot: { elon: 32, elat: -7, W0: 0, Wd: 2059.1 },
    shape: { amp: 0.1, freq: 1.4, seed: 44 },
    look: { ramp: K.ROCK, col: [0.5, 0.52, 0.55], tex: 256, craters: 0.7, metal: 0.5 },
    info: info({ type: 'Asteroid (metallic)', diameter: '279 x 232 x 189 km', day: '4 h 12 min', year: '5.0 years', facts: ['Rich in iron and nickel: perhaps the exposed core of a shattered protoplanet.'] }),
  },
  {
    id: 'ida', name: 'Ida', kind: 'asteroid', parent: 'sun', R: [29.9, 12.7, 9.3], gm: 0.00282, belt: true,
    orbit: { helio: true, a: 2.862, e: 0.0451, i: 1.13, node: 324.0, argp: 110.9, M0: 268.0, epoch: 2451545.0 },
    rot: { elon: 168, elat: -86, W0: 0, Wd: 1864.5 },
    shape: { amp: 0.16, freq: 1.8, seed: 45 },
    look: { ramp: K.ROCK, col: [0.5, 0.46, 0.42], tex: 256, craters: 1.1 },
    info: info({ type: 'Asteroid (Koronis family)', diameter: '60 x 25 x 19 km', day: '4 h 38 min', year: '4.8 years', moons: '1 (Dactyl)', facts: ['Dactyl, 1.4 km across, was the first moon of an asteroid ever found (Galileo, 1993).'] }),
  },
  {
    id: 'dactyl', name: 'Dactyl', kind: 'moon', parent: 'ida', R: [0.8, 0.7, 0.6], gm: 1e-6,
    orbit: { a: 108, e: 0.0, i: 9, node: 0, argp: 0, M0: 0 }, rot: { locked: true },
    shape: { amp: 0.1, freq: 1.3, seed: 46 },
    look: { ramp: K.ROCK, col: [0.5, 0.46, 0.42], tex: 128, craters: 0.9 },
    info: info({ type: 'Moon of Ida', diameter: '1.6 x 1.4 x 1.2 km', facts: ['Orbits Ida about every 37 hours, slower than walking pace.'] }),
  },
  // ---------------------------------------------------------------------------------------- JUPITER
  {
    id: 'jupiter', name: 'Jupiter', kind: 'planet', parent: 'sun', R: [71492, 66854], gm: 126686534,
    orbit: { planet: 'jupiter' }, rot: { ra: 268.056595, dec: 64.495303, W0: 284.95, Wd: 870.536 },
    look: { ramp: K.GAS, col: [0.82, 0.7, 0.56], paint: 'jupiter', tex: 1024, minnaert: 0.85, halo: 0.12 },
    atmo: {
      top: 260, minAlt: 25, P0: 0.5, T: 125, label: 'hydrogen and helium above ammonia clouds',
      comps: [
        { H: 27, beta: [0.00002, 0.00005, 0.00012], abs: [0, 0, 0], g: 0 },
        { H: 32, beta: [0.0034, 0.0029, 0.0020], abs: [0.0002, 0.0005, 0.0011], g: 0.65 },
      ],
    },
    rings: { inner: 92000, outer: 226000, faint: true },
    info: info({
      type: 'Gas giant', diameter: '139,820 km (11 Earths)', mass: '318 Earths', gravity: '24.8 m/s2 at the cloud tops',
      day: '9 h 56 min', year: '11.9 years', temp: '-110 C at the cloud tops', atmo: '90% hydrogen, 10% helium; ammonia ice clouds',
      moons: '95 known', facts: ['The Great Red Spot is a storm wider than Earth, watched for over 190 years.', 'Clusters of cyclones crowd both poles: eight around the north, five around the south.'],
    }),
  },
  {
    id: 'io', name: 'Io', kind: 'moon', parent: 'jupiter', R: [1829.4, 1815.7], gm: 5959.9,
    orbit: { a: 421800, e: 0.0041, i: 0.036, node: 43.977, argp: 84.129, M0: 342.021 }, rot: { locked: true },
    look: { ramp: K.ROCK, col: [0.86, 0.78, 0.42], paint: 'io', tex: 512, craters: 0 },
    info: info({ type: 'Galilean moon of Jupiter', diameter: '3,643 km', gravity: '1.80 m/s2', year: 'orbits every 1.77 days', temp: '-130 C (lava lakes 1,200 C)',
      facts: ['The most volcanic world known: over 400 active volcanoes, squeezed hot by Jupiter\'s tides.', 'Pele\'s plume rains red sulfur in a ring 1,200 km wide.'] }),
  },
  {
    id: 'europa', name: 'Europa', kind: 'moon', parent: 'jupiter', R: [1560.8, 1560.8], gm: 3202.7,
    orbit: { a: 671100, e: 0.0094, i: 0.466, node: 219.106, argp: 88.970, M0: 171.016 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.86, 0.8, 0.7], paint: 'europa', tex: 512, craters: 0.05 },
    info: info({ type: 'Galilean moon of Jupiter', diameter: '3,122 km', gravity: '1.31 m/s2', year: 'orbits every 3.55 days', temp: '-160 C',
      facts: ['An ice shell, cracked into reddish lineae, floats on a global salt-water ocean.', 'That ocean may hold twice as much water as all of Earth\'s.'] }),
  },
  {
    id: 'ganymede', name: 'Ganymede', kind: 'moon', parent: 'jupiter', R: [2631.2, 2631.2], gm: 9887.8,
    orbit: { a: 1070400, e: 0.0013, i: 0.177, node: 63.552, argp: 192.417, M0: 317.540 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.55, 0.52, 0.48], paint: 'ganymede', tex: 512 },
    info: info({ type: 'Galilean moon of Jupiter', diameter: '5,268 km (larger than Mercury)', gravity: '1.43 m/s2', year: 'orbits every 7.15 days',
      facts: ['The largest moon in the Solar System, and the only one with its own magnetic field.', 'Dark ancient terrain is cut by bright bands of grooves.'] }),
  },
  {
    id: 'callisto', name: 'Callisto', kind: 'moon', parent: 'jupiter', R: [2410.3, 2410.3], gm: 7179.3,
    orbit: { a: 1882700, e: 0.0074, i: 0.192, node: 298.848, argp: 52.643, M0: 181.408 }, rot: { locked: true },
    look: { ramp: K.ROCK, col: [0.36, 0.32, 0.28], paint: 'callisto', tex: 512 },
    info: info({ type: 'Galilean moon of Jupiter', diameter: '4,821 km', gravity: '1.24 m/s2', year: 'orbits every 16.7 days',
      facts: ['The most heavily cratered surface known, almost unchanged for four billion years.', 'Valhalla\'s rings spread 3,800 km across.'] }),
  },
  {
    id: 'amalthea', name: 'Amalthea', kind: 'moon', parent: 'jupiter', R: [125, 73, 64], gm: 0.138,
    orbit: { a: 181366, e: 0.0032, i: 0.374, node: 108.9, argp: 155.9, M0: 185.2 }, rot: { locked: true },
    shape: { amp: 0.1, freq: 1.4, seed: 51 },
    look: { ramp: K.ROCK, col: [0.62, 0.36, 0.26], tex: 256, craters: 0.8 },
    info: info({ type: 'Inner moon of Jupiter', diameter: '250 x 146 x 128 km', year: 'orbits every 12 hours', facts: ['The reddest object in the Solar System, dusted by sulfur from Io.'] }),
  },
  // ----------------------------------------------------------------------------------------- SATURN
  {
    id: 'saturn', name: 'Saturn', kind: 'planet', parent: 'sun', R: [60268, 54364], gm: 37931187,
    orbit: { planet: 'saturn' }, rot: { ra: 40.589, dec: 83.537, W0: 38.90, Wd: 810.7939024 },
    look: { ramp: K.GAS, col: [0.85, 0.75, 0.55], paint: 'saturn', tex: 1024, minnaert: 0.85, halo: 0.12 },
    atmo: {
      top: 520, minAlt: 45, P0: 0.5, T: 95, label: 'hydrogen and helium, golden ammonia haze',
      comps: [
        { H: 60, beta: [0.00001, 0.00003, 0.00007], abs: [0, 0, 0], g: 0 },
        { H: 60, beta: [0.0028, 0.0024, 0.0015], abs: [0.0002, 0.0004, 0.0009], g: 0.65 },
      ],
    },
    rings: { inner: 66900, outer: 140300, main: true },
    info: info({
      type: 'Gas giant', diameter: '116,460 km', mass: '95 Earths', gravity: '10.4 m/s2', day: '10 h 34 min', year: '29.4 years',
      temp: '-140 C at the cloud tops', atmo: '96% hydrogen, 3% helium', moons: '274 known',
      facts: ['Its rings span 280,000 km yet are mostly only about 10 m thick.', 'A six-sided jet stream circles the north pole, each side wider than Earth.', 'Less dense than water.'],
    }),
  },
  {
    id: 'mimas', name: 'Mimas', kind: 'moon', parent: 'saturn', R: [207.8, 196.7, 190.6], gm: 2.503,
    orbit: { a: 185539, e: 0.0196, i: 1.574, node: 173.027, argp: 332.499, M0: 14.848 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.78, 0.77, 0.76], paint: 'mimas', tex: 512 },
    info: info({ type: 'Moon of Saturn', diameter: '396 km', year: 'orbits every 22.6 hours', facts: ['Herschel crater is 139 km wide, a third of the moon, with a central peak 7 km tall.'] }),
  },
  {
    id: 'enceladus', name: 'Enceladus', kind: 'moon', parent: 'saturn', R: [256.6, 251.4, 248.3], gm: 7.211,
    orbit: { a: 238042, e: 0.0047, i: 0.003, node: 342.507, argp: 0.076, M0: 199.686 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.95, 0.96, 0.98], paint: 'enceladus', tex: 512, plume: true },
    info: info({ type: 'Moon of Saturn', diameter: '504 km', year: 'orbits every 1.37 days', temp: '-200 C',
      facts: ['The most reflective surface in the Solar System.', 'Geysers from the "tiger stripes" at its south pole spray ice from an ocean below and feed the E ring.'] }),
  },
  {
    id: 'tethys', name: 'Tethys', kind: 'moon', parent: 'saturn', R: [538.4, 528.3, 526.3], gm: 41.21,
    orbit: { a: 294672, e: 0.0001, i: 1.091, node: 259.842, argp: 45.202, M0: 243.367 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.85, 0.85, 0.84], paint: 'tethys', tex: 512 },
    info: info({ type: 'Moon of Saturn', diameter: '1,062 km', year: 'orbits every 1.89 days', facts: ['Odysseus crater is 445 km across.', 'Ithaca Chasma, a canyon 100 km wide, wraps three quarters of the way around.'] }),
  },
  {
    id: 'dione', name: 'Dione', kind: 'moon', parent: 'saturn', R: [563.4, 561.3, 559.6], gm: 73.12,
    orbit: { a: 377415, e: 0.0022, i: 0.028, node: 290.415, argp: 284.315, M0: 322.232 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.76, 0.75, 0.73], paint: 'dione', tex: 512 },
    info: info({ type: 'Moon of Saturn', diameter: '1,123 km', year: 'orbits every 2.74 days', facts: ['The bright "wispy terrain" on its trailing side is a web of ice cliffs hundreds of metres high.'] }),
  },
  {
    id: 'rhea', name: 'Rhea', kind: 'moon', parent: 'saturn', R: [765.0, 763.1, 762.4], gm: 153.94,
    orbit: { a: 527068, e: 0.0002, i: 0.333, node: 351.042, argp: 241.619, M0: 179.781 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.78, 0.77, 0.75], paint: 'rhea', tex: 512 },
    info: info({ type: 'Moon of Saturn', diameter: '1,527 km', year: 'orbits every 4.52 days', facts: ['Saturn\'s second-largest moon, a cratered ball of ice.', 'Bright young Inktomi crater splashes rays across the leading side.'] }),
  },
  {
    id: 'titan', name: 'Titan', kind: 'moon', parent: 'saturn', R: [2574.7, 2574.7], gm: 8978.14,
    orbit: { a: 1221865, e: 0.0288, i: 0.306, node: 28.060, argp: 180.532, M0: 163.310 }, rot: { locked: true },
    look: { ramp: K.ROCK, col: [0.86, 0.6, 0.26], paint: 'titan', tex: 512, halo: 0.2, visAlt: 330 },
    atmo: {
      top: 760, minAlt: 170, P0: 1.47, T: 94, label: 'nitrogen with an orange smog of tholins',
      comps: [
        { H: 52, beta: [0.36, 0.22, 0.09], abs: [0.035, 0.11, 0.24], g: 0.62, ms: 0.65 },
        { H: 0, layer: [510, 26], beta: [0.00018, 0.00028, 0.0005], abs: [0, 0, 0], g: 0.5 },
      ],
    },
    info: info({ type: 'Moon of Saturn', diameter: '5,150 km', gravity: '1.35 m/s2', year: 'orbits every 15.9 days', temp: '-180 C', atmo: 'nitrogen and methane, 1.5 bar at the surface',
      facts: ['The only moon with a thick atmosphere: a 1.5 bar nitrogen sky full of orange smog.', 'Below the haze lie seas of liquid methane and ethane; you can sink to 170 km before the smog turns opaque.', 'Look for the thin blue detached haze layer 500 km up.'] }),
  },
  {
    id: 'hyperion', name: 'Hyperion', kind: 'moon', parent: 'saturn', R: [180, 133, 103], gm: 0.3727,
    orbit: { a: 1500933, e: 0.0232, i: 0.615, node: 263.847, argp: 303.178, M0: 86.342 }, rot: { tumble: 13.0 },
    shape: { amp: 0.14, freq: 1.7, seed: 61 },
    look: { ramp: K.ICE, col: [0.62, 0.56, 0.48], paint: 'hyperion', tex: 256 },
    info: info({ type: 'Moon of Saturn', diameter: '360 x 266 x 205 km', year: 'orbits every 21.3 days', facts: ['A spongy, porous body that tumbles chaotically: its spin is unpredictable.'] }),
  },
  {
    id: 'iapetus', name: 'Iapetus', kind: 'moon', parent: 'saturn', R: [745.7, 745.7, 712.1], gm: 120.51,
    orbit: { a: 3560854, e: 0.0293, i: 15.47, node: 81.105, argp: 271.606, M0: 201.789 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.7, 0.68, 0.64], paint: 'iapetus', tex: 512 },
    info: info({ type: 'Moon of Saturn', diameter: '1,469 km', year: 'orbits every 79.3 days', facts: ['Two-faced: the leading hemisphere is as dark as coal, the trailing as bright as snow.', 'A ridge up to 20 km high runs along its equator, giving it a walnut shape.'] }),
  },
  {
    id: 'phoebe', name: 'Phoebe', kind: 'moon', parent: 'saturn', R: [109.4, 108.5, 101.8], gm: 0.5532,
    orbit: { a: 12947918, e: 0.1634, i: 175.243, node: 241.086, argp: 342.500, M0: 53.038, plane: 'ecliptic' }, rot: { ra: 356.90, dec: 77.80, W0: 178.58, Wd: 931.639 },
    shape: { amp: 0.06, freq: 1.4, seed: 62 },
    look: { ramp: K.ROCK, col: [0.25, 0.24, 0.23], tex: 256, craters: 1.2 },
    info: info({ type: 'Irregular moon of Saturn', diameter: '213 km', year: 'retrograde, every 545 days', facts: ['A captured outer-system body; dust from it forms a vast faint ring.'] }),
  },
  // ----------------------------------------------------------------------------------------- URANUS
  {
    id: 'uranus', name: 'Uranus', kind: 'planet', parent: 'sun', R: [25559, 24973], gm: 5793939,
    orbit: { planet: 'uranus' }, rot: { ra: 257.311, dec: -15.175, W0: 203.81, Wd: -501.1600928 },
    look: { ramp: K.GAS, col: [0.64, 0.84, 0.88], paint: 'uranus', tex: 512, minnaert: 0.8, halo: 0.15 },
    atmo: {
      top: 250, minAlt: 25, P0: 0.6, T: 76, label: 'hydrogen, helium and methane',
      comps: [
        { H: 28, beta: [0.0010, 0.0026, 0.0060], abs: [0.0035, 0.0008, 0.0003], g: 0 },
        { H: 30, beta: [0.0010, 0.0011, 0.0011], abs: [0.0004, 0.0001, 0], g: 0.6 },
      ],
    },
    rings: { inner: 41800, outer: 103000, uranian: true },
    info: info({
      type: 'Ice giant', diameter: '50,724 km', mass: '14.5 Earths', gravity: '8.87 m/s2', day: '17 h 14 min (retrograde)', year: '84 years',
      temp: '-195 C', atmo: 'hydrogen, helium, 2% methane (which makes it blue-green)', moons: '28 known',
      facts: ['Knocked on its side: tilted 98 degrees, each pole gets 42 years of daylight, then 42 of night.', 'Its thin dark rings were found in 1977 when they blinked in front of a star.'],
    }),
  },
  {
    id: 'miranda', name: 'Miranda', kind: 'moon', parent: 'uranus', R: [240.4, 234.2, 232.9], gm: 4.4,
    orbit: { a: 129846, e: 0.0013, i: 4.338, node: 326.4, argp: 68.3, M0: 311.3 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.66, 0.66, 0.66], paint: 'miranda', tex: 512 },
    info: info({ type: 'Moon of Uranus', diameter: '472 km', year: 'orbits every 1.41 days', facts: ['A patchwork of giant ovoid "coronae" and the cliff Verona Rupes, up to 20 km tall.'] }),
  },
  {
    id: 'ariel', name: 'Ariel', kind: 'moon', parent: 'uranus', R: [581.1, 577.9, 577.7], gm: 83.43,
    orbit: { a: 190929, e: 0.0012, i: 0.041, node: 22.4, argp: 115.3, M0: 39.5 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.7, 0.7, 0.69], paint: 'ariel', tex: 512 },
    info: info({ type: 'Moon of Uranus', diameter: '1,158 km', year: 'orbits every 2.52 days', facts: ['The brightest Uranian moon, crossed by long faulted valleys.'] }),
  },
  {
    id: 'umbriel', name: 'Umbriel', kind: 'moon', parent: 'uranus', R: [584.7, 584.7], gm: 85.1,
    orbit: { a: 265986, e: 0.0039, i: 0.128, node: 33.5, argp: 84.7, M0: 12.5 }, rot: { locked: true },
    look: { ramp: K.ROCK, col: [0.36, 0.36, 0.37], paint: 'umbriel', tex: 512 },
    info: info({ type: 'Moon of Uranus', diameter: '1,169 km', year: 'orbits every 4.14 days', facts: ['The darkest of the big Uranian moons, with a mysterious bright ring, Wunda, on its floor.'] }),
  },
  {
    id: 'titania', name: 'Titania', kind: 'moon', parent: 'uranus', R: [788.4, 788.4], gm: 226.9,
    orbit: { a: 436298, e: 0.0011, i: 0.079, node: 99.8, argp: 284.4, M0: 24.6 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.6, 0.57, 0.55], paint: 'titania', tex: 512 },
    info: info({ type: 'Moon of Uranus', diameter: '1,577 km', year: 'orbits every 8.71 days', facts: ['The largest moon of Uranus, split by canyons like Messina Chasma, 1,500 km long.'] }),
  },
  {
    id: 'oberon', name: 'Oberon', kind: 'moon', parent: 'uranus', R: [761.4, 761.4], gm: 205.3,
    orbit: { a: 583511, e: 0.0014, i: 0.068, node: 279.8, argp: 104.4, M0: 283.1 }, rot: { locked: true },
    look: { ramp: K.ROCK, col: [0.52, 0.48, 0.46], paint: 'oberon', tex: 512 },
    info: info({ type: 'Moon of Uranus', diameter: '1,523 km', year: 'orbits every 13.5 days', facts: ['An old, cratered surface; several craters have dark floors and bright rays.'] }),
  },
  // ---------------------------------------------------------------------------------------- NEPTUNE
  {
    id: 'neptune', name: 'Neptune', kind: 'planet', parent: 'sun', R: [24764, 24341], gm: 6836529,
    orbit: { planet: 'neptune' }, rot: { ra: 299.36, dec: 43.46, W0: 249.978, Wd: 541.1397757 },
    look: { ramp: K.GAS, col: [0.3, 0.5, 0.88], paint: 'neptune', tex: 512, minnaert: 0.8, halo: 0.15 },
    atmo: {
      top: 220, minAlt: 22, P0: 0.6, T: 72, label: 'hydrogen, helium and methane',
      comps: [
        { H: 20, beta: [0.0014, 0.0033, 0.0080], abs: [0.0050, 0.0012, 0.0002], g: 0 },
        { H: 22, beta: [0.0008, 0.0009, 0.0010], abs: [0.0004, 0.0001, 0], g: 0.6 },
      ],
    },
    rings: { inner: 40900, outer: 63000, neptunian: true },
    info: info({
      type: 'Ice giant', diameter: '49,244 km', mass: '17.1 Earths', gravity: '11.2 m/s2', day: '16 h 6 min', year: '164.8 years',
      temp: '-200 C', atmo: 'hydrogen, helium and methane', moons: '16 known',
      facts: ['The windiest planet: gusts reach 2,100 km/h.', 'Voyager 2 saw a Great Dark Spot here in 1989, trailed by bright methane clouds.', 'The Adams ring is clumped into bright arcs.'],
    }),
  },
  {
    id: 'proteus', name: 'Proteus', kind: 'moon', parent: 'neptune', R: [210, 208, 201], gm: 2.6,
    orbit: { a: 117647, e: 0.0005, i: 0.524, node: 162.4, argp: 223.7, M0: 279.3 }, rot: { locked: true },
    shape: { amp: 0.07, freq: 1.3, seed: 71 },
    look: { ramp: K.ROCK, col: [0.3, 0.3, 0.3], tex: 256, craters: 1.0 },
    info: info({ type: 'Moon of Neptune', diameter: '420 km', year: 'orbits every 1.12 days', facts: ['About as large as a body can be without gravity pulling it round.'] }),
  },
  {
    id: 'triton', name: 'Triton', kind: 'moon', parent: 'neptune', R: [1353.4, 1353.4], gm: 1427.6,
    orbit: { a: 354759, e: 0.000016, i: 156.865, node: 177.608, argp: 66.142, M0: 352.257 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.76, 0.7, 0.66], paint: 'triton', tex: 512 },
    atmo: {
      top: 40, minAlt: 4, P0: 0.000014, T: 38, label: 'a whisper of nitrogen',
      comps: [{ H: 14, beta: [0.0002, 0.00035, 0.0007], abs: [0, 0, 0], g: 0.6 }],
    },
    info: info({ type: 'Moon of Neptune', diameter: '2,707 km', year: 'orbits every 5.88 days, backwards', temp: '-235 C, among the coldest surfaces known',
      facts: ['Circles Neptune the wrong way: a captured Kuiper belt world.', 'Nitrogen geysers leave dark streaks across its pink southern ice cap.'] }),
  },
  {
    id: 'nereid', name: 'Nereid', kind: 'moon', parent: 'neptune', R: [178, 178], gm: 2.06,
    orbit: { a: 5513818, e: 0.7507, i: 7.09, node: 335.6, argp: 296.8, M0: 359.3, plane: 'ecliptic' }, rot: { ra: 0, dec: 90, W0: 0, Wd: 744.8 },
    look: { ramp: K.ROCK, col: [0.4, 0.4, 0.4], tex: 256, craters: 1.0 },
    info: info({ type: 'Irregular moon of Neptune', diameter: '357 km', year: 'every 360 days on a stretched orbit', facts: ['Its orbit is the most eccentric of any known moon: its distance from Neptune swings sevenfold.'] }),
  },
  // ------------------------------------------------------------------------------------------ PLUTO
  {
    id: 'pluto', name: 'Pluto', kind: 'dwarf', parent: 'sun', R: [1188.3, 1188.3], gm: 869.3,
    orbit: { planet: 'pluto', binary: 'charon' }, rot: { ra: 132.993, dec: -6.163, lockTo: 'charon' },
    look: { ramp: K.ICE, col: [0.78, 0.66, 0.54], paint: 'pluto', tex: 512 },
    atmo: {
      top: 260, minAlt: 6, P0: 0.00001, T: 44, label: 'nitrogen with layered blue haze',
      comps: [{ H: 42, beta: [0.0005, 0.0010, 0.0024], abs: [0.0001, 0.0001, 0], g: 0.72 }],
    },
    info: info({ type: 'Dwarf planet (Kuiper belt)', diameter: '2,377 km', mass: '0.0022 Earths', gravity: '0.62 m/s2', day: '6.39 days (retrograde)', year: '248 years', temp: '-230 C',
      atmo: 'thin nitrogen, with blue haze layers', moons: '5',
      facts: ['The bright heart, Tombaugh Regio, holds Sputnik Planitia: a 1,000 km glacier of nitrogen ice, slowly churning.', 'Pluto and Charon are locked face to face.'] }),
  },
  {
    id: 'charon', name: 'Charon', kind: 'moon', parent: 'pluto', R: [606, 606], gm: 105.88,
    orbit: { binaryOf: 'pluto', a: 19591, e: 0.0002, i: 0.0, node: 0, argp: 0, M0: 0 }, rot: { locked: true },
    look: { ramp: K.ICE, col: [0.55, 0.53, 0.52], paint: 'charon', tex: 512 },
    info: info({ type: 'Moon of Pluto', diameter: '1,212 km (half of Pluto)', year: 'orbits every 6.39 days', facts: ['Its reddish north pole, Mordor Macula, is stained by gas escaping from Pluto.'] }),
  },
  {
    id: 'nix', name: 'Nix', kind: 'moon', parent: 'pluto', R: [25, 17, 15.5], gm: 0.003,
    orbit: { a: 48694, e: 0.002, i: 0.13, node: 0, argp: 0, M0: 120 }, rot: { tumble: 1.83 },
    shape: { amp: 0.1, freq: 1.4, seed: 81 },
    look: { ramp: K.ICE, col: [0.75, 0.74, 0.72], tex: 128, craters: 0.8 },
    info: info({ type: 'Moon of Pluto', diameter: '50 x 35 x 33 km', facts: ['Tumbles chaotically in the shifting gravity of the Pluto-Charon pair.'] }),
  },
  {
    id: 'hydra', name: 'Hydra', kind: 'moon', parent: 'pluto', R: [25.5, 18, 15.5], gm: 0.003,
    orbit: { a: 64738, e: 0.0059, i: 0.24, node: 0, argp: 0, M0: 240 }, rot: { tumble: 0.43 },
    shape: { amp: 0.11, freq: 1.5, seed: 82 },
    look: { ramp: K.ICE, col: [0.78, 0.78, 0.77], tex: 128, craters: 0.8 },
    info: info({ type: 'Moon of Pluto', diameter: '51 x 36 x 31 km', facts: ['Coated in almost pure water ice.'] }),
  },
];

export const BY_ID = Object.fromEntries(BODIES.map((b) => [b.id, b]));
