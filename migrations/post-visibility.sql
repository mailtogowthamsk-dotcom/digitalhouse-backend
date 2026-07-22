-- Post audience visibility (PUBLIC = Community, CONNECTIONS = Connections Only)
-- Applied via: npm run db:run-post-visibility-sql

ALTER TABLE posts
  ADD COLUMN visibility ENUM('PUBLIC', 'CONNECTIONS') NOT NULL DEFAULT 'PUBLIC'
  AFTER postType;

CREATE INDEX idx_posts_visibility ON posts (visibility);
CREATE INDEX idx_posts_visibility_userId ON posts (visibility, userId);
