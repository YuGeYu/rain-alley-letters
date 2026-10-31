PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  username TEXT PRIMARY KEY COLLATE NOCASE REFERENCES accounts(username) ON DELETE CASCADE,
  profile_json TEXT NOT NULL CHECK(length(profile_json) <= 26000),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS profiles_updated_at_idx ON profiles(updated_at DESC);
