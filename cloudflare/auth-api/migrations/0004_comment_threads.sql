-- Admin grants are operator-managed; clients cannot grant roles.
CREATE TABLE community_moderators (
  username TEXT PRIMARY KEY COLLATE NOCASE REFERENCES accounts(username) ON DELETE CASCADE
);
ALTER TABLE comments ADD COLUMN root_id INTEGER REFERENCES comments(id);
ALTER TABLE comments ADD COLUMN reply_to_id INTEGER REFERENCES comments(id);
ALTER TABLE comments ADD COLUMN deleted_at INTEGER;
CREATE INDEX comments_thread_order ON comments(root_id, created_at, id);
-- Keep tombstones so deleting a message never deletes other players' replies
-- or resets the existing shared hourly posting lock.
CREATE TRIGGER comments_reply_scope BEFORE INSERT ON comments
WHEN NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM comments target JOIN comments root ON root.id = COALESCE(target.root_id, target.id)
  WHERE target.id = NEW.reply_to_id AND target.feature_id = NEW.feature_id
    AND root.feature_id = NEW.feature_id AND root.id = NEW.root_id
    AND target.deleted_at IS NULL AND root.deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'COMMENT_TARGET_UNAVAILABLE');
END;
