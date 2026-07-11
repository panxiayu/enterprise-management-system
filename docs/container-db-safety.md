# 容器数据库安全说明

## 当前结论

当前在线容器 `exam-system-api` 的数据库挂载方式已经是正确的：

- `/home/openclaw/apps/server/data/exam.db` 绑定到 `/app/data/exam.db`

风险点不在当前容器，而在于以后如果使用错误的 `docker-compose` / `docker run` 重建，可能重新挂回错误的数据来源。

## 已做修复

1. `docker-compose.yml`
   - 改为 bind mount：
   - `./data/exam.db:/app/data/exam.db`
   - 不再使用 `exam_data` volume

2. 新增脚本
   - `scripts/backup-live-db.sh`
   - `scripts/restore-db.sh`
   - `scripts/recreate-container-safe.sh`

## 推荐操作顺序

### 只备份数据库

```bash
bash /home/openclaw/apps/server/scripts/backup-live-db.sh
```

默认行为：

1. 先计算当前 `exam.db + wal + shm` 的源指纹
2. 与上次成功备份比较
3. 有变化才生成新备份
4. 没变化就直接跳过

### 强制备份一次

```bash
FORCE_BACKUP=1 bash /home/openclaw/apps/server/scripts/backup-live-db.sh
```

### 从备份恢复数据库

```bash
bash /home/openclaw/apps/server/scripts/restore-db.sh /home/openclaw/apps/server/data/backups/db/20260629-120000
docker restart exam-system-api
```

### 安全重建容器

```bash
bash /home/openclaw/apps/server/scripts/recreate-container-safe.sh
```

这个脚本会：

1. 先在线备份数据库
2. 再删除旧容器
3. 用 bind mount 重新创建容器
4. 出现异常时可直接按输出路径恢复

## 备份文件位置

```text
/home/openclaw/apps/server/data/backups/db/
```

每次备份一个时间目录，包含：

- `exam.db`
- `exam.db-wal`（如果存在）
- `exam.db-shm`（如果存在）
- `meta.txt`
