# 页间集 · Cloudflare 后端

一个 Worker 干这几件事：

| 能力 | 存哪儿 | 接口 |
| --- | --- | --- |
| 用户账号、登录 | KV | `POST /api/auth/*` |
| 书目、选项、删除记录 | KV | `POST /api/sync` |
| 封面、附件文件 | R2 | `GET/PUT/DELETE /api/asset/<key>` |
| 百度网盘 / WebDAV 绑定与读写 | KV（凭据加密）| `/api/netdisk/*` |
| 晋江 / 起点 / 番茄的书籍信息 | 不存 | `POST /api/import` |

前端不登录时整套云功能不启动，应用还是纯本地的，照常能用。

**每个账号的数据是隔开的**：KV 走 `lib:<uid>`，R2 走 `u/<uid>/<key>`。升级前用单口令（`SYNC_TOKEN`）的部署仍然认那个口令，对应一个固定用户 `uid = legacy`，读写的还是原来那份数据 —— 所以**升级不会丢东西**，也不用做迁移。

---

## 零、两种部署方式，挑一种

**A. 整站已经在 Cloudflare Pages 上（推荐）**

仓库里的 `functions/api/[[path]].js` 会把这套后端挂到你自己的域名下，推代码就一起上线，前后端同源、没有跨域问题，也不用单独部署 Worker。

只需要在 Pages 后台配三样：

| 位置 | 配什么 |
| --- | --- |
| Settings → Functions → KV namespace bindings | 变量名 `KV`，绑一个新建的 KV namespace |
| Settings → Functions → R2 bucket bindings | 变量名 `R2`，绑一个新建的 R2 桶 |
| Settings → Environment variables | `AUTH_SECRET` = 一串随机字符串（选 Encrypt），`openssl rand -hex 32` 生成 |
| Settings → Environment variables | `ALLOW_REGISTER` = `false`，或者配一个 `INVITE_CODE`（选 Encrypt） |
| Settings → Environment variables（可选）| 接百度网盘才要：`BAIDU_APP_KEY`、`BAIDU_SECRET_KEY`（都选 Encrypt）、`BAIDU_APP_NAME` |

改完**要重新部署一次**才生效（Deployments → Retry deployment）。然后打开 `https://你的站点/api/health`，看到 `{"ok":true,"kv":true,"r2":true}` 就通了。网页「关于我 → 云同步」里**后端地址留空**即可，然后到「关于我 → 账号」注册一个账号。

**B. 单独部署成 Worker**

站点不在 Cloudflare、或者想把后端和前端分开时走这条，步骤见下面第一节。这种方式前后端不同源，需要把 `wrangler.toml` 里的 `ALLOWED_ORIGIN` 改成你站点的地址。

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

**3. 设签名密钥**

```bash
openssl rand -hex 32          # 生成一串，复制下来
npx wrangler secret put AUTH_SECRET
# 粘贴刚才那串
```

这串是用来签登录票、以及加密网盘凭据的，只在服务端用，不会出现在前端。

⚠️ **换掉 AUTH_SECRET 会让所有人被登出，网盘也要重新绑**（网盘 token 是用它派生的密钥加密后才落盘的，换了钥匙就解不开旧密文了）。

想关掉注册，或者设个邀请码：

```bash
# 二选一
npx wrangler secret put INVITE_CODE     # 留着注册功能，但要邀请码
# 或者把 wrangler.toml 里的 ALLOW_REGISTER 改成 "false"
```

自己一个人用的话，建议注册完自己的账号之后就把 `ALLOW_REGISTER` 改成 `"false"` 再部署一次 —— 你的地址一旦被人知道，开放注册就等于把 KV 和 R2 额度送出去。

**（可选）从老版本升级**：原来配过 `SYNC_TOKEN` 的不用动它，留着就行，老数据照常能读。

**4. 部署**

```bash
npx wrangler deploy
```

成功后会打印地址，形如 `https://yejianji-sync.你的用户名.workers.dev`。浏览器打开 `地址/api/health`，看到 `{"ok":true,"kv":true,"r2":true}` 就算通了；`kv` 或 `r2` 是 false 说明第 1、2 步没绑上。

**5. 网页里连上**

打开页间集 →「关于我 → 云同步」→ 填后端地址（同站部署就留空）→ 保存并连接。
再到「关于我 → 账号」注册并登录。第一台设备登录后会把本地的书全推上去，第二台设备登录同一个账号就自动拉下来。

⚠️ 同一台设备上换账号登录时，本地那份书会先被清掉再从云端重拉 —— 不然两个人的书会混在一起。换之前记得先同步完。

---

## 二、同步是怎么算的

- 每本书带一个 `updatedAt`（本地改动时间）。同一本书两边都改过，**改得晚的赢**，另一边下次同步时被覆盖。
- 删除会留一条「墓碑」记录，另一台设备同步时才知道该删。墓碑保留 120 天后自动清掉。
- 拉取用的游标是**服务端时间**，不是设备时间 —— 手机电脑的系统时钟差几分钟也不会漏同步。
- 封面和附件**不批量下载**：只有真正要显示封面、或点下载附件时才去 R2 取，取回来存在本地，下次不再请求。
- 本地断网时照常用，改动攒着，下次同步一起补传。

一句话：适合一个人多台设备。不适合多人同时编辑同一本书 —— 那种情况需要逐字段合并，这里没做。

---

## 三、网盘（百度网盘 / WebDAV）

### 先说清楚两件事

**一、账号密码不是网盘的账号密码。** 页间集的账号是它自己的账号，和百度账号没有任何关系。绑百度走的是官方 OAuth 授权跳转，你的百度密码只会输在百度自己的页面上，我们这边从头到尾拿不到它。

任何要你在第三方网页里输入网盘登录密码的做法都是错的 —— 违反服务商协议，而且密码一旦被存下来，风险全在存的那一方。

**二、百度这条路，你可能申请不下来。** 百度网盘开放平台目前**个人开发者认证暂不开放**，只能走企业认证；平台规范里还明确禁止「利用个人网盘账号搭建网盘迁移工具」这类产品行为。

所以代码里做了两个 provider，接口一样，前端不用管接的是哪家：

| provider | 拿得到吗 | 说明 |
| --- | --- | --- |
| `webdav` | 随时能用 | 坚果云、InfiniCloud、Nextcloud、群晖……几分钟开通 |
| `baidu` | 要 AppKey | 适配器写完了，拿到 AppKey 配上就能跑 |

**建议先用 WebDAV 跑通**，百度那边申请下来了再切。

### WebDAV（推荐，不用申请任何东西）

以坚果云为例：

1. 登录坚果云 → 账户信息 → 安全选项 → **添加应用密码**
2. 记下它给的服务器地址（形如 `https://dav.jianguoyun.com/dav/`）、账号（你的邮箱）、以及刚生成的**应用密码**
3. 页间集 →「关于我 → 网盘」→ WebDAV 那一栏填进去 → 连接并绑定

注意填的是**应用密码，不是你的登录密码**。应用密码可以随时单独吊销，不影响主账号。

绑定时后端会真连一次，连不上就不会存 —— 密码填错当场就知道。凭据用 AES-GCM 加密后才写进 KV。

「用哪个文件夹」默认 `yejianji`，所有读写都锁在这个目录下，越权路径会被后端挡掉。

### 百度网盘

**需要的东西**：开放平台的应用，拿到 AppKey / SecretKey / 应用名。

配置：

```bash
npx wrangler secret put BAIDU_APP_KEY
npx wrangler secret put BAIDU_SECRET_KEY
# 应用名不是密钥，写在 wrangler.toml 的 [vars] 里
#   BAIDU_APP_NAME = "你的应用名"
```

**回调地址必须登记**：开放平台控制台 → 应用 → 安全设置 → 授权回调地址，填

```
https://你的域名/api/netdisk/callback
```

这个地址和代码里拼出来的必须**完全一致**（协议、域名、路径一个字都不能差），否则换 token 那一步会失败。

几个百度特有的坑，代码里都处理了，列出来是方便你排查：

- `scope` 固定传 `basic,netdisk`，少一个后面调接口会返回 `errno=-6`
- 所有请求的 `User-Agent` 必须是 `pan.baidu.com`，换掉会被拒
- 下载用的 `dlink` 会 302 跳转，UA 得一路带着，跳完那一跳才不会被拒
- `refresh_token` **一次性**，刷新时会发新的，必须换掉旧的存起来
- 应用只能读写 `/apps/<应用名>/`，碰不到网盘里其他文件（这也是好事）
- 上传是三步：`precreate` → `superfile2` 逐片（固定 4MB）→ `create`。每片的 MD5 由前端算好传上来（`js/md5.js`），因为 Worker 里没有现成的 MD5，而且前端本来就持有文件，在那边算省一次搬运

### 能拿它做什么

绑好之后多两件事：

- **从网盘导入**：添加书籍页 → 附件区 →「从网盘导入」，浏览网盘目录挑一个文件。下载完就是个普通文件，和本地选文件走同一条路，EPUB 照样自动读元数据。
- **整库备份 / 恢复**：「关于我 → 网盘」→ 备份到网盘。格式和「导出备份」完全一样，两边可以互导。备份**不含附件文件**（那些本来就在网盘里躺着，没必要再打包一份）。

⚠️ 网盘是**导入源和备份盘**，不是同步通道。多端同步走的仍然是 KV/R2 那条路 —— 网盘接口慢、有频率限制，拿来当实时同步后端会很难用。

---

## 四、抓取那三个站

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

## 五、接口一览

除 `/api/health`、`/api/auth/*` 和 `/api/netdisk/callback` 外，都要带
`Authorization: Bearer <登录后拿到的会话票>`（老部署也认 `SYNC_TOKEN`）。

会话票是后端 HMAC 签名的一段字符串，不落库，30 天过期。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 探活，顺带告诉你 KV / R2 绑没绑上 |
| POST | `/api/auth/register` | 注册，body `{username, password, invite?}` |
| POST | `/api/auth/login` | 登录，返回 `{token, expiresIn}` |
| POST | `/api/auth/password` | 改密码，需要原密码 |
| GET | `/api/me` | 当前是谁 |
| GET | `/api/netdisk/status` | 绑没绑、绑的哪家、后端支持哪几家 |
| POST | `/api/netdisk/authorize` | 要一个百度授权链接 |
| GET | `/api/netdisk/callback` | 百度授权回调（浏览器访问，靠 state 认身份）|
| POST | `/api/netdisk/bind-webdav` | 绑 WebDAV，会先真连一次再存 |
| POST | `/api/netdisk/unbind` | 解绑 |
| GET | `/api/netdisk/list?dir=` | 列目录 |
| GET | `/api/netdisk/download?ref=` | 下载一个文件（流式转发）|
| PUT/POST | `/api/netdisk/upload?path=` | 上传；百度要带 `action=precreate\|part\|create` |
| POST | `/api/sync` | 推本地改动，同时拉回云端改动 |
| GET | `/api/sync?since=<毫秒>` | 只拉不推 |
| GET | `/api/assets` | 云端已有的文件 key 列表 |
| PUT | `/api/asset/<key>` | 上传封面或附件（单发，≤ Cloudflare 请求体上限） |
| GET | `/api/asset/<key>` | 下载 |
| DELETE | `/api/asset/<key>` | 删除 |
| POST | `/api/asset-multipart/<key>?action=init` | 分片上传：启动，返回 uploadId |
| PUT | `/api/asset-multipart/<key>?action=part&uploadId=…&partNumber=N` | 分片上传：传一片，返回 etag |
| POST | `/api/asset-multipart/<key>?action=complete&uploadId=…` | 分片上传：合并，body 是 `{parts:[{partNumber, etag},…]}` |
| POST | `/api/asset-multipart/<key>?action=abort&uploadId=…` | 分片上传：中止并清碎片 |
| POST | `/api/import` | 抓一个作品页，返回解析好的书籍信息 |
| GET | `/api/proxy?url=` | 原样透传页面字节，编码写在 `X-Source-Charset` 头里 |
| GET | `/api/image?url=` | 转发图片，绕开图床的跨域限制 |

**附件大小规则：** 前端 80MB 以下走单发 `PUT /api/asset/<key>`；超过 80MB 自动切成 50MB 一片走 multipart，避开 Cloudflare 边缘请求体上限（Free/Pro 100MB、Business 200MB、Enterprise 500MB）。前端配置 `MAX_UPLOAD = 500MB`，实际能不能传上去看你的 R2 空间和 Worker 免费额度（每天 10 万请求，300MB 分成 6 片 = 6 次请求）。

key 的命名：封面是 `cover/<书籍id>`，附件是 `asset/<assetId>`。

---

## 六、日常维护

```bash
npx wrangler tail                                     # 看实时日志
npx wrangler kv key list --binding=KV                 # 有哪些用户、哪些库
npx wrangler kv key get --binding=KV "user:小明"       # 看某个账号（密码是哈希，看不出原文）
npx wrangler kv key get --binding=KV "lib:u1a2b3c4"   # 看某个人的书目原文
npx wrangler kv key delete --binding=KV "user:小明"    # 删账号
npx wrangler r2 object delete yejianji-assets/u/u1a2b3c4/cover/123   # 手动删某个文件
```

KV 里的键长这样：

| 键 | 放什么 |
| --- | --- |
| `user:<小写用户名>` | 账号本身（uid、salt、密码哈希）|
| `lib:<uid>` | 这个人的书目、选项、删除记录 |
| `nd:<uid>` | 这个人的网盘绑定（token / 密码是密文）|
| `st:<state>` | 授权过程中的临时 state，10 分钟自动过期 |
| `library` | 老版本单口令用户的书目，没动过 |

**免费额度**（个人用远远够）：Workers 每天 10 万次请求；KV 每天 10 万次读、1000 次写；R2 存储 10GB、流量不额外收费。同步是按需触发的（改动后 2.5 秒、回到页面时、手动点击），不是定时轮询，正常一天几十次请求。

**关于密码**：存的是 PBKDF2-SHA256 跑 15 万次加随机 salt 的结果，不是明文，也推不回去 —— 用户忘了密码只能重设（目前没做找回，得你手动删掉 `user:xxx` 让他重新注册）。登录时就算用户不存在也照样算一次哈希再返回，免得别人靠响应快慢枚举出哪些用户名是存在的。

**三个已知的小毛病**：

- 没有找回密码。个人项目没接邮件服务，忘了就手动删账号重注册。
- 删掉书之后，R2 里对应的封面和附件不会自动清，占一点空间。介意的话用上面的 `r2 object delete` 手动清，或者以后加个定期比对的清理脚本。
- `ALLOWED_ORIGIN` 默认是 `*`。接口本身要登录，安全性不靠它，但改成你自己的站点地址会更稳妥 —— 改 `wrangler.toml` 里的 `[vars]` 再 `deploy` 一次。
