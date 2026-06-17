@echo off
chcp 65001 >nul
echo ==================== 部署脚本 ====================
echo.
echo 1. 拉取代码
ssh -p 2222 openclaw@192.168.110.22 "cd /home/openclaw/apps/server && git pull origin master"
echo.
echo 2. 查看日志
ssh -p 2222 openclaw@192.168.110.22 "cd /home/openclaw/apps/server && pm2 logs exam-system --lines 20 --nostream"
echo.
echo 3. 查看服务状态
ssh -p 2222 openclaw@192.168.110.22 "pm2 list"
echo.
pause
