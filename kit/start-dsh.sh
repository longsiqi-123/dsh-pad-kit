#!/data/data/com.termux/files/usr/bin/bash
export HOME=/data/data/com.termux/files/home
mkdir -p $HOME/dshpad
termux-wake-lock 2>/dev/null

echo "=== 停掉旧的 dsh 与旧入口 ==="
pkill -f 'dsh --profile web' 2>/dev/null
pkill -f dsh-home.js 2>/dev/null
sleep 2

echo "=== 启动 dsh web ==="
rm -f $HOME/dshpad/web.log $HOME/dshpad/url.txt
nohup dsh --profile web --host 127.0.0.1 --port 3080 --no-open > $HOME/dshpad/web.log 2>&1 &

URL=""
for i in $(seq 1 40); do
  URL=$(grep -o 'http://127.0.0.1:3080/?token=[A-Za-z0-9_-]*' $HOME/dshpad/web.log 2>/dev/null | tail -1)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "FAILED: 没有拿到 token URL"
  tail -20 $HOME/dshpad/web.log
  exit 1
fi
echo "$URL" > $HOME/dshpad/url.txt
echo "TOKEN_URL=$URL"

echo "=== 启动固定入口 3081 ==="
nohup node $HOME/dsh-home.js > $HOME/dshpad/home.log 2>&1 &
sleep 2
cat $HOME/dshpad/home.log

echo "=== 自检 ==="
curl -s -o /dev/null -w "home=%{http_code}\n" http://127.0.0.1:3081/
curl -s -o /dev/null -w "direct=%{http_code}\n" "http://127.0.0.1:3080/?token=$(echo "$URL" | sed 's/.*token=//')"
curl -sI http://127.0.0.1:3081/ | grep -i '^location' | head -1
echo "FIXED_URL=http://127.0.0.1:3081/"
