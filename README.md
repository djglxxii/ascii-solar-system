# ASCII Solar System

The Solar System drawn entirely in the 95 printable ASCII characters. Fly anywhere in it: the Sun,
all eight planets and the major moons, Pluto and Charon, and the big bodies of the asteroid belt,
each where it really is today. Drop low enough over Jupiter, Earth, Titan or any other world with
air and you skim its upper atmosphere, with the sky, haze and re-entry heating to match.

Open `dist/ascii-solar-system.html` in a browser that supports WebGL2. It is one self-contained file
and needs no server.

## Controls

| Key | Action |
| --- | --- |
| W A S D | fly forward / back, strafe |
| R / F | up / down |
| Mouse (click to capture) or arrows | look |
| Q / E | roll |
| Wheel, Z / X | throttle |
| Shift | boost (x6) |
| Space | brake |
| Tab | navigation list (Enter flies there, Space just targets) |
| 1-9, 0 | target Mercury ... Pluto, 0 for the Sun |
| G | autopilot to the target |
| C | turn to look at the target |
| I | facts about the target |
| M | system map (wheel to zoom from the whole system into the target's moons) |
| O | orbit lines |
| L | labels |
| V | lens: normal, telephoto, wide |
| [ / ] | slow down / speed up time (real time up to 1 year per second) |
| K | pause the clock |
| T / Y | back to real time / back to the present moment |
| N | sound |
| B, U | glow, character shading |
| + / - | text size (sets the rendering resolution) |
| P | frame rate and timings |
| H | help |

Speed is tied to your distance from the nearest surface, so the throttle sets how fast you close on
things rather than a fixed velocity. Between planets that is hundreds of times the speed of light;
skimming Phobos it is tens of metres a second. You cannot fly into a planet. Each world has a floor
(25 km above Jupiter's cloud tops, 18 km over Earth, 170 km down into Titan's smog) and the ship
holds there.

## What's in it

- **Positions.** Planets follow JPL's Keplerian elements (Standish, valid 1800 to 2050), the Moon a
  lunar theory with its main perturbations, other moons JPL mean orbital elements around their
  planet's equator. Earth and the Moon circle their barycentre, and so do Pluto and Charon. Spin axes
  and prime meridians come from the IAU rotation models, tidally locked moons keep one face to their
  planet, and Hyperion tumbles. The clock starts at the current date, so Saturn's rings are tilted as
  they are tonight, and an eclipse you see will have happened.
- **Planets.** Jupiter has its belts and zones, the Great Red Spot and Oval BA turning in place,
  festoons along the NEB, and Juno's polar cyclones: eight around the north pole, five around the
  south. Each latitude band drifts at its own wind speed. Saturn has the north polar hexagon and
  vortex, the wavy ribbon jet at 47 N, and rings built from the real radial profile (C ring, B ring,
  Cassini Division, A ring with the Encke Gap, the F ring), lit from the correct side, shadowed by the
  planet and casting their own shadow back on it. Neptune has a Great Dark Spot with bright companion
  clouds and the clumped arcs of the Adams ring. Earth is drawn from Natural Earth coastlines with
  deserts, forests, ice sheets, sea ice, drifting clouds, sun glint on the oceans, city lights on the
  night side and the aurora. Mars has its classic dark markings, Olympus Mons and the Tharsis
  volcanoes, Valles Marineris, Hellas, and polar caps that grow and shrink with the season.
- **Moons and small bodies.** Over thirty, each with its own surface: the lunar maria and Tycho's
  rays, Io's volcanoes and Pele's red ring (the lava glows on the night side), Europa's lineae,
  Ganymede's grooved terrain, Callisto's Valhalla, Enceladus's tiger stripes and plume, Mimas's
  Herschel, Iapetus's two-tone face and equatorial ridge, Titan's orange smog with its detached blue
  haze layer, Triton's pink polar cap, Pluto's heart and Cthulhu, Charon's red pole. Phobos, Deimos,
  Vesta, Ida (with its moon Dactyl), Hyperion and other small bodies are lumpy shapes, not spheres.
- **The belt and beyond.** Ceres, Vesta, Pallas, Hygiea, Juno, Psyche and Ida can be visited. About
  6,000 background objects sketch the main belt with its Kirkwood gaps, the Hilda triangle, the two
  Trojan camps sixty degrees ahead of and behind Jupiter, and the Kuiper belt with the plutinos held
  in resonance with Neptune. These are statistical, not catalogued asteroids, so they show where
  things are without pretending to be specific objects.
- **Sky.** The 6,331 naked-eye stars of the Yale Bright Star Catalogue in their real positions and
  colours, a fainter field crowding toward the galactic plane, and the Milky Way with the bulge, the
  Great Rift and the Magellanic Clouds.
- **Atmospheres.** Rayleigh and haze scattering are integrated along every ray, so Earth's sky turns
  blue and its limb is a thin bright line, Mars has a butterscotch sky with bluish light around the
  Sun, Venus and Titan look like the hazy balls they are, and the giants have tan or blue limbs.
  Flying fast through thick air heats the hull: the screen edges glow, plasma streaks past and the
  view shakes.

## How it's drawn

Every frame the renderer fills a grid of character cells (glyph, foreground, background, glow,
depth) and a WebGL2 shader draws the grid from a font atlas in one pass, with a blurred emissive
pass for glow and a filmic tone curve. This part is shared with ASCII City.

Each cell is a ray from the camera. Worlds are traced far to near as ellipsoids, or as a radius map
marched for the irregular bodies; rings are intersected in the equatorial plane; atmospheres are
integrated with adaptive steps, a Chapman approximation for the sunlight reaching each point, and a
small multiple-scattering term for thick hazes. Cells on a limb are sampled 3x3 and the coverage mask
picks the glyph whose ink matches it, which is where the `( ) / \ _` silhouettes come from. Interior
cells take a character from a ramp chosen by material: `~` for oceans and gas bands, `.:+*#` for
rock, `( = )` along the rings. Surfaces come from equirectangular maps painted procedurally the
first time a world gets close, a few rows per frame, plus finer noise and small craters added as you
descend so the ground keeps resolving. Exposure adapts to the scene, which is why the outer planets
and polar twilight are still readable.

## Accuracy, and where it gives way

Positions and orientations are good to well under a degree for the planets and the Moon around the
present day. Moon phases elsewhere come from mean elements, so a Galilean moon might sit a few
degrees from where an ephemeris puts it. Surfaces are painted from known features at their real
coordinates, but between those features the detail is invented. Brightness is compressed on purpose:
Neptune gets about 1/900 of Earth's sunlight, and the eye adaptation lifts it to something you can
see. Outside 1800 to 2050 the planetary elements drift.

## Development

```
src/          ES modules (no dependencies)
src/data/     generated star catalogue and Earth land mask
tools/        generators for src/data (Natural Earth, Yale BSC)
shell.html    page markup shared by the dev entry and the build
index.html    dev entry: serve this folder, e.g. `python3 -m http.server`, then open /index.html
build.mjs     bundles src/ into dist/ascii-solar-system.html (uses `deno bundle`)
```

`node build.mjs` writes `dist/ascii-solar-system.html`, plus `dist/artifact.html`, a fragment
without the `<html>` wrapper.

To regenerate the data, download `ne_50m_land`, `ne_50m_lakes` and `ne_50m_glaciated_areas` from
Natural Earth (GeoJSON) and `bsc5-short.json` (Yale Bright Star Catalogue), then run
`node tools/gen-earth.mjs <dir>` and `node tools/gen-stars.mjs <path to bsc5-short.json>`.

In the browser console, `window.__solar` exposes the simulation, for example `__solar.go('saturn')`,
`__solar.tp('titan', 3000)`, `__solar.sunside('jupiter', 200000, -15, 0)` or `__solar.jd(2457930.5)`
to jump to June 2017, when Saturn's hexagon was in full sun.
