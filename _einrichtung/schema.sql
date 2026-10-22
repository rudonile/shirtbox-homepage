CREATE TABLE IF NOT EXISTS image_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  visitor TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS image_requests_day_visitor ON image_requests(day, visitor);
CREATE INDEX IF NOT EXISTS image_requests_month ON image_requests(month);
