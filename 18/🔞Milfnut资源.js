// @name milfnut.com
// @version 1.0.3
// @changelog
// - v1.0.3 (2026-04-21) play() 参数解析改用 URLSearchParams + try/catch，正则仅作兜底
// - v1.0.2 (2026-04-21) 修复列表封面图：优先 data-lazy-src/source[lazy-srcset]，兼容 lazy-load 和直连两种模式
// - v1.0.1 (2026-04-21) 修复 play() base64 解码：tag 参数需二次 URL decode
// - v1.0.0 (2026-04-21) 初始版本
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/Milfnut.js
// @dependencies cheerio

const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://milfnut.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const CLASSES = [
    { type_id: "latest", type_name: "Latest" },
    { type_id: "trending", type_name: "Trending" },
    { type_id: "random", type_name: "Random" }
];

function log(level, msg) {
    OmniBox.log(level, "[milfnut] " + msg);
}

function cleanText(t) {
    return (t || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function formatPic(pic) {
    if (!pic) return "";
    if (pic.indexOf("//") === 0) return "https:" + pic;
    if (pic.indexOf("http") === 0) return pic;
    return HOST + (pic.charAt(0) === "/" ? "" : "/") + pic;
}

async function httpGet(url, extraHeaders) {
    var headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive"
    };
    if (extraHeaders) {
        for (var k in extraHeaders) headers[k] = extraHeaders[k];
    }
    var res = await OmniBox.request(url, { method: "GET", headers: headers, timeout: 15000 });
    return res.body || "";
}

// ─── 列表解析（通用）──────────────────────
function parseList(html) {
    var $ = cheerio.load(html);
    var list = [];
    $("article").each(function () {
        var $el = $(this);
        var $a = $el.find("a[href*='/']").first();
        var href = $a.attr("href") || "";
        // 匹配详情页 slug
        var match = href.match(/https?:\/\/milfnut\.com\/([^/]+)\/$/);
        if (!match) return;
        var slug = match[1];

        var title = $a.attr("title") || $el.find("img").attr("alt") || "";
        // 优先 data-lazy-src（lazy-load img），其次 source[data-lazy-srcset]（webp），最后 src（无 lazy-load 场景）
        var pic = $el.find("img").attr("data-lazy-src") ||
                  $el.find("source[data-lazy-srcset]").attr("data-lazy-srcset") ||
                  $el.find("img").attr("src") || "";
        var duration = cleanText($el.find(".duration").text() || "");

        if (!title) return;
        list.push({
            vod_id: slug,
            vod_name: cleanText(title),
            vod_pic: formatPic(pic),
            vod_remarks: duration,
            vod_year: "", vod_director: "", vod_actor: "", vod_content: ""
        });
    });
    return list;
}

// ─── home ─────────────────────────────────
async function home(params, context) {
    try {
        var html = await httpGet(HOST + "/");
        var list = parseList(html);
        return { class: CLASSES, list: list };
    } catch (e) {
        log("error", "home: " + e.message);
        return { class: CLASSES, list: [] };
    }
}

// ─── category ─────────────────────────────
async function category(params, context) {
    try {
        var id = (params.t || params.categoryId || params.id || "latest").toString();
        var pg = parseInt(params.pg || params.page || 1) || 1;
        var url;

        if (id === "latest") {
            url = pg === 1 ? HOST + "/" : HOST + "/page/" + pg + "/";
        } else if (id === "random") {
            // random 不支持分页，始终返回首页
            url = HOST + "/?filter=random";
        } else if (id === "trending") {
            url = pg === 1 ? HOST + "/category/trending/" : HOST + "/category/trending/page/" + pg + "/";
        } else {
            url = pg === 1 ? HOST + "/" + id + "/" : HOST + "/" + id + "/page/" + pg + "/";
        }

        var html = await httpGet(url);
        var list = parseList(html);

        // 计算 pagecount（保守估计）
        var pagecount = 1;
        var pageMatch = html.match(/page\/\d+/g);
        if (pageMatch) {
            var pages = pageMatch.map(function (m) { return parseInt(m.match(/\d+/)[0]); });
            pagecount = Math.max.apply(null, pages);
        }

        return { list: list, page: pg, pagecount: pagecount };
    } catch (e) {
        log("error", "category: " + e.message);
        return { list: [], page: 1, pagecount: 1 };
    }
}

// ─── search ───────────────────────────────
async function search(params, context) {
    try {
        var keyword = (params.keyword || params.wd || "").trim();
        if (!keyword) return { list: [] };
        var pg = parseInt(params.pg || params.page || 1) || 1;
        var url = pg === 1 ? HOST + "/?s=" + encodeURIComponent(keyword) : HOST + "/page/" + pg + "/?s=" + encodeURIComponent(keyword);
        var html = await httpGet(url);
        var list = parseList(html);

        var pagecount = 1;
        var pageMatch = html.match(/page\/\d+/g);
        if (pageMatch) {
            var pages = pageMatch.map(function (m) { return parseInt(m.match(/\d+/)[0]); });
            pagecount = Math.max.apply(null, pages);
        }

        return { list: list, page: pg, pagecount: pagecount };
    } catch (e) {
        log("error", "search: " + e.message);
        return { list: [] };
    }
}

// ─── detail ───────────────────────────────
async function detail(params, context) {
    try {
        var id = (params.videoId || params.id || params.ids || "").toString();
        if (Array.isArray(id)) id = id[0];
        if (!id) return { list: [] };

        var url = HOST + "/" + id + "/";
        var html = await httpGet(url);
        var $ = cheerio.load(html);

        var title = $("meta[property='og:title']").attr("content") || $("h1").first().text() || "";
        var pic = $("meta[property='og:image']").attr("content") || "";
        var description = $("meta[name='description']").attr("content") || "";

        // 演员
        var actors = [];
        $("a[href*='/actor/']").each(function () {
            var name = cleanText($(this).text());
            if (name) actors.push(name);
        });

        // 分类
        var cats = [];
        $("a[href*='/category/']").each(function () {
            var name = cleanText($(this).text());
            if (name) cats.push(name);
        });

        // 提取 iframe src
        var iframeSrc = $(".responsive-player iframe").attr("src") || "";
        var playId = iframeSrc || id;

        var playSources = [{
            name: "默认线路",
            episodes: [{ name: "播放", playId: playId }]
        }];

        return {
            list: [{
                vod_id: id,
                vod_name: cleanText(title),
                vod_pic: formatPic(pic),
                vod_remarks: "",
                vod_year: "",
                vod_director: "",
                vod_actor: actors.join(" / "),
                vod_content: description,
                type_name: cats.join(" / ") || "MILF",
                link: url,
                vod_play_sources: playSources
            }]
        };
    } catch (e) {
        log("error", "detail: " + e.message);
        return { list: [] };
    }
}

// ─── play ─────────────────────────────────
async function play(params, context) {
    try {
        var raw = (params.playId || params.url || "").toString();
        if (!raw) return { urls: [], parse: 0 };

        // 直接是 m3u8 直链
        if (/\.(m3u8|mp4|flv)/i.test(raw)) {
            return {
                urls: [{ name: "720p", url: raw }],
                parse: 0,
                header: { "User-Agent": UA, "Referer": HOST + "/" }
            };
        }

        // 如果是详情页 slug，先构建 iframe URL
        var iframeUrl = raw;
        if (!raw.includes("player-x.php")) {
            // 传入的是 slug，需要先请求详情页获取 iframe
            var detailUrl = raw.indexOf("http") === 0 ? raw : HOST + "/" + raw + "/";
            try {
                var detailHtml = await httpGet(detailUrl);
                var $ = cheerio.load(detailHtml);
                iframeUrl = $(".responsive-player iframe").attr("src") || "";
            } catch (e) {
                log("warn", "play: detail fetch failed " + e.message);
            }
        }

        // 提取 player-x.php 的 q 参数并解码
        if (iframeUrl && iframeUrl.indexOf("player-x.php") !== -1) {
            try {
                var qMatch = iframeUrl.match(/q=([^&]+)/);
                if (qMatch) {
                    var qParam = qMatch[1];
                    var decoded = Buffer.from(qParam, "base64").toString("utf8");
                    // 使用 URLSearchParams 安全解析参数（避免正则边界问题）
                    var tagValue = "";
                    try {
                        var sp = new URLSearchParams(decoded);
                        tagValue = decodeURIComponent(sp.get("tag") || "");
                    } catch (e) {
                        // URLSearchParams 解析失败时用正则兜底
                        var tagMatchFallback = decoded.match(/tag=([^&]+)/);
                        if (tagMatchFallback) tagValue = decodeURIComponent(tagMatchFallback[1]);
                    }
                    if (tagValue) {
                        var srcMatch = tagValue.match(/src="([^"]+)"/);
                        if (srcMatch && srcMatch[1]) {
                            var m3u8Url = decodeURIComponent(srcMatch[1]);
                            return {
                                urls: [{ name: "720p", url: m3u8Url }],
                                parse: 0,
                                header: { "User-Agent": UA, "Referer": HOST + "/" }
                            };
                        }
                    }
                }
            } catch (e) {
                log("warn", "play: base64 decode failed " + e.message);
            }
        }

        // 兜底：如果是 http URL，尝试 sniffVideo（仅 web 端）
        if (raw.indexOf("http") === 0 && context && context.from === "web") {
            var sniffResult = await OmniBox.sniffVideo(raw, { "User-Agent": UA, "Referer": HOST + "/" });
            if (sniffResult && sniffResult.url) {
                return {
                    urls: [{ name: "720p", url: sniffResult.url }],
                    parse: 0,
                    header: sniffResult.header || { "User-Agent": UA, "Referer": HOST + "/" }
                };
            }
        }

        // 最后兜底：ok影视 parse:1
        if (raw.indexOf("http") === 0) {
            return {
                urls: [{ name: "播放", url: raw }],
                parse: 1,
                header: { "User-Agent": UA, "Referer": HOST + "/" }
            };
        }

        return { urls: [], parse: 0 };
    } catch (e) {
        log("error", "play: " + e.message);
        return { urls: [], parse: 0 };
    }
}

// ═══════════════════════════════════════════
module.exports = { home, category, search, detail, play };
require("spider_runner").run(module.exports);
