# ASCII Solar System

A browser flythrough of the Solar System drawn as ASCII characters. There is no framework, no package manager, and no test runner. Runtime code is plain ES modules under `src/`. The page people open is one self-contained HTML file.

Read `README.md` for what the simulation claims and for the control list. This file is how to change the code without breaking the frame, the build, or the hot path.

## Run and build

Serve the repo and open the dev entry. ES modules will not load from `file://`.

```
python3 -m http.server
# http://localhost:8000/index.html
```

`index.html` fetches `shell.html`, inserts it, then loads `src/main.js` as a module. Markup lives in `shell.html` only. The canvas is `#screen`. If WebGL2 is missing, `#fallback` is shown and the loop never starts.

`node build.mjs` needs `deno` on `PATH`. It bundles `src/main.js` to `dist/bundle.js`, then writes `dist/artifact.html` (the shell plus the script, no document wrapper) and `dist/ascii-solar-system.html` (the file the README tells people to open). All three are tracked. After a source change that should ship, rebuild and commit `dist/` with the source. Do not hand-edit `dist/`.

There is nothing to install.

## Layout

| Path | Role |
| --- | --- |
| `src/main.js` | Boot, input, frame loop, title cinematic, `window.__solar` |
| `src/system.js` | Live positions, spin axes, spheres of influence, the statistical swarm |
| `src/bodies.js` | Catalogue: size, mass, orbit, spin, look, atmosphere, facts. Material codes `K` |
| `src/astro.js` | Julian Date, Kepler, planet and Moon ephemerides, pole orientation |
| `src/ship.js` | Camera. Position is stored relative to the body whose sphere of influence you are in |
| `src/render.js` | Flight view. One ray per cell: sky, then worlds far to near, rings, atmosphere |
| `src/surface.js` | Per-sample shading on top of the baked map, including wind drift and special cases |
| `src/paint.js` | Procedural equirectangular painters. One function per `look.paint` id |
| `src/textures.js` | Map storage and the baker that fills a few rows per frame |
| `src/rings.js` | Radial ring profiles |
| `src/asciify.js` | Luminance ramps that turn flat colour cells into glyphs |
| `src/gl.js` | WebGL2 atlas draw, glow blur, tone map |
| `src/grid.js` | The character grid every view writes |
| `src/hud.js` | Clock, nav list, facts, help, toasts, map chrome. Drawn into the same grid |
| `src/mapview.js` | System map mode |
| `src/starfield.js` | Yale bright stars plus a procedural Milky Way |
| `src/font.js` | Atlas and the 3x3 coverage-to-glyph table used on limbs |
| `src/audio.js` | Small synth. Starts only after a user gesture |
| `src/util.js` | Scalar helpers, value-noise, and array vec3 (`add`, `mul`, `norm`, `rotate`) |
| `src/data/` | Generated Earth class map and star catalogue. Regenerate; do not edit |
| `tools/` | `gen-earth.mjs`, `gen-stars.mjs` |

`vec3` values are plain arrays of three numbers. Many helpers return a new array. The render and bake loops do not. They write into module-level scratch (`S` in `surface.js`, `O` in `textures.js`, and the fields on `View`). Never keep a reference to that scratch past the call that filled it.

## Frame and time

Positions are heliocentric ecliptic J2000, in kilometres. `+x` points at the vernal equinox, `+z` at ecliptic north. The system is right-handed.

Time is a Julian Date. `J2000` is `2451545.0`. `jdFromMs` and `msFromJd` convert to Unix milliseconds. `days` in the renderer is `jd - J2000`.

Planet positions come from Standish Keplerian elements in `PLANET_ELEMENTS`, valid about 1800 to 2050. Outside that window they drift. Do not swap in another theory as a silent "fix". The Moon is `moonGeo`. Earth and the Moon circle the Earth-Moon barycentre (`MU_MOON` in `system.js`). Pluto and Charon circle their barycentre the same way (`orbit.binary`).

Other moons use JPL mean elements at epoch J2000, in the parent's equatorial frame unless `orbit.plane` says otherwise. Angles in `bodies.js` are degrees. `orbitXYZ` wants radians and a semi-major axis in kilometres. Heliocentric elements are in AU until `relPos` scales them.

Rotation is the IAU model: right ascension and declination of the pole, prime meridian `W = W0 + Wd * days`. A negative `Wd` is retrograde. Feature longitudes elsewhere are planetocentric east. Tidally locked moons set `rot.locked`. The spin axis follows the right-hand rule so prograde moons orbit about it.

The ship does not store a heliocentric position as its source of truth. `ship.frame` is the body whose sphere of influence the camera is in, `ship.rel` is kilometres from that body's centre, and `ship.world` is `frame.pos + rel`. `setFrame` rewrites `rel` so the world position stays put. Updating body positions without going through `SolarSystem.update`, or moving the ship in world space and forgetting `rel`, throws the camera off the body it was riding.

The camera basis is `fwd`, `right`, `up`, orthonormal. `View.project` puts `+up` toward smaller row numbers. Row 0 is the top of the grid. `lookAt` builds `right` from the ecliptic north pole, so a view straight along `+z` needs the existing fallback.

Radii and altitudes are kilometres. `R` is `[equatorial, polar]` or triaxial `[a, b, c]`. `gm` is km^3/s^2. `atmo.top` and `atmo.minAlt` are kilometres above the reference radius. The ship will not go below `minAlt`. Venus and similar worlds publish a cloud-deck radius (`solidR` is the ground). That larger `R` is what you fly around. Do not "correct" it to the solid surface unless the floor, the painter, and the facts change with it.

## Where a change goes

A new visitable world is a `BODIES` entry in `bodies.js`: `id`, `kind`, `parent`, `R`, `gm`, `orbit`, `rot`, `look`, optional `atmo`, `rings`, `shape`, and `info`. Wire a painter in `paint.js` under `PAINTERS`, keyed by `look.paint` or, if that is omitted, by `id`. `painterFor` falls back to a generic rocky body. Special shading that depends on time of day, wind, or the season belongs in `sampleSurface`, not in the painter. The painter runs once per texel while the map bakes. `sampleSurface` runs once per ray.

Painter signature: `(p, lat, lon, o, x, y)`. `p` is a unit vector in the body frame, `lat` and `lon` are degrees, `o` is the scratch `O`. Write `r, g, b` in 0..1, relief `h`, material byte `m`, cloud `c`, night lights `l`. Maps are equirectangular. Row `y = 0` is latitude +90. Column `x = 0` is longitude -180. `sampleSurface` then reads a body-fixed unit vector as `lat = asin(pz)`, `lon = atan2(py, px)`.

Glyph ramps live in two places. Limb cells are chosen in `render.js` from a 3x3 coverage mask and the font's ink table, which is where `( ) / \ _` silhouettes come from. Interior cells are left as a space with a background colour and a `kind` of `K.*`. `asciify` fills only those cells (`ch === 32`), using `RAMPS` indexed by `K`, and it skips cells whose glow is above 0.12. A new material needs a `K` code, a ramp, and a gain. `K.UI` (4) and `K.SPACE` (0) are not ramped. `autoExposure` skips both.

Keys are handled in `main.js`. The help panel is the `HELP` lines in `hud.js`, and the controls table is in `README.md`. Change all three together. Number keys 1-9 and 0 target `PLANET_KEYS` in `main.js`.

Ring profiles are `rings.js`. Atmospheres are the `atmo.comps` arrays on the body. Each component has a scale height `H` (km), RGB scattering `beta`, absorption `abs`, a Henyey-Greenstein `g`, and an optional multiple-scattering term `ms`. Integration, eclipse, and ring shadows are in `render.js`. The Chapman helper there is the grazing column density. Do not replace it with a constant.

The background asteroid belt, Hildas, Trojans, and Kuiper belt are a statistical swarm from `SolarSystem.makeSwarm`. They are not named objects. Named small bodies (Ceres, Vesta, and the rest) are real `BODIES` entries.

`src/data/earth.js` and `src/data/stars.js` are generated. Rebuild them with `node tools/gen-earth.mjs <dir>` (Natural Earth `ne_50m_land`, `ne_50m_lakes`, `ne_50m_glaciated_areas` GeoJSON) and `node tools/gen-stars.mjs <bsc5-short.json>`. Do not commit those downloads. Classes in the Earth map are 0 ocean, 1 land, 2 ice, 3 lake.

## Frame loop

`requestAnimationFrame` in `main.js` does this, in order:

1. Step `sys.jd` by `dt * rate / 86400`, unless paused. On the title screen the rate is fixed at one hour per second and the cinematic owns the ship.
2. `ship.update`, then drain `ship.messages` into toasts.
3. `baker.work`. A few rows of whichever maps are open. `baker.now(body)` finishes one body immediately. Call it before a jump that needs the surface on the first frame (`__solar.tp` and `__solar.orbit` already do).
4. `View.render` or `MapView.render`.
5. `autoExposure`, then `asciify` if character shading is on, then `Hud.render`, then `gl.draw`.

`grid.kind` stores a `K` material code. Colours in `fg` and `bg` are linear floats and may exceed 1. `pack()` scales them by `HDR_RANGE` (1.8) into the two RGBA8 textures. Depth is kilometres along the view ray. HUD draws after the view, with `K.UI`, so exposure and asciify leave it alone.

Brightness is compressed on purpose. `View.adapt` lifts the outer Solar System, and `autoExposure` pulls a dim frame toward a readable mid grey, clamped. A scene that looks "too bright" at Neptune is usually that adaptation, not a missing inverse-square term.

Speed scales with distance to the nearest surface, up to `MAX_SPEED` (3000c). Throttle is `ship.speedK`. The floor check is in `ship.update`. Heat and buffeting come from `ship.atm` and are applied to the camera basis only for that frame.

## Debug hook

After boot the console has `window.__solar`: `sys`, `ship`, `hud`, `view`, `map`, `state`, `baker`, `audio`, and `perf` (`sim` and `render` are exponential-moving millisecond averages).

Any key except F5, F11, and F12 leaves the title cinematic and calls the same path as `start()`. Until then the cinematic overwrites the ship every frame. Call `start()` before placing the camera.

- `start()` leaves the title and parks above Earth, target the Moon.
- `target(id)` and `go(id)` set the nav target and, for `go`, engage the autopilot.
- `tp(id, dist, side, elev)` jumps to `dist` km from the centre. The default dist is `ship.standoff`. `side` and `elev` match `placeAt`.
- `orbit(id, dist, lat, lon, tilt)` looks at the body from a body-fixed latitude and longitude, in degrees, north up.
- `sunside(id, dist, lat, dlon, featLon, featDrift)` does that from the sunlit side. Pass `featLon` to spin the clock until that longitude faces the Sun.
- `jd(v)` sets the clock. `rate(i)` indexes `TIME_RATES` in `hud.js`. `mode('view' | 'map')`.
- `bakeAll()` finishes every non-star map. It will hitch. Use it to inspect a surface, not as a startup path.
- `lookAt(id)`, `look(x, y, z)`, `turn(yaw, pitch)`.

Examples from the README: `__solar.go('saturn')`, `__solar.tp('titan', 3000)`, `__solar.sunside('jupiter', 200000, -15, 0)`, `__solar.jd(2457930.5)` for June 2017.

## Conventions

Match the surrounding file. Top-of-file comments state the module's job and the units. Comments inside functions are for a numerical or physical constraint, not a restatement of the next line.

Do not add a dependency, a bundler, or a `package.json` unless asked. `deno` is a build tool only. It must not become a runtime import.

Keep hot loops allocation-free: `View.render`, `sampleSurface`, `bakeRows`, `asciify`, and the frame function. A new array per cell shows up in `__solar.perf`.

There is no test suite. Verify in the browser. Serve the folder, open `/index.html`, leave the title with `start()` or a key, and place the camera with `tp`, `orbit`, or `sunside` on the body you changed. Check both the lit and the dark side when the change is shading or emission. If the edit is visible in the shipped page, rebuild `dist/` and open `dist/ascii-solar-system.html` directly. The dev entry and the bundle do not share a server.

The GL path is shared in spirit with ASCII City. Grid layout, the atlas, and `gl.js` are that pipeline. Prefer extending them over forking a second renderer.

## Do not

- Reformat an unrelated file in the same change.
- Hand-edit `src/data/*.js` or anything under `dist/`.
- Treat the swarm as a catalogue of real asteroids, or the painters as measured maps. Named features are placed on purpose. The ground between them is invented. Say which is which.
- Widen the planet-element validity window without a source.
- Store the ship as a raw heliocentric coordinate and skip `setFrame`.
