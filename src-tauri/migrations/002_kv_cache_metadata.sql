ALTER TABLE kv_store ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kv_store ADD COLUMN size INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_kv_store_cache_lru ON kv_store(updated_at);
