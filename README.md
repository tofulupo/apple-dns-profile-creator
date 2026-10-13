# Apple DNS Profile Creator

[![check](https://github.com/tofulupo/apple-dns-profile-creator/actions/workflows/check.yml/badge.svg)](https://github.com/tofulupo/apple-dns-profile-creator/actions/workflows/check.yml)
[![offline: tested](https://img.shields.io/badge/offline-tested-brightgreen)](test/invariants/)
[![last commit](https://img.shields.io/github/last-commit/tofulupo/apple-dns-profile-creator)](https://github.com/tofulupo/apple-dns-profile-creator/commits/main)

[![release](https://img.shields.io/github/v/release/tofulupo/apple-dns-profile-creator?include_prereleases&sort=semver)](https://github.com/tofulupo/apple-dns-profile-creator/releases)
[![macOS 15.8+](https://img.shields.io/badge/macOS-15.8%2B-blue)](#desktop-app)

[![Donate using Liberapay](https://liberapay.com/assets/widgets/donate.svg)](https://liberapay.com/tofulupo/donate)

Builds encrypted DNS (DoH and DoT) profiles for iPhone, iPad and Mac, and opens,
compares and signs the ones you already have. It is a website and a macOS app.
Nothing is uploaded, and there are no accounts.

**[Try it out](https://mobileconfig.io)**: no install, no sign-up, nothing
leaves your device ([privacy](#privacy)).

Apple has supported DNS over HTTPS and DNS over TLS since iOS 14 and macOS 11,
but has no screen for it. A configuration profile turns it on without an extra
app, and this tool builds those profiles.

![The mascot peeking over a window that says: Your device. Your profile. Your rules.](docs/mascot-banner.png)

## What it does

- Start from one of six presets, or enter any DoH URL or DoT host with up to two
  IPv4 and two IPv6 addresses. Your own resolver works too. The presets show the
  country a provider runs in and what it says about logs, DNSSEC and blocking.
- Turn encrypted DNS off for named Wi-Fi networks or domains, or use it only for
  named domains
  ([details](#skip-encrypted-dns-for-vs-use-encrypted-dns-only-for)).
- Pick Wi-Fi, cellular and Ethernet one by one. With Failover on, the device
  falls back to the network's own DNS when the encrypted server doesn't answer
  (OS 26 and later).
- Put several configurations in one profile. The device uses one at a time
  ([details](#several-configurations-in-one-profile)).
- Open a profile you already have, signed or not, and see what is in it. Pick
  another resolver for it and keep its rules. Compare two cards side by side.
- Desktop app only: sign with a certificate from your Keychain, and send a
  profile to an iPhone with AirDrop from the Share button.

![The presets menu on the tool page](docs/screenshots/tool_presets.png)

![Two cards compared, showing only what differs](docs/screenshots/compare.png)

## Who it's for

**Setting it up for yourself or for someone else.** Pick a preset, leave the
rest alone, download. The app has no account and doesn't need an internet
connection. Installing is the part that takes a few taps on the device, see
[Installing and removing](#installing-and-removing).

**A household with its own resolver.** Enter your DoH URL or DoT host and add
your home network under Wi-Fi exceptions. Devices then use the network's DNS at
home and encrypted DNS everywhere else. Leave the exceptions empty to use
encrypted DNS everywhere. Save one profile per phone and AirDrop each one.

**Looking after a few Macs.** Drop in a colleague's profile to read its settings
without installing it. A signed profile that was changed after signing gets a
warning before it loads. Output is the same every time for the same input, and
CI checks every generated profile against golden files and, on macOS, against
Apple's `plutil -lint`.

**Working with a serious threat model.** The app makes no network requests,
opens no port, and has no telemetry, crash reporting or update check. Tests in
[`test/invariants/`](test/invariants/) fail if that changes. The signing key
stays in the Keychain. Cards are forgotten when you quit unless you turn that
off in Settings. Every feature works from a source checkout, so you can
[build the app yourself](#build-it-yourself).

## What a profile can't do

- It changes where DNS lookups go and how they travel. It doesn't hide your IP
  address, protect a device that is already compromised, or stop someone from
  watching which servers you connect to.
- Some apps and tools don't use the system's DNS settings. Reported examples are
  VPN clients, iCloud Private Relay, the App Store and command line tools like
  `dig`. Captive portals on hotel and airport Wi-Fi are exempt too. See the
  [known issues](https://github.com/paulmillr/encrypted-dns#known-issues) of
  paulmillr's profiles.
- The app blocks nothing. If a resolver filters ads or malware, that is the
  resolver's doing.
- DoT is easier to detect and block than DoH.
- A signature shows whether a file changed after it was signed. It doesn't show
  who made it. Devices label a signed profile "Verified" only if they trust the
  certificate's issuer, and a self-signed certificate shows "Not Verified".
- Lock profile only does something on supervised devices.
- A device in Lockdown Mode won't install a profile. Per
  [Apple](https://support.apple.com/en-us/105120), turn Lockdown Mode off,
  install, and turn it on again.
- There is no command line tool, no MDM deployment and no Windows or Linux app.
  The website opens in any browser, but only Apple devices install the profiles.

## Installing and removing

The app doesn't install profiles. The device does, and asks first.

- iPhone or iPad: AirDrop the profile from the desktop app, or open the website
  in Safari and download. Then open Settings and tap Profile Downloaded, then
  Install. With several configurations, pick the one to use under Settings ›
  General › VPN & Device Management › DNS.
- Mac: Download profile saves to `~/Downloads` and offers to open the file,
  which hands it to System Settings.
- To remove a profile, remove it in the same place you installed it.

## Moving from Mullvad's DNS

Mullvad shuts down its public encrypted DNS on 2 November 2026, and its iOS and
macOS DoH profiles stop working then
([Mullvad's announcement](https://mullvad.net/en/blog/shutting-down-our-public-encrypted-dns-servers-and-sponsoring-quad9-instead)).
Mullvad points to Quad9.

If you installed Mullvad's profile as it came, Quad9's own profile replaces it.
This tool helps if you changed yours: Wi-Fi networks without encrypted DNS,
domain rules, interfaces or failover.

1. Drop your Mullvad profile on the Tool page. A note says when it stops.
2. Under Presets, pick Quad9 or another resolver, or enter a DoH URL. The name,
   server and addresses change, and your rules stay.
3. Save changes, then download on the Profile page.
4. Install the new profile, and remove the Mullvad one under Settings › General
   › VPN & Device Management.

What is different from Mullvad's profile:

- Mullvad signed its profile. The one from the website isn't signed, so the
  device shows "Not Signed" when installing. It works the same.
- The desktop app can sign it, but only with a signing certificate that has its
  private key in your Keychain
  ([Signing with the Keychain](#signing-with-the-keychain)). You can
  [make a self-signed one](#create-a-self-signed-signing-certificate); devices
  then show "Not Verified" unless they trust it.
- The new profile has its own ID, so the device keeps the old one until you
  remove it.
- The website can't check Mullvad's signature and says "Not checked". The
  desktop app checks it.

![The Mullvad note after loading a profile](docs/screenshots/mullvad_note.png)

## Get the app

The desktop app needs macOS 15.8 or newer and is about 6 MB. Build the app from
its tag, as described under [Build it yourself](#build-it-yourself).

### Desktop app

The app is built with [Tauri 2](https://tauri.app) and uses the system's own
webview. The pages load from inside the app; nothing listens on the network.

**Download profile** saves straight to `~/Downloads`, never over an existing
file (`encrypted-dns-2.mobileconfig` and so on), then offers to open it, which
hands it to System Settings for installation. The window remembers its size,
stored in `~/Library/Application Support/local.encrypted-dns.tool/`. The icon
follows light and dark mode on macOS 26 and later.

Only macOS is built for now: a `.mobileconfig` can only be installed on Apple
devices.

## Privacy

[![TLS 1.3](https://img.shields.io/badge/TLS-1.3-green)](https://www.ssllabs.com/ssltest/analyze.html?d=mobileconfig.io)
[![Mozilla Observatory](https://img.shields.io/mozilla-observatory/grade/mobileconfig.io?publish)](https://developer.mozilla.org/en-US/observatory/analyze?host=mobileconfig.io)
[![Security Headers](https://img.shields.io/badge/Security%20Headers-A%2B-brightgreen)](https://securityheaders.com/?q=mobileconfig.io&followRedirects=on)

The website at mobileconfig.io is a showcase. It builds the profile in your
browser and sends nothing back: no cookies, no analytics, no requests to other
sites. Your configurations stay in this tab and are deleted when you close it.
To keep them in the browser, open Privacy at the top of the page (in the bar at
the bottom on phones) and turn the switch off. The browser's cache and history
still show the visit. For zero traces, use a private window. The server only
hands out the site's files and keeps nothing.

It runs on its own server in Iceland. The server keeps no access log, answers
only GET and HEAD, and speaks TLS 1.3 only, with HTTP/3 and Encrypted Client
Hello. Like any server, it sees your IP address while it answers.
`deno task check:live` checks the headers, TLS, redirects and `security.txt`
from outside, so you don't have to take this on trust. If that matters to you,
run the tool yourself on your own machine or home network (see
[Build it yourself](#build-it-yourself)), or use the
[desktop app](#desktop-app), which needs no network to build, sign or save a
profile.

## Signing

Profiles from the website are **not** signed; the desktop app can sign them with
a Keychain certificate. An unsigned profile installs identically; iOS and macOS
just label it "Not Signed" during installation. Signing changes that label and
adds tamper protection, nothing else.

### Signing with the Keychain

In the desktop app the Download panel offers **Signed with Keychain**: pick a
certificate that has its private key in your Keychain, and the profile is saved
with `-signed` in its name, like `encrypted-dns-signed.mobileconfig` (see
[File names](#file-names)). The app signs it with macOS's Security framework,
and the key never leaves the Keychain. Expired and not yet valid certificates
are not listed. Opening a signed profile checks its signature, and the app asks
before loading one that was changed after signing.

![The Download panel in the desktop app, signing with a Keychain certificate](docs/screenshots/desktop_signed_profile.png)

Devices show a signed profile as "Verified" only if they trust the certificate's
issuer. A self-signed certificate shows as "Not Verified" unless it is installed
and trusted on each device.

### Create a self-signed signing certificate

- Open Keychain Access (in /Applications/Utilities/)
- In the menu bar: Keychain Access → Certificate Assistant → Create
  Certificate...
- Fill in:
  - Name: e.g. MDM Signing Cert (remember this, you'll use it as the signing
    identity)
  - Identity Type: Self-Signed Root
  - Certificate Type: Code Signing
  - Check "Let me override defaults" if you want to extend the validity period
    (default is ~1 year; 10 years is common for this)
- Click Continue through the prompts (you can skip entering an email address)
- When done, the certificate is created directly in your login keychain, no
  separate import needed

## Details

### Skip encrypted DNS for vs. use encrypted DNS only for

The **Domains** row under **Behavior & rules** has two fields that both take a
list of domains. They are opposites rather than duplicates, and neither blocks
anything: the domains they leave out go to the network's own DNS.

| Field                          | Effect                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| **Skip encrypted DNS for**     | A deny list. Encrypted DNS is used everywhere _except_ these domains. |
| **Use encrypted DNS only for** | An allow list. Encrypted DNS is used _only_ for these domains.        |

Leaving both empty - **the default** - sends every query through the encrypted
resolver, which is usually what you want.

> [!NOTE]
> "Use encrypted DNS only for" is for split DNS, where an internal resolver
> should answer for one zone and the network's own resolver for everything else.
> A single leading `*` is allowed, so `*.example.com` and `example.com` both
> match `mail.example.com`.

Under the hood they are different mechanisms: exclusions become `OnDemandRules`
that switch the resolver off, while the limit becomes `SupplementalMatchDomains`
inside `DNSSettings`. Setting both is legal but rarely useful.

### Several configurations in one profile

Each card on the profile page becomes its own DNS configuration in the
downloaded profile, in the order of the cards. Cards with identical settings are
written once.

On an iPhone the configurations show up under **Settings › General › VPN &
Device Management › DNS**, next to **Automatic**. iOS adds a number when two
have the same name, like "DNS Bunker" and "DNS Bunker 1". The phone uses one
configuration at a time: the one you pick, or Automatic. Tested on iOS 27.0.1
with the declaration format.

A picked configuration whose server doesn't answer stops every lookup, and the
phone doesn't switch to another one. Whether Automatic skips such a server
hasn't been tested yet, so don't count on it as a backup.

The **Failover** switch is something else: when the encrypted server fails, it
falls back to the network's own DNS, not to another configuration.

We haven't checked the Mac yet.

### File names

A profile with one configuration is named after it, in lowercase letters, digits
and hyphens: "DNS Bunker" downloads as `dns-bunker.mobileconfig`, signed as
`dns-bunker-signed.mobileconfig`. Accents are dropped and long names are cut at
40 characters. A profile with several configurations, or a name with no letters
or digits left, is `encrypted-dns.mobileconfig`.

The file name shows up in share sheets and folder listings, so it tells anyone
who sees the file which provider you use. **Neutral file name** in the Download
panel keeps `encrypted-dns.mobileconfig` for every profile.

## Build it yourself

Needs [Deno](https://deno.com) 2.9 or newer. The app also needs
[Rust](https://rustup.rs) 1.85 or newer and Xcode 26 or newer.

```sh
git clone https://github.com/tofulupo/apple-dns-profile-creator.git
cd apple-dns-profile-creator
git checkout v4.0.0-rc.3
deno task build      # the website, as static files in dist/
deno task desktop    # the macOS app
```

`dist/` works on any web server, over HTTP or HTTPS, with nothing server-side.
`deno task preview` serves it on your network at port 5173, so a phone can open
it. The app ends up in `src-tauri/target/release/bundle/macos/`.

Your build differs from the official one in two ways: without the licensed Söhne
fonts it uses a fallback font with the same metrics, and the app is signed ad
hoc, which is enough to run it on the Mac that built it.

To see which commit mobileconfig.io runs, read its
[`build.txt`](https://mobileconfig.io/build.txt), or let
`deno task check:live --commit <sha>` compare it with yours.

Working on the code: see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## History and thanks

This started as a fork of [fyr77/dns-mobileconfig][upstream] and has since been
substantially rewritten: the core was rebuilt as a tested TypeScript library,
cookies were replaced with `localStorage`, the external signing service was
removed.

- Paul Miller for [his article](https://paulmillr.com/posts/encrypted-dns/) and
  his [premade profiles](https://github.com/paulmillr/encrypted-dns), which the
  test suite uses as fixtures
- [Mullvad](https://github.com/mullvad/encrypted-dns-profiles) for their
  published profiles
- [Reicon](https://reicon.dev) for the server, shield, receipt, sun, moon,
  monitor, download, info and card-remove icons in `public/icons/` (MIT, see
  `public/icons/LICENSE-reicon.txt`)
- zest for the [git-repository icon][zest-icon] from Zest Interface Icons,
  redrawn as the source code icon on the version badge, in
  `public/icons/source-code.svg` (MIT, see `public/icons/LICENSE-zest.txt`)
- [flag-icons](https://github.com/lipis/flag-icons) for the country flags in the
  presets menu, in `flags/` (MIT, see `flags/LICENSE-flag-icons.txt`)

[upstream]: https://code.diluvian.cc/fyr77/dns-mobileconfig
[zest-icon]: https://www.svgrepo.com/svg/509965/git-repository

## Disclaimer

No warranty or liability is provided on the generated files. Use at your own
risk.
