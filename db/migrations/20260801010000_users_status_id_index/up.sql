-- Admin user list: WHERE status = ? ORDER BY id (covers status filter + id sort)
ALTER TABLE users ADD INDEX idx_users_status_id (status, id);
