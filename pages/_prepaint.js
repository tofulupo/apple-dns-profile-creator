{
  document.documentElement.dataset.js = "";
  if ("__TAURI__" in window) document.documentElement.dataset.app = "desktop";
  // The website keeps its data in the tab unless the user keeps it (KEEP_KEY in
  // src/ui/storage.ts); one of the two holds it. The app uses localStorage.
  const stored = (key) => {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  // Key and value must match src/ui/pixel.ts.
  try {
    if (sessionStorage.getItem("dns-mobileconfig:pixel") === "on") {
      document.documentElement.dataset.pixel = "";
    }
  } catch {
    // No storage: no pixel font.
  }
  // Key and values must match src/ui/settings.ts.
  {
    let motion;
    try {
      motion = JSON.parse(stored("dns-mobileconfig:settings:v1") ?? "null")
        ?.motion;
    } catch {
      // Bad JSON: follow the system.
    }
    if (
      motion === "reduce" ||
      (motion !== "full" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      document.documentElement.dataset.motion = "reduce";
    }
  }
  // Key and values must match src/ui/storage.ts and theme.ts.
  {
    const theme = stored("dns-mobileconfig:theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  }
}
