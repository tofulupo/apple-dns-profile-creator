# Development

For working on the code. How to use the tool and build it from a tag is in the
[README](../README.md).

Requires [Deno](https://deno.com) 2.9 or newer. The desktop app also needs
[Rust](https://rustup.rs) 1.85 or newer and Xcode 26 or newer.

## Tasks

```sh
deno task dev              # build, watch and serve on the LAN
deno task build            # production bundle into dist/
deno task preview          # build once, then serve
deno task desktop          # build, then package the macOS app with Tauri
deno task desktop:dev      # build, then run the app without packaging it
deno task desktop:icon     # regenerate the app's icon files after editing the icon
deno task profiles "<certificate name or SHA-1>"  # on a Mac, after a preset changes

deno task check            # type-check + lint + fmt --check + Markdown lint + all tests
deno task lint:md          # Markdown lint only (rumdl, settings in .rumdl.toml)
deno task test             # all tests: the site's and the desktop app's
deno task test:web         # the site's tests only (Deno)
deno task test:desktop     # the desktop app's tests only (Rust)
deno task test:e2e         # the app, driven with WebDriver (Linux)
deno task test:browser     # the website in Chrome for Testing
deno fmt                   # format
deno task check:live       # check mobileconfig.io: headers, redirects, TLS, security.txt

deno task fixtures:fetch   # (re)download upstream .mobileconfig test fixtures
deno task fixtures:lint    # validate fixtures with Apple's plutil (macOS only)
deno task deps:update      # latest compatible deps, Tauri's too, a day old at least
```

## Local development

```sh
deno task dev                      # http://localhost:5173, also on the LAN
DNS_TOOL_PORT=8080 deno task dev   # different port
```

`dev` builds `dist/`, serves it, and rebuilds whenever anything in `src/`,
`css/`, `pages/`, `public/` or `deno.json` changes. There is no hot reload;
refresh the page. Edits to `pages/pages.ts` itself need a restart.

### HTTP or HTTPS

**Plain HTTP is fine.** The one API that would have required https,
`crypto.randomUUID()`, is wrapped in [`src/lib/uuid.ts`](../src/lib/uuid.ts),
which falls back to `crypto.getRandomValues()`.

To serve the dev or preview server over TLS, set both variables:

```sh
DNS_TOOL_TLS_CERT=/path/cert.pem DNS_TOOL_TLS_KEY=/path/key.pem deno task dev
```

> [!NOTE]
> Setting only one is an error rather than a silent fallback to HTTP. For a real
> deployment, terminate TLS at a reverse proxy.

## Tests

```sh
deno task test             # the suite: Deno tests, then the app's Rust tests
deno task check            # type-check + lint + fmt --check + Markdown lint + the suite
deno task fixtures:fetch   # required once, for the Mullvad-dependent tests
```

The desktop app's tests live next to its code in `src-tauri/src/`, as Rust
`#[cfg(test)]` modules; `deno task test:desktop` builds `dist/` first, since the
app embeds it.

Expected behavior is derived from Apple's payload documentation and from real
profiles known to install on devices.

Test fixtures are genuine profiles from upstream projects. The paulmillr
profiles are public domain and committed here; the Mullvad profiles carry no
license, so they are fetched on demand and the cases that use them contribute
nothing until you run `deno task fixtures:fetch`. Cases no upstream file covers
use profiles built with this project's own builder, in `test/fixtures/own/`.

`test/golden/` holds the exact profiles the builder produced for every committed
fixture. A failure there means generated profiles changed, which is a change to
what users install: review the diff and update the files deliberately, rather
than regenerating them to make the suite pass.

`test/invariants/` checks the promises the app makes: no network requests, no
listener, no telemetry, the signing key stays in the Keychain, no markup from
imported text. The guards scan whatever the build ships, and fail on a code file
they don't know where to put.

`test/e2e/` drives the built app with WebDriver (`tauri-driver`, Linux only),
`test/browser/` drives the website in Chrome. Both need a display; on a desktop
under Wayland, run them in `Xwayland :99` with `DISPLAY=:99`.

On macOS the suite additionally pipes generated profiles through Apple's own
`plutil`. The `check` workflow runs on both Ubuntu and macOS for every push and
pull request, so that leg is covered in CI.

## Architecture

```sh
src/lib/         pure core - no dependencies, no DOM
  xml.ts           minimal XML reader for the plist subset
  plist.ts         Apple property list build + parse
  dnssettings.ts   DnsConfig -> DNSSettings dictionary
  ondemand.ts      DnsConfig -> OnDemandRules array
  profile.ts       DnsConfig[] -> configuration profile
  import.ts        .mobileconfig -> DnsConfig[]
  settings.ts      which configurations have the same settings
  compare.ts       what differs between two configurations
  filename.ts      file names from configuration names
  fonts.ts         checks font profiles (desktop app)
  addresses.ts     resolver address filtering
  validate.ts      IP validation, list parsing
  uuid.ts          UUIDs, also without crypto.randomUUID()
  types.ts         domain types
  mod.ts           public surface

src/config.ts    presets, and what picking one does to a configuration

src/ui/          browser layer - DOM wiring only, no profile semantics
  tool.ts          entry point for pages/index.html
  profile.ts       entry point for pages/finalize.html
  settings_window.ts entry point for the desktop app's Settings window
  storage.ts       configuration store, in the tab or kept in the browser
  privacy.ts       the website's Privacy pill: forget on close, or keep
  notes.ts         notes on a loaded file, as data
  file_notes.ts    those notes as tiles
  compare_view.ts  two cards side by side
  card_values.ts   the values on a card
  dropzone.ts      drag and drop onto either page's zone, reading the file
  download.ts      Blob download, or the desktop binding when present
  signing.ts       desktop-only Signature choice on the profile page
  theme.ts         header theme switch: system, light or dark
  settings.ts      motion, kept with the theme
  dialogs.ts       confirm() and alert(), native in the desktop app
  desktop.ts       the desktop app's commands, as bindings
  opened.ts        profiles the desktop app opened from Finder
  save_menu.ts     File > Save and Share in the desktop app
  page_ready.ts    tells the desktop app to show its window
  mascot.ts        the desktop app's mascot turning toward the pointer
  profile_count.ts the count on the Profile tab
  dock.ts          the phone bar, out of the keyboard's way
  editing.ts       text edits that keep undo working
  overscroll.ts    no bounce on pages that fit the window
  pixel.ts         the pixel font, a hidden extra
  dom.ts           typed DOM helpers

src/desktop/
  bindings.ts      the desktop app's commands as the pages call them

pages/           HTML sources
  pages.ts         page table: nav order, descriptions, entry modules,
                   SITE_URL (the deployed address)
  _layout.html     shared shell: head, header, tabs
  _prepaint.js     theme and motion before the first paint, and data-js,
                   without which CSS hides what needs a script
  index.html       <main> content of the tool page
  finalize.html    <main> content of the profile page
  _404.html        the website's 404 page
  _noscript.html   the website's notice for browsers that block scripts
  _ready_made.html the website's links to the ready-made preset profiles
  _settings.html   the desktop app's Settings window
  llms.txt         template for dist/llms.txt; {{ site }} becomes SITE_URL

isolation/       the app's isolation pattern: checks every call into Rust
  hook.js          the allowlist of commands and argument shapes

scripts/         build, servers, checks and releases
  build.ts         render pages into the layout, deno bundle -> dist/,
                   sitemap.xml, robots.txt, llms.txt and build.txt
  preset_profiles.ts  deno task profiles: the presets as profiles in the
                   declaration format, signed into public/profiles/ by
                   src-tauri/examples/sign_profiles.rs (macOS, Keychain)
  serve.ts         static file server, --watch rebuilds
  headers.ts       the website's headers: security headers, CSP, caching
  server.ts        dist/ with those headers and compression, for Deno
                   Deploy, the browser tests and Lighthouse
  check_live.ts    checks the live site against headers.ts, with curl
  web_fonts.ts     the licensed web fonts, from a local folder or R2
  desktop_release.ts signed and notarized app builds
  deps_update.ts   dependency updates, Deno's and Cargo's
  app_icon.ts      AppIcon.png and src-tauri/icons/ from desktop/AppIcon.icon
  fonts.ts         fonts/source/ -> Latin-only fonts/subset/
  fetch_fixtures.ts, lint_fixtures.ts  the upstream test fixtures

src-tauri/       macOS app (Tauri 2): shows dist/ in a native window
  tauri.conf.json    window, bundle, icon, CSP and isolation settings
  capabilities/      what each window's page may call
  src/lib.rs         the commands the pages call, window and app setup
  src/app_settings.rs theme, motion and Forget on quit
  src/menu.rs        the menu bar
  src/save.rs        save to a folder without overwriting
  src/share.rs       the share menu
  src/signing.rs     Keychain signing with macOS's Security framework, and
                     signature checks on opened profiles
  src/profile.rs     refuses anything but DNS profiles before saving or signing
  src/opened.rs      profiles opened from Finder or dropped on the window
  src/navigation.rs  keeps the windows on the app's own pages
  src/private.rs     files and folders only the user can read
  src/window_size.rs remembered window size
  src/dialog.rs      native alerts, for the pages and the commands

desktop/         macOS app icon (AppIcon.icon, light + dark), DMG background
public/          copied verbatim into the build, names unchanged
```

> [!NOTE]
> `dnssettings.ts` and `ondemand.ts` are split out because Apple defines both
> structures identically for the `.mobileconfig` payload and for the **iOS 26**
> `com.apple.configuration.network.dns-settings` declaration.

## Pages

| File            | Purpose                                                         |
| --------------- | --------------------------------------------------------------- |
| `index.html`    | The tool: upload an existing profile, or enter settings by hand |
| `finalize.html` | Profile view: review the collected configurations and download  |

Each page is only its `<main>` content in `pages/`. The build renders it into
`pages/_layout.html`, filling in the description, the tab bar and the version.
To add a page, add a fragment to `pages/` and an entry to `PAGES` in
`pages/pages.ts`. The tabs and `sitemap.xml` follow automatically.

## Configuration

Application settings live in [`src/config.ts`](../src/config.ts) as typed
constants. The version shown in the header is `SITE_VERSION` in
[`pages/pages.ts`](../pages/pages.ts) on the website, and `version` in
[`deno.json`](../deno.json) in the desktop app, both injected at build time.

The **Quick presets** on the tool page are `presets` in the same file: up to six
providers, each a name, protocol and server, plus optional `serverAddresses`
(the provider's resolver IPs, filled into the form so one click gives a complete
profile). `test/config.test.ts` fails the suite if there are more than six, if
names repeat, if a server would not pass the form's own check, or if an address
is not a valid IP or appears twice.

| Variable            | Effect                                 |
| ------------------- | -------------------------------------- |
| `DNS_TOOL_PORT`     | Dev/preview server port (default 5173) |
| `DNS_TOOL_TLS_CERT` | PEM certificate path - enables HTTPS   |
| `DNS_TOOL_TLS_KEY`  | PEM private key path - enables HTTPS   |

Desktop app settings (name, identifier, window, icons, signing) live in
[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json); its version comes
from `deno.json` too.

## Release builds

`deno task desktop` signs the app ad hoc, which is enough to run it on the Mac
that built it. Without the licensed Söhne files in `fonts/subset/` it uses a
fallback font with the same metrics, and nothing else changes. Signed and
notarized builds come from `deno task desktop:release`, which needs a Developer
ID and the Söhne files.
