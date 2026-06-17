-- 为 users 表添加管理员字段（如果不存在）
-- 运行：sqlite3 data/exam.db < add_admin_fields.sql

-- 添加 username 字段
ALTER TABLE users ADD COLUMN username TEXT UNIQUE;

-- 添加 password 字段（存储 hash）
ALTER TABLE users ADD COLUMN password TEXT;

-- 创建管理员账户（密码：-admin123，实际应使用 bcrypt hash）
-- 这里为了简化，先插入一个占位记录。实际应通过注册或迁移创建
INSERT OR IGNORE INTO users (openid, nickname, role, username, password) 
VALUES ('admin_openid', '系统管理员', 'admin', 'admin', '$2a$10$YourBcryptHashHere');
