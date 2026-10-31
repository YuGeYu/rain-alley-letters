PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_nocase ON accounts(username COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_username_idx ON sessions(username);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id TEXT NOT NULL,
  username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS comments_feature_created_idx ON comments(feature_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_throttle (
  bucket_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_ends INTEGER NOT NULL
);
