/* =====================================================
   Cloudflare Pages Functions 入口

   整站托管在 Cloudflare Pages 时，这个文件让同一套后端跑在
   自己的域名下（https://你的站点/api/...），好处有两个：
     · 前后端同源，彻底没有跨域问题
     · 不用单独 wrangler deploy，推代码就一起上线了

   Pages 后台要配三样（Settings → Functions / 环境变量）：
     KV          → 绑定一个 KV namespace
     R2          → 绑定 R2 桶
     SYNC_TOKEN  → 环境变量（选加密），就是网页里填的访问口令

   配好之后，网页「关于我 → 云同步」里的后端地址**留空**即可。
===================================================== */

import worker from "../../worker/src/index.js";

export const onRequest = (context) => worker.fetch(context.request, context.env);
