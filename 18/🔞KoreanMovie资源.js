// @name KoreanMovie
// @author nexu
// @version 1.7.3
// @description KoreanPornMovie - REST API补全 + TVBox嗅探
// 1.7.3: 修复 detail() 404 检测 — httpGet 现在返回 {body, status}，detail() 通过 HTTP 状态码检测 404 页面（之前靠 html.length<100 判断，但 404 页面也有 124KB 导致 fallback 不触发）。
// 1.7.2: 1) detail() 在 REST API fallback 获取 slug 后重新拉取 slug 页面以提取 mp4；2) extractMp4FromIframeQ 修复 tag= 参数内部嵌套 URL 编码问题。
// 1.7.1: 修复 mp4 提取链路 — tag= 参数内部还有一层 URL 编码。
// 1.7.0: 直接在 detail() 提取 player-x.php q 参数并解码出 mp4 直链，play() 返回 parse:0 直链。
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/KoreanPornMovie.js

const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://koreanpornmovie.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ITEM_LIMIT = 20;

const CLASSES = [
    { type_id: "latest", type_name: "Latest" },
    { type_id: "most-viewed", type_name: "Most Viewed" },
    { type_id: "longest", type_name: "Longest" },
    { type_id: "popular", type_name: "Popular" }
];

// ========== 工具函数 ==========

function escapeHtml(str) {
    if (!str) return "";
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function truncate(str, max) {
    if (!str) return "";
    str = str.toString().trim();
    return str.length > max ? str.substring(0, max) : str;
}

function normalizeUrl(url) {
    if (!url) return "";
    url = url.trim();
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (url.charAt(0) === "/") url = HOST + url;
    if (url.indexOf("http") !== 0) url = HOST + "/" + url;
    return url;
}

/**
 * 从 player-x.php iframe 的 q 参数中解码提取 mp4 直链
 * q 参数是 URL-encoded base64，解码后得到 post_id=xxx&type=video&tag=<url-encoded HTML>
 * tag= 的值本身也是 URL-encoded HTML，需要再解码一层才能取出 <source src="mp4_url">
 *
 * 解码链路（共3层）:
 *   q → URL-decode → base64-decode → post_id=xxx&type=video&tag=<url-encoded HTML>
 *   tag= → URL-decode → <video><source src="mp4_url"></video>
 *   src= → 最终 mp4 直链
 */
async function extractMp4FromIframeQ(qParam) {
    if (!qParam) return null;
    try {
        // Step 1: URL-decode the base64 string
        const urlDecoded = decodeURIComponent(qParam);
        // Step 2: base64 decode → "post_id=xxx&type=video&tag=<url-encoded HTML>"
        const plainText = Buffer.from(urlDecoded, "base64").toString("utf8");
        // Step 3: Extract the URL-encoded tag= value (the HTML inside tag= is itself URL-encoded)
        const tagMatch = plainText.match(/tag=([^&]+)/);
        if (!tagMatch) return null;
        // Step 4: URL-decode tag= to get actual HTML: <video...><source src="mp4_url" ...>
        const tagDecoded = decodeURIComponent(tagMatch[1]);
        // Step 5: Extract src from <source> tag
        const srcMatch = tagDecoded.match(/src="([^"]+)"/);
        if (!srcMatch) return null;
        // Step 6: URL-decode the mp4 URL (spaces=%20, parens=%28%29, etc.)
        return decodeURIComponent(srcMatch[1]);
    } catch (e) {
        return null;
    }
}

/**
 * 解析 detail 页面 HTML，提取 iframe src 中的 player-x.php q 参数
 */
function extractPlayerIframeQ(html) {
    if (!html) return null;
    // 匹配 <iframe ... src="...player-x.php?q=..." ...>
    const match = html.match(/src="[^"]*player-x\.php\?q=([^"]+)"/);
    return match ? match[1] : null;
}

/**
 * HTTP GET 请求，返回 {body, status}
 * body: 响应体字符串，失败时返回 ""
 * status: HTTP 状态码，失败时返回 0
 */
async function httpGet(path) {
    try {
        var url = normalizeUrl(path);
        var res = await OmniBox.request(url, {
            method: "GET",
            headers: {
                "User-Agent": UA,
                "Referer": HOST + "/",
                "Accept": "text/html,application/xhtml+xml,application/json,*/*"
            },
            timeout: 15000
        });
        if (!res) return { body: "", status: 0 };
        return { body: res.body || "", status: res.status || res.statusCode || 0 };
    } catch (e) {
        return { body: "", status: 0 };
    }
}

/**
 * 简化版 httpGet，只返回 body（用于不需要检查状态码的场景如列表、搜索）
 */
async function httpGetBody(path) {
    var r = await httpGet(path);
    return r.body;
}

// ========== 列表解析 ==========

function parseList(html) {
    if (!html) return [];
    var $ = cheerio.load(html);
    var list = [];
    var seen = new Set();

    $("#main article[data-post-id], #main .videos-list article").each(function () {
        if (list.length >= ITEM_LIMIT) return false;

        var $el = $(this);
        var postId = $el.attr("data-post-id") || "";
        if (!postId || seen.has(postId)) return;
        seen.add(postId);

        var $a = $el.find("a").first();
        var href = $a.attr("href") || "";
        if (!href) return;

        var title = $a.attr("title") || $a.text().trim() || "";
        title = title.replace(/\s+/g, " ").trim();
        if (!title) return;

        var $img = $a.find("img").first();
        var pic = $img.attr("data-src") || $img.attr("data-lazy-src") || $img.attr("data-original") || $img.attr("src") || "";
        if (pic && pic.indexOf("//") === 0) pic = "https:" + pic;

        var duration = "";
        var $dur = $el.find(".duration, [class*=duration], .is-duration").first();
        if ($dur.length) duration = $dur.text().trim();

        list.push({
            vod_id: postId,
            vod_name: escapeHtml(truncate(title, 150)),
            vod_pic: pic,
            vod_remarks: escapeHtml(duration)
        });
    });

    return list;
}

// ========== 五大方法 ==========

async function home(params, context) {
    return { class: CLASSES };
}

async function category(params, context) {
    try {
        var tid = (params.t || params.categoryId || params.id || "latest").toString().trim();
        var pg = parseInt(params.pg || params.page || 1);
        if (isNaN(pg) || pg < 1) pg = 1;
        if (pg > 500) pg = 500;

        if (params.ac === "detail" && tid) {
            return detail({ id: tid }, context);
        }

        var url = "";
        if (tid === "latest") {
            url = pg === 1 ? "/" : "/page/" + pg + "/";
        } else {
            url = pg === 1 ? "/?filter=" + encodeURIComponent(tid) : "/page/" + pg + "/?filter=" + encodeURIComponent(tid);
        }

        var html = await httpGetBody(url);
        var list = parseList(html);

        return { list: list, page: pg, pagecount: list.length > 0 ? pg + 1 : pg };
    } catch (e) {
        return { list: [], page: 1, pagecount: 1 };
    }
}

async function detail(params, context) {
    try {
        var id = params.videoId || params.id || params.ids || "";
        if (Array.isArray(id)) id = id[0];
        if (typeof id === "string" && id.includes(",")) id = id.split(",")[0];
        id = String(id).trim();
        if (!id) return { list: [] };

        // 构造详情页 URL（先用 ID，REST API fallback 后会更新为 slug URL）
        var detailUrl = "/" + id;
        var resp = await httpGet(detailUrl);
        var html = resp.body;
        var httpStatus = resp.status;

        // 初始化元数据字段
        var title = "", pic = "", desc = "", postId = id;
        // 检测 404：HTTP 状态码 4xx/5xx，或页面包含 "Page not found"
        // 注意：不能仅靠 html.length<100 判断，因为 404 页面也有 124KB
        var needSlugFetch = httpStatus >= 400 || !html || html.length < 100 ||
            (html.indexOf("Page not found") !== -1 && html.indexOf("player-x.php") === -1);

        if (needSlugFetch) {
            try {
                var apiResp = await httpGet("/?rest_route=/wp/v2/posts/" + id + "&_fields=slug,title,link");
                var json = apiResp.body;
                if (json) {
                    var data = JSON.parse(json);
                    if (data.title && data.title.rendered) {
                        // 解码 HTML 实体 (&#8211; → — 等)
                        title = data.title.rendered
                            .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
                            .replace(/<[^>]+>/g, "")
                            .trim();
                    }
                    // 从 link 中提取正确的 slug URL（保留尾部斜杠避免 301 重定向），并重新拉取真实页面
                    if (data.link) {
                        var slugMatch = data.link.match(/koreanpornmovie\.com\/(.+?\/?)$/);
                        if (slugMatch) {
                            detailUrl = "/" + slugMatch[1];
                            // 重新拉取 slug 页面以提取 mp4
                            var slugResp = await httpGet(detailUrl);
                            html = slugResp.body;
                        }
                    }
                    postId = String(data.id);
                }
            } catch (e) { /* ignore */ }
        }

        // 从 HTML 提取（如果可用）
        if (html) {
            if (!title) {
                var ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i);
                if (ogTitle) title = ogTitle[1];
                if (!title) {
                    var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                    if (h1) title = h1[1].replace(/<[^>]+>/g, "").trim();
                }
            }
            title = truncate(title, 200);

            var ogImage = html.match(/property="og:image"\s+content="([^"]+)"/i);
            if (ogImage) pic = ogImage[1];
            if (!pic) {
                var picMatch = html.match(/class="post-thumbnail"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
                if (picMatch) pic = picMatch[1];
            }
            if (pic && pic.indexOf("//") === 0) pic = "https:" + pic;

            var pidMatch = html.match(/data-post-id="(\d+)"/i);
            if (pidMatch) postId = pidMatch[1];

            var ogDesc = html.match(/property="og:description"\s+content="([^"]+)"/i);
            if (ogDesc) desc = ogDesc[1].replace(/<[^>]+>/g, "").trim();
        }

        // 提取播放器 iframe 的 q 参数并解码出 mp4 直链
        var mp4Url = "";
        var iframeQ = extractPlayerIframeQ(html);
        if (iframeQ) {
            mp4Url = await extractMp4FromIframeQ(iframeQ);
        }

        // 播放源：优先用真实 mp4 直链，TVBox 直连；否则 fallback 到详情页 URL（走嗅探）
        var playUrl = mp4Url || (HOST + detailUrl);

        OmniBox.log("info", "detail id=" + id + " title=" + title + " mp4=" + (mp4Url || "N/A") + " playUrl=" + playUrl);

        return {
            list: [{
                vod_id: postId,
                vod_name: escapeHtml(title),
                vod_pic: pic,
                vod_content: escapeHtml(truncate(desc, 2000)),
                vod_remarks: "",
                vod_play_sources: [{
                    name: "KoreanPornMovie",
                    episodes: [{ name: "播放", playId: playUrl }]
                }]
            }]
        };
    } catch (e) {
        OmniBox.log("error", "detail error: " + e.message);
        return { list: [] };
    }
}

async function search(params, context) {
    try {
        var wd = (params.keyword || params.wd || "").toString().trim();
        if (!wd || wd.length < 2) return { list: [] };
        if (wd.length > 80) wd = wd.substring(0, 80);

        var pg = parseInt(params.pg || params.page || 1);
        if (isNaN(pg) || pg < 1) pg = 1;
        if (pg > 100) pg = 100;

        var url = pg === 1 ? "/?s=" + encodeURIComponent(wd) : "/page/" + pg + "/?s=" + encodeURIComponent(wd);
        var html = await httpGetBody(url);
        return { list: parseList(html) };
    } catch (e) {
        return { list: [] };
    }
}

async function play(params, context) {
    try {
        var url = (params.playId || params.url || "").toString().trim();
        if (!url) return { urls: [], parse: 0 };

        var h = {
            "User-Agent": UA,
            "Referer": HOST + "/",
            "Origin": HOST,
            "Connection": "keep-alive"
        };

        // 判断是否为直链 mp4：koreanporn.stream 的 mp4 → parse:0 直连
        // 其他（如 fallback 到详情页 URL）→ parse:1 嗅探兜底
        var isDirect = /koreanporn\.stream\/.*\.mp4/i.test(url);

        return {
            urls: [{ name: "播放", url: url }],
            parse: isDirect ? 0 : 1,
            header: h
        };
    } catch (e) {
        return { urls: [], parse: 0 };
    }
}

module.exports = { home, category, search, detail, play };

var runner;
try {
    runner = require("spider_runner");
} catch (e) {
    runner = { run: function (m) { return m; } };
}
runner.run(module.exports);
