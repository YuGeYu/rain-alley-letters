CREATE TABLE account_status (
  username TEXT PRIMARY KEY COLLATE NOCASE REFERENCES accounts(username) ON DELETE CASCADE,
  muted_until INTEGER NOT NULL DEFAULT 0,
  mute_reason TEXT NOT NULL DEFAULT '',
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  last_login_at INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE management_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL,
  detail TEXT NOT NULL, created_at INTEGER NOT NULL
);
-- Keep other people's replies when their thread author deletes their account.
-- This reserved identity cannot log in or be registered through the API.
INSERT INTO accounts(username,password_salt,password_hash,password_iterations,created_at,role)
VALUES ('__deleted__',lower(hex(randomblob(16))),lower(hex(randomblob(32))),100000,0,'player');
CREATE TRIGGER community_mute BEFORE INSERT ON comments
WHEN EXISTS(SELECT 1 FROM account_status WHERE username=NEW.username AND (disabled=1 OR muted_until>NEW.created_at))
BEGIN SELECT RAISE(ABORT,'COMMUNITY_MUTED'); END;
