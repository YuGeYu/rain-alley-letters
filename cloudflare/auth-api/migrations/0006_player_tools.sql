CREATE TABLE player_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE REFERENCES accounts(username) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 2000),
  html TEXT NOT NULL CHECK(length(CAST(html AS BLOB)) BETWEEN 1 AND 196608),
  backend TEXT NOT NULL DEFAULT '' CHECK(length(CAST(backend AS BLOB)) <= 98304),
  links_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX player_tools_owner ON player_tools(username);
CREATE TABLE player_tool_publishers (
  username TEXT PRIMARY KEY COLLATE NOCASE REFERENCES accounts(username) ON DELETE CASCADE,
  quota_key TEXT NOT NULL UNIQUE
);
