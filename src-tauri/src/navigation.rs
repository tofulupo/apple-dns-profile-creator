use tauri::{AppHandle, Url};

#[derive(Debug, PartialEq, Eq)]
enum Destination {
    App,
    Elsewhere,
    Nowhere,
}

fn destination(url: &Url, dev_url: Option<&Url>) -> Destination {
    if dev_url.is_some_and(|dev| dev.origin() == url.origin()) {
        return Destination::App;
    }
    match url.scheme() {
        // How Tauri serves dist/: tauri://localhost, http://tauri.localhost on Windows.
        "tauri" => Destination::App,
        "http" | "https" if url.host_str() == Some("tauri.localhost") => Destination::App,
        "http" | "https" | "mailto" | "tel" => Destination::Elsewhere,
        _ => Destination::Nowhere,
    }
}

fn dev_url(app: &AppHandle) -> Option<&Url> {
    if tauri::is_dev() {
        app.config().build.dev_url.as_ref()
    } else {
        None
    }
}

pub fn allow(app: &AppHandle, url: &Url) -> bool {
    match destination(url, dev_url(app)) {
        Destination::App => {
            crate::menu::show_page(app, url);
            true
        }
        Destination::Elsewhere => {
            crate::menu::open_url(app, url.as_str());
            false
        }
        Destination::Nowhere => false,
    }
}

pub fn open_outside(app: &AppHandle, url: &Url) {
    if destination(url, dev_url(app)) == Destination::Elsewhere {
        crate::menu::open_url(app, url.as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to(url: &str) -> Destination {
        destination(&Url::parse(url).unwrap(), None)
    }

    fn in_dev(url: &str) -> Destination {
        let dev = Url::parse("http://localhost:1430/").unwrap();
        destination(&Url::parse(url).unwrap(), Some(&dev))
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

        assert_eq!(
            to("https://tauri.localhost.example.com/"),
            Destination::Elsewhere
        );
    }

    #[test]
    fn stays_on_the_dev_servers_pages_in_development_only() {
        assert_eq!(in_dev("http://localhost:1430/"), Destination::App);
        assert_eq!(
            in_dev("http://localhost:1430/finalize.html"),
            Destination::App
        );
        assert_eq!(in_dev("http://localhost:1431/"), Destination::Elsewhere);
        assert_eq!(to("http://localhost:1430/"), Destination::Elsewhere);
    }

    #[test]
    fn opens_nothing_else() {
        assert_eq!(to("file:///etc/hosts"), Destination::Nowhere);
        assert_eq!(to("about:blank"), Destination::Nowhere);
        assert_eq!(to("javascript:alert(1)"), Destination::Nowhere);
    }
}
