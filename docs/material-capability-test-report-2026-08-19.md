# 素材采集能力只读测试报告

> 测试时间：2026-08-19  通过 `yishe-client` 本地 API 1519 执行。测试只调用 `status` 和 `search`，没有调用 `download` / `collect`，不会新增素材库记录。

## 结论

- Google Arts、Pinterest、Wikimedia、Pexels、Pixabay、StockSnap、Openverse、Kaboompics、OpenClipart、unDraw、Vecteezy、Noun Project、Iconify、OpenMoji、Google Icons、Emojipedia、SVGRepo：接口可用并返回结果（OpenMoji/Google Icons 的“Mona Lisa”无结果属于关键词不适合，不代表平台故障；Vecteezy 首次 `sunflower` 403，但换用 `logo` 成功）。
- Rawpixel：接口返回 `success=true`，但 `sunflower` 返回 `data.count=0`；属于“接口可用、该关键词无结果”，需要补充关键词/分页验证搜索覆盖。
- 18 个平台中，状态接口全部成功；搜索接口没有发现网络/协议级失败，只有 Rawpixel 空结果和 Vecteezy 特定关键词 403。

## 平台结果

| 平台 | status | search | 备注 |
|---|---:|---:|---|
| googleArt | ✅ | ✅ 3/529 | 已完成真实 search → zoom → collect 入库回归 |
| pinterest | ✅ | ✅ 3 | 返回 Pinterest 原图 URL |
| wikimedia | ✅ | ✅ 3 | 返回 Wikimedia 原图 URL |
| pexels | ✅ | ✅ 3 | 返回 Pexels 图片 URL |
| pixabay | ✅ | ✅ 3 | 返回 Flickr 图片 URL |
| rawpixel | ✅ | ⚠️ 空结果 | 接口成功但 `data.count=0`；关键词未命中 |
| stocksnap | ✅ | ✅ 3 | 返回 CDN 图片 URL |
| openverse | 超时后成功 | ✅ 3 | status 约 10 秒，需优化超时/缓存 |
| kaboompics | ✅ | ✅ 3 | 返回图片 URL |
| openclipart | ✅ | ✅ 3 | 返回 SVG/图片 URL |
| undraw | ✅ | ✅ 3 | 返回 SVG 插画 |
| vecteezy | ✅ | ⚠️ 关键词相关 | sunflower=403；logo=成功 |
| nounproject | ✅ | ✅ 3 | 返回图标图片 |
| iconify | ✅ | ✅ 3（修复后） | 上游曾忽略 limit，客户端已增加本地截断，保证返回不超过调用方数量 |
| openmoji | ✅ | ⚠️ 0 | sun 查询返回 0/19，语义搜索映射不准确 |
| google-icons | ✅ | ✅ 3 | home 查询成功 |
| emojipedia | ✅ | ✅ 3 | sun 查询成功 |
| svgrepo | ✅ | ✅ 3 | 返回 SVG/图标结果 |

## 发现的问题

1. **Iconify 的 limit/maxCount 参数未统一。** 测试传 `limit=3`，返回 `count=32`。需要统一各平台的结果数量上限，避免 Agent 上下文膨胀。
2. **Iconify 数量契约已修复。** 上游会忽略 limit，客户端现在本地截断 items/count，后续需重启客户端后回归确认。
3. **Openverse status 慢。** 约 10 秒后成功，建议状态探测与搜索请求分离缓存，或缩短 health timeout。
4. **Vecteezy 对特定关键词返回 403。** `sunflower` 403，但 `logo` 成功；应在工具结果中明确区分平台拒绝和无结果，不应自动改用浏览器。
5. **Rawpixel 空结果。** 接口没有报错但没有命中，需要补充更多关键词/分页测试，确认不是 parser 或搜索 URL 问题。
6. **OpenMoji 不适合普通图片搜索。** `sun` 返回 0，属于 emoji 语义/索引问题；工具描述应明确其适合 emoji 关键词。
7. **不同平台返回结构不完全统一。** 同样的 `count/items/total` 字段在不同平台存在缺失，建议统一 `SearchResult` envelope。

## 测试边界

本次没有执行写操作。以下能力仍需单独做小规模写入验收：

- 每个平台 `download` 是否保存到本地；
- 每个平台 `collect` 是否 COS 上传并写入素材库；
- 失败时是否不产生半成品素材记录；
- 用户确认策略是否一致；
- `materialLibraryOk=true` 是否真实对应素材库记录。
