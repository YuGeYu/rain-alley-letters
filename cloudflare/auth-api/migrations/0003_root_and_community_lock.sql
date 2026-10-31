-- Roles can only be granted by the operator, never through registration.
ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'root'));
CREATE UNIQUE INDEX accounts_single_root ON accounts(role) WHERE role = 'root';
CREATE INDEX comments_account_created ON comments(username, created_at DESC);
-- A trigger makes checking and inserting atomic, including concurrent requests.
CREATE TRIGGER community_hour_lock BEFORE INSERT ON comments
WHEN (SELECT role FROM accounts WHERE username = NEW.username) != 'root'
AND EXISTS (SELECT 1 FROM comments WHERE username = NEW.username AND created_at > NEW.created_at - 3600)
BEGIN
  SELECT RAISE(ABORT, 'COMMUNITY_HOUR_LOCK');
END;
