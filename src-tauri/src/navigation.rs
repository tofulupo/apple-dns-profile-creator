//! Keeps the window on the app's own pages. Links to anything else (the
//! header's version badge, which links to GitHub, or a ⌘-clicked or
//! dragged-in link) open in the default browser, or the app for their scheme,
//! instead of replacing the app's page.

use tauri::{AppHandle, Url};

#[derive(Debug, PartialEq, Eq)]
enum Destination {
    /// One of the app's pages, from dist/.
    App,
    /// Somewhere a browser or mail app should open.
    Elsewhere,
    /// Nowhere worth opening, such as a `file:` URL.
    Nowhere,
}

fn destination(url: &Url) -> Destination {
    match url.scheme() {
        // How Tauri serves dist/: tauri://localhost on macOS and Linux,
        // http://tauri.localhost on Windows.
        "tauri" => Destination::App,
        "http" | "https" if url.host_str() == Some("tauri.localhost") => Destination::App,
        "http" | "https" | "mailto" | "tel" => Destination::Elsewhere,
        _ => Destination::Nowhere,
    }
}

/// For `on_navigation`: whether the window may go to `url`. Anywhere else is
/// opened outside the app instead.
pub fn allow(app: &AppHandle, url: &Url) -> bool {
    match destination(url) {
        Destination::App => true,
        Destination::Elsewhere => {
            crate::menu::open_url(app, url.as_str());
            false
        }
        Destination::Nowhere => false,
    }
}

/// For `on_new_window` (a `target="_blank"` link): the app has one window, so
/// only links that lead elsewhere open, outside the app.
pub fn open_outside(app: &AppHandle, url: &Url) {
    if destination(url) == Destination::Elsewhere {
        crate::menu::open_url(app, url.as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to(url: &str) -> Destination {
        destination(&Url::parse(url).unwrap())
    }

    #[test]
    fn stays_on_the_apps_own_pages() {
        assert_eq!(to("tauri://localhost/"), Destination::App);
        assert_eq!(to("tauri://localhost/finalize.html"), Destination::App);
        assert_eq!(to("http://tauri.localhost/finalize.html"), Destination::App);
    }

    #[test]
    fn sends_web_and_mail_links_elsewhere() {
        assert_eq!(
            to("https://github.com/tofulupo/apple-dns-profile-creator"),
            Destination::Elsewhere
        );
        assert_eq!(to("http://example.com/"), Destination::Elsewhere);
        assert_eq!(to("mailto:someone@example.com"), Destination::Elsewhere);
        // Only the exact host is the app's.
        assert_eq!(
            to("https://tauri.localhost.example.com/"),
            Destination::Elsewhere
        );
    }

    #[test]
    fn opens_nothing_else() {
        assert_eq!(to("file:///etc/hosts"), Destination::Nowhere);
        assert_eq!(to("about:blank"), Destination::Nowhere);
        assert_eq!(to("javascript:alert(1)"), Destination::Nowhere);
    }
}
