-- Batch C3.3 (#1, 1b): Rotating home banners (1-5) and home editor settings (sections order/visibility/headings & philosophy).

CREATE TABLE home_banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desktop_image TEXT NOT NULL,
  mobile_image TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '' CHECK (length(heading) <= 160),
  button_text TEXT NOT NULL DEFAULT '' CHECK (length(button_text) <= 60),
  link_href TEXT NOT NULL DEFAULT '/products' CHECK (length(link_href) <= 300),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE home_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sections_json TEXT NOT NULL,
  philosophy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
