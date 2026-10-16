# Changelog

Changes to the DNS Profile Creator desktop app for macOS.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The
app shares its version number with the website: app releases have even major and
minor numbers, like 4.0.0. A release candidate carries an `-rc` suffix and comes
before the final release.

## [4.0.0-rc.3] - 2026-10-16

The third release candidate of the desktop app, for testing before 4.0.0. A
loaded file shows notes on what's in it, comparing two cards starts with what
differs, and a profile on one of Mullvad's servers can move to another resolver
and keep its rules. Calls from the page into the app pass a second check. It
comes as signed and notarized DMGs for Apple silicon and Intel.

### Added

- The DMG opens on a background with the mascot peeking over a window that says
  "Your device. Your profile. Your rules.", and `>>>` from the app to
  Applications.
- Notes on a loaded file, as tiles in the load card on the Tool page and above
  the imported cards on the Profile page: the signature ("Not checked" or "Not
  signed"), the format ("Legacy payload" or "Declarations"), DNS over TLS,
  settings that weren't carried over, and "Already in profile" when nothing was
  added. They go away once all cards from that file are deleted.
- A legacy profile's Format note says "Deprecated by Apple in OS 27, still
  works." and has a "Use Declaration format" button, with Undo. The download
  then replaces the legacy payload (OS 26+).
- A note on files that use one of Mullvad's servers: "Stops on 2 November 2026",
  and "Stopped on 2 November 2026" from that day. It says to pick another
  resolver, like Quad9, and that your rules stay.

### Changed

- Comparing two cards opens on the differences, with "All" one click away. Each
  field says "Same" or "Different", and what differs as a sentence, like
  "Cellular only in A" or "Same addresses, different order".
- The comparison is a table with each profile's name, file, Profile ID and
  SHA-256 above its column. The values start where the text in their card does,
  and a field that differs is a rounded block under each card. The SHA-256 is in
  the accent color when both sides are the same file.
- Differences are marked in amber instead of blue. An entry only one side has is
  an amber chip, and one the other side lacks is dashed. Resolvers are paired by
  family and position, so you see which address replaced which.
- A card that was never saved shows the format a download would give it, Legacy
  or Declarative.
- Shorter texts in Settings ("Forget on quit", "Deletes cards and signing
  choices."), under the Download switches, and in the dialog for a profile with
  a broken signature.
- Errors for a refused file use plainer words and say what to try next.
- The HaGeZi, njal.la and FlokiNET presets list DNSSEC.
- Tauri 2.12.4.

### Fixed

- Picking a preset for a loaded profile changes only its name, server and
  addresses. Wi-Fi names, domains and the other rules stay.
- A name you typed stays when you pick a preset. A name that is still the one
  from the file is replaced by the preset's name.
- The Declarative tag on a card says the format is for iOS 26 and macOS 26 and
  later. It said 27.

### Security

- Calls from the page into the app pass Tauri's isolation pattern first. Only
  the app's own commands, with the expected arguments and within size limits,
  get through. The checks in Rust still decide. The pattern encrypts these calls
  with AES-GCM, which adds a few dependencies.
- The app loads only the `default` and `settings` capabilities, listed in
  `tauri.conf.json`.
- `cargo audit` on 2026-10-16 found no vulnerabilities in the app's
  dependencies. Two advisories for Tauri's Linux menus (RUSTSEC-2024-0429,
  RUSTSEC-2024-0370) are ignored, since they aren't built into the macOS app.

## [4.0.0-rc.2] - 2026-10-10

The second release candidate of the desktop app, for testing before 4.0.0. Most
of it is security: the app checks what it opens before loading or signing it,
refuses files that aren't plain or signed profiles, and keeps its own files
private. Cards are now cleared when you quit, and keeping them is an opt-in in
Settings. It also adds a way to compare two cards. It comes without a DMG: build
it from the `v4.0.0-rc.2` tag with `deno task desktop`, as the README describes.

### Added

#### Profile page

- Compare two cards side by side. Pick Compare on two cards: rows that differ
  get a marker, and the footer counts them. Close or Escape brings the list
  back.
- Cards show where they came from: the file name, with "edited" once you change
  the card. After a download they show the name it was saved under.
- Cards show the profile paradigm (Legacy or Declarative), and the interfaces,
  rules and features you picked, under the same names as the form.
- With several configurations in the profile, a note says your device uses one
  at a time, and where to pick it on the iPhone.
- Drop a font profile on the Profile page and the app checks it: one TrueType or
  OpenType font per payload, no collections, no web fonts. It shows the file,
  the number of fonts and a short hash, and signs and saves it with your
  Keychain certificate.

#### Privacy

- Settings has a Privacy section with "Forget cards when quitting". It's on
  unless you turn it off: cards and the signing choice are gone after you quit,
  and theme, motion and window size stay. A change applies from the next start.
- A neutral file name switch in the Download panel saves as
  `encrypted-dns.mobileconfig`, so the name doesn't show the provider.

### Changed

- Profiles are named after their configuration: "DNS Bunker" saves as
  `dns-bunker.mobileconfig`. With several configurations, or with the neutral
  switch on, it stays `encrypted-dns.mobileconfig`.
- Breaking: cards are forgotten when you quit. This includes cards kept from
  4.0.0-rc.1, which are gone after the first start. To keep cards, turn off
  "Forget cards when quitting" in Settings > Privacy.
- Breaking: numbered copies use a hyphen, `encrypted-dns-2.mobileconfig` instead
  of `encrypted-dns 2.mobileconfig`. Anything that looks for the old names in
  Downloads needs updating.
- Cards with the same settings from different files are written into the profile
  once.
- A configuration with no interface switched on can't be added anymore.
- Card rows have a fixed order, and each Wi-Fi name is on its own line.
- The numbers in front of resolver addresses are filled green or red, the picker
  labels are bold, and the server button turns green once the server is usable.
- The app icon is the mascot now, light in light mode and dark in dark mode.
  Before macOS 26 it shows the light one.
- The Settings window is taller, to fit the Privacy section.

### Fixed

- Loading a file that's already in the profile no longer shows its import notes
  again.
- Picking a preset without resolver addresses, like HaGeZi, closes the Resolver
  addresses section and shows "None".

### Security

- A signed profile dropped on the window or picked with Load gets the same
  signature check as one opened from Finder. If it was changed after signing,
  even by adding something in front, the app asks before loading it. A file
  that's neither a plain nor a signed profile is refused. On the website, a note
  says it can't check the signature.
- The app only saves, shares and signs DNS profiles with exactly the keys and
  values it writes itself. Extra keys, profiles that can't be removed and other
  payload types are refused.
- Files over 5 MB are refused before they're read, and so are profiles nested
  more than 64 levels deep, with a plain message instead of a technical error.
- The app's own files are readable only by you, its folders included, the web
  view's data among them.

## [4.0.0-rc.1] - 2026-10-03

The first release candidate of the desktop app, for testing before 4.0.0. It
comes without a DMG: build it from the `v4.0.0-rc.1` tag with
`deno task desktop`, as the README describes.

### Added

#### Opening profiles

- Open profiles with the app: File > Open Profile… (⌘O), Open With in Finder
  (enables Airdrop auto open), or drop them on the Dock icon. Several at once
  work too. Double-clicking a profile still installs it through System Settings.
- Drop a `.mobileconfig` onto the window to load it.
- Configurations loaded from a file go straight into the profile.

#### Building a configuration

- A Presets menu next to the name, with Quad9, HaGeZi, njal.la, DNS.SB, FlokiNET
  and DNS Bunker. Each shows the flag of the country it runs in, or a globe if
  it runs worldwide, its server with DoH in front, and what it offers: no logs,
  DNSSEC, ad blocking, malware blocking. Picking a preset fills in the resolver
  addresses the provider publishes. A name you typed yourself stays.
- Pick DoH or DoT with the button at the end of the server field. The label and
  the example follow your choice, and the button shows a green check once the
  server is usable. With DoT, a note says it's easier to detect and block, while
  DoH blends in with normal HTTPS.
- Remove a resolver address with the × in its field, or swap the two with the
  button between them. Removing the first moves the second up. The fields are
  numbered 1 and 2, and profile cards list the addresses the same way, one per
  line: "IPv4 1", "IPv6 2" and so on.
- Quick insert buttons add `https://` and `/dns-query` to a DoH URL.
- Paste a DoT server as `tls://dns.example.com` and only the host name stays,
  which is what the profile needs.
- Pick which connections use encrypted DNS: Wi-Fi, cellular and Ethernet. With
  all three off, a warning says encrypted DNS never turns on.
- "Use encrypted DNS only for" sends only the domains you list through encrypted
  DNS, and "Failover" uses the network's own DNS when the encrypted server
  fails.
- Closed sections show what's in them, like "2 addresses" or "Defaults", so you
  don't have to open them to check.
- Escape puts a text field back to what it held when you clicked into it. ⌘Z
  brings your edit back.

#### Declaration format

- Declaration format, in beta: a switch in the Download panel, under "Use system
  scope". It writes Apple's new DNS declaration instead of the classic payload.
  Only iOS 27, macOS 27 and later can install these profiles. While it's on,
  system scope stays on, since the declaration needs it. The description you see
  when installing one says "iOS/macOS 27".
- Profiles in the declaration format load like any other, on both pages.
  Declarations that aren't DNS settings are listed in the notes.
- Loading a classic profile says that Apple deprecated its format. Its cards get
  a yellow Deprecated tag, and the Declaration format switch says some
  configurations came from the old format. Downloading in the declaration format
  clears both. Editing a card doesn't.

#### Profile page

- Right-click a profile card to edit or delete it. Select some text on the card
  first and you get the usual menu with Copy instead.
- The Profile tab shows how many configurations the profile holds in a blue
  badge, and a footer under the list has the count and Delete all.

#### Saving, sharing and signing

- ⌘S does what the page's main button does: Add to Profile or Save Changes on
  the Tool page, Download on the Profile page. It's grayed out when there's
  nothing to save.
- Download profile saves straight to your Downloads folder and never replaces an
  existing file. A second copy becomes `encrypted-dns 2.mobileconfig`.
- After saving, the app offers to open the profile, which takes you to System
  Settings to install it.
- Share sits next to Download and opens the macOS share menu: AirDrop, Mail,
  Messages and the rest. AirDrop a profile to an iPhone and it lands in
  Settings, ready to install. File > Share… does the same, and stays grayed out
  until the Profile page has something to share.
- Sign profiles with a certificate from your Keychain, offline. Pick the
  certificate in the Download panel and the app signs the profile itself, with
  macOS's Security framework. The private key never leaves the Keychain. Shared
  profiles get signed too.
- Signed profiles show as "Verified" on devices that trust the certificate's
  issuer. Expired and not yet valid certificates aren't offered, untrusted ones
  are marked, and every signed file is checked before it's saved.
- The app only saves, shares and signs profiles that hold DNS settings and
  nothing else.
- Opening a signed profile with File > Open Profile…, from Finder or on the Dock
  icon checks its signature. If the profile was changed after signing, or the
  signature is damaged, the app warns and asks before loading it.

#### Settings

- Settings (⌘,) has the theme as three small pictures of the app: System, Light
  and Dark. The title bar, menus and dialogs follow your choice, and View >
  Appearance still works too.
- Motion: System, Reduced or Full. System follows Reduce motion in the macOS
  Accessibility settings. Reduced holds every animation in the app still.
- The version sits at the bottom of Settings, with a code icon in front, and
  opens the release notes for that version on GitHub. Screen readers hear that
  it opens in a new tab.
- Changes apply right away, in every window.

#### The app

- A mascot sits next to the name. It floats a little and turns toward the field
  you're in.
- A small easter egg, just in time for Halloween.
- Switch pages from the keyboard: ⌘1 for Tool, ⌘2 for Profile. Both are in the
  View menu too, with a checkmark on the page you're on, and they work while
  you're typing in a field.
- A full menu bar with File, Edit, View, Window and Help. Help links to the
  release notes and the source code on GitHub.
- The app remembers your configurations, settings, signing choice and the window
  size between launches.
- The app icon follows light and dark mode on macOS 26 and later.
- The About window shows the version and the copyright, which names the license.
- The app needs macOS 15.8 or later.

### Changed

#### Resolver addresses and server checks

- Resolver addresses now have two fields for IPv4 and two for IPv6, tried in
  that order. The section starts collapsed, since the addresses are optional,
  and the hint under it just says "Tried in order, IPv4 first."
- Breaking: loading a profile with more than two IPv4 or two IPv6 addresses
  drops the extra ones. A notice lists what was left out.
- The DoH URL check follows RFC 8484 more closely. It now catches URLs like
  `https:/dns.example.com`, or ones with a `dns=` parameter of their own, which
  the old check let into the profile exactly as typed.
- Breaking: a loaded profile or saved configuration with such a URL is marked on
  the Profile page now, and Download waits until you fix it.

#### Form and Profile page

- Advanced is now "Behavior & rules", with one row each for Wi-Fi exceptions,
  Domains, Interfaces, Failover and Lock profile. The labels say what happens:
  "Skip encrypted DNS on" for Wi-Fi networks, "Skip encrypted DNS for" and "Use
  encrypted DNS only for" for domains.
- Profile cards show the same flags as the options you picked, under the same
  names as the form.
- Wi-Fi network and domain rows on profile cards are in the monospace font, like
  the fields you type them into. The Wi-Fi row is labeled "Skip for SSID".
- The description you see when installing a profile is short now: "DNS Profile
  Creator (.mobileconfig) iOS/macOS 26". It used to be a full sentence with a
  link to GitHub.
- In windows narrower than 768px, the upload zone shrinks to one compact row, so
  the form gets more room.
- "DNS over HTTPS" and "DNS over TLS" are written without hyphens.

#### Look and readability

- The header leads with the tool's name, with a blue bar beside it and the
  encrypted DNS protocols as a smaller line under it. The "Secure iPhone, iPad,
  Mac." line is gone.
- Text is set in Söhne, and server addresses in Lilex.
- New colors. All text now meets the WCAG contrast minimum: links, buttons,
  errors and warnings were too faint in the light theme. The dark theme uses a
  light sky blue for selected tabs, options and presets.
- Text fields and the certificate list have their own background, so they stand
  out from the panels around them.
- Add to profile, Download and Share have icons.

#### The app window

- The title bar is part of the page, in its color and without a title. The Tool
  and Profile tabs sit in the middle of it. A thin line shows under it once the
  page scrolls beneath.
- The window can't get narrower than 720 pixels, so the title bar and the form
  keep their layout.
- The page stays put when you swipe on the trackpad and everything already fits
  in the window.
- A button in a window that's in the background works on the first click,
  instead of that click only bringing the window forward.
- Confirmations and alerts are native macOS dialogs.
- The app is under 10 MB. Its pages load from inside the app instead of from a
  local server, so nothing listens on the network.
- The app is licensed under the BSD 3-Clause License. The parts based on the
  original dns-mobileconfig stay under MIT.

### Deprecated

- Apple deprecated the classic DNS payload (`com.apple.dnsSettings.managed`) in
  iOS 27, macOS 27 and visionOS 27. Profiles that use it still install and work
  there. The app still writes it by default, since only iOS 27 and macOS 27 can
  read the declaration format.

### Fixed

#### Typing and undo

- Autocorrect no longer changes Wi-Fi names or IPv4 addresses, and macOS no
  longer suggests words in the server, address and domain fields. A corrected
  network name meant the Wi-Fi exception never matched.
- ⌘Z now undoes what the form changes for you: the quick inserts, the dot that
  replaces a comma in an IPv4 field, and the `tls://` taken off a DoT server.
  Before, ⌘Z skipped these and could lose earlier steps too.

#### Display and screen readers

- Icons no longer flicker when switching between Tool and Profile.
- Reloading no longer shows "No config yet", the list, the Download panel or the
  Profile tab's count a moment late.
- The delete button on profile cards and the arrows next to Resolver addresses
  and Behavior & rules look the same on every system. Both were font characters
  that changed size and shape depending on the installed fonts.
- Headings on both pages go in order now, panels first and then the profile
  cards, so screen readers can jump between them.

### Security

- The app's pages can only call the app's own commands, nothing else in the app
  or its plugins. A content security policy blocks scripts and styles from
  anywhere but the app, and links can't load other websites into the window. The
  Settings window can only ask the app to change the theme, so it can't save,
  sign or share.

[4.0.0-rc.3]: https://github.com/tofulupo/apple-dns-profile-creator/compare/v4.0.0-rc.2...v4.0.0-rc.3
[4.0.0-rc.2]: https://github.com/tofulupo/apple-dns-profile-creator/compare/v4.0.0-rc.1...v4.0.0-rc.2
[4.0.0-rc.1]: https://github.com/tofulupo/apple-dns-profile-creator/compare/deno-desktop...v4.0.0-rc.1
