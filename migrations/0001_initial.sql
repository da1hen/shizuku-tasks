CREATE TABLE tasks (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, id)
);
CREATE INDEX tasks_by_owner_date ON tasks (owner, created_at DESC);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_expiration ON sessions (expires_at);

CREATE TABLE ai_limits (
  owner TEXT PRIMARY KEY NOT NULL,
  next_at INTEGER NOT NULL
);
