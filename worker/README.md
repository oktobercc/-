# 页间集 · Cloudflare 后端

一个 Worker 干三件事：

| 能力 | 存哪儿 | 接口 |
| --- | --- | --- |
| 书目、选项、删除记录 | KV | `POST /api/sync` |
| 封面、附件文件 | R2 | `GET/PUT/DELETE /api/asset/<key>` |
| 晋江 / 起点 / 番茄的书籍信息 | 不存 | `POST /api/import` |

前端那边什么都不用改，只要在「关于我 → 云同步」里填上地址和口令。没填的时候整套云功能不启动，应用还是纯本地的。

---

## 一、部署（约十分钟，全部免费额度内）

需要 Node 18 以上，和一个 Cloudflare 账号。

```bash
cd worker
npm install
npx wrangler login          # 浏览器里点一下授权
```

**1. 建 KV（存书目）**

```bash
npx wrangler kv namespace create KV
# 旧版 wrangler 用：npx wrangler kv:namespace create KV
```

命令会输出一段 `id = "xxxxxxxx"`，把它填进 `wrangler.toml` 里 `[[kv_namespaces]]` 的 `id`。

**2. 建 R2 桶（存封面和附件）**

```bash
npx wrangler r2 bucket create yejianji-assets
```

桶名要和 `wrangler.toml` 里的 `bucket_name` 一致。

**3. 设访问口令**

```bash
npx wrangler secret put SYNC_TOKEN
# 然后输入你自己定的口令
```

口令**只能用英文、数字和符号**，别用中文 —— 它要放在 HTTP 请求头里，浏览器不允许非 ASCII 字符。建议随手生成一串，比如 `openssl rand -hex 16`。

**4. 部署**

```bash
npx wrangler deploy
```

成功后会打印地址，形如 `https://yejianji-sync.你的用户名.workers.dev`。浏览器打开 `地址/api/health`，看到 `{"ok":true,"kv":true,"r2":true}` 就算通了；`kv` 或 `r2` 是 false 说明第 1、2 步没绑上。

**5. 网页里连上**

打开页间集 →「关于我 → 云同步」→ 填地址和口令 → 保存并连接。第一台设备会把本地的书全推上去，第二台设备连上之后自动拉下来。

---

## 二、同步是怎么算的

- 每本书带一个 `updatedAt`（本地改动时间）。同一本书两边都改过，**改得晚的赢**，另一边下次同步时被覆盖。
- 删除会留一条「墓碑」记录，另一台设备同步时才知道该删。墓碑保留 120 天后自动清掉。
- 拉取用的游标是**服务端时间**，不是设备时间 —— 手机电脑的系统时钟差几分钟也不会漏同步。
- 封面和附件**不批量下载**：只有真正要显示封面、或点下载附件时才去 R2 取，取回来存在本地，下次不再请求。
- 本地断网时照常用，改动攒着，下次同步一起补传。

一句话：适合一个人多台设备。不适合多人同时编辑同一本书 —— 那种情况需要逐字段合并，这里没做。

---

## 三、抓取那三个站

`POST /api/import`，body 是 `{"url": "作品页链接"}`。解析分三层，逐层兜底：

1. 页面里的 `application/ld+json`
2. Open Graph / 普通 meta
3. 各站自己的 HTML 规律（写在 `src/scrape.js` 的 `RULES` 里）

返回值里的 `matchedBy` 会写明每个字段是从哪一层拿到的，`missing` 列出没抓到的字段，站点改版时照着这两个字段调 `RULES` 就行。

几个说明：

- **编码**：晋江是 GB2312。Worker 先严格按 UTF-8 试探一次，不通再按页面声明的编码解，所以声明错了也能自动纠正。万一运行时缺 GBK 解码表，返回里 `garbled` 会是 true，前端会自动改走 `/api/proxy` 拿原始字节，用浏览器自己的解码器再解一遍。
- **反爬**：这三个站会不会拦 Cloudflare 的出口 IP，得实际试了才知道。被拦时接口返回 502 并带上对方的状态码，能区分「被拦」和「解析不出来」。真被拦了，可以在 `fetchRaw` 里补 Cookie，或退回前端的「粘贴网页源码导入」。
- **白名单**：`/api/import`、`/api/proxy`、`/api/image` 只放行这三个站和它们的图床，别把这个 Worker 变成公开代理。

---

## 四、接口一览

除 `/api/health` 外都要带 `Authorization: Bearer <SYNC_TOKEN>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 探活，顺带告诉你 KV / R2 绑没绑上 |
| POST | `/api/sync` | 推本地改动，同时拉回云端改动 |
| GET | `/api/sync?since=<毫秒>` | 只拉不推 |
| GET | `/api/assets` | 云端已有的文件 key 列表 |
| PUT | `/api/asset/<key>` | 上传封面或附件（上限 90MB） |
| GET | `/api/asset/<key>` | 下载 |
| DELETE | `/api/asset/<key>` | 删除 |
| POST | `/api/import` | 抓一个作品页，返回解析好的书籍信息 |
| GET | `/api/proxy?url=` | 原样透传页面字节，编码写在 `X-Source-Charset` 头里 |
| GET | `/api/image?url=` | 转发图片，绕开图床的跨域限制 |

key 的命名：封面是 `cover/<书籍id>`，附件是 `asset/<assetId>`。

---

## 五、日常维护

```bash
npx wrangler tail                                  # 看实时日志
npx wrangler kv key get --binding=KV library       # 看云端书目原文
npx wrangler r2 object delete yejianji-assets/cover/123   # 手动删某个文件
```

**免费额度**（个人用远远够）：Workers 每天 10 万次请求；KV 每天 10 万次读、1000 次写；R2 存储 10GB、流量不额外收费。同步是按需触发的（改动后 2.5 秒、回到页面时、手动点击），不是定时轮询，正常一天几十次请求。

**两个已知的小毛病**：

- 删掉书之后，R2 里对应的封面和附件不会自动清，占一点空间。介意的话用上面的 `r2 object delete` 手动清，或者以后加个定期比对的清理脚本。
- `ALLOWED_ORIGIN` 默认是 `*`。接口本身要口令，安全性不靠它，但改成你自己的站点地址会更稳妥 —— 改 `wrangler.toml` 里的 `[vars]` 再 `deploy` 一次。
