// @name cnporn.org
// @version 1.0.2
// @changelog
// - 1.0.2 (2026-04-20) 去掉图片 @Referer；web 端 m3u8 直连不传 header 避免代理
// - 1.0.1 (2026-04-20) 修复 embed 页 m3u8 URL 反斜杠转义问题
// @downloadURL https://cnporn.org/player/player.min.js
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/index.js


const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://cnporn.org";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0";

// 分类：使用 main_navigation 作为主分类
const CLASSES = [
    { type_id: "china-porn", type_name: "China" },
    { type_id: "cuckold", type_name: "Cuckold" },
    { type_id: "hidden-cam", type_name: "Hidden Cam" },
    { type_id: "rape", type_name: "Rape" },
    { type_id: "historical", type_name: "Historical" }
];

// ─── 工具函数 ─────────────────────────────
function log(level, msg) {
    OmniBox.log(level, "[cnporn] " + msg);
}

function cleanText(t) {
    return (t || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// 封面图：CDN 无防盗链，直接返回原始 URL
function formatPic(pic) {
    if (!pic) return "";
    if (pic.indexOf("//") === 0) pic = "https:" + pic;
    if (pic.indexOf("http") !== 0) return "";
    return pic;
}

async function httpGet(url) {
    var res = await OmniBox.request(url, {
        method: "GET",
        headers: { "User-Agent": UA, "Connection": "keep-alive" },
        timeout: 15000
    });
    return res.body || "";
}

// ─── 列表解析 ─────────────────────────────
function parseList(html) {
    var $ = cheerio.load(html);
    var list = [];
    $("div.tw-item").each(function () {
        var $el = $(this);
        var $a = $el.find("a").first();
        var href = $a.attr("href") || "";
        // href 格式: https://cnporn.org/slug.html
        var slugMatch = href.match(/cnporn\.org\/(.+?)\.html/);
        if (!slugMatch) return;
        var slug = slugMatch[1];
        // 标题: a > h3 (非分类 label 的那个 h3)
        var title = $el.find("h3").not(".label h3").first().text() || "";
        // 封面: div.thumbnail.video img
        var pic = formatPic($el.find("div.thumbnail.video img").attr("src") || "");
        // 备注/番号: div.label h3
        var remarks = $el.find("div.label h3").first().text() || "";
        list.push({
            vod_id: slug,
            vod_name: cleanText(title),
            vod_pic: pic,
            vod_remarks: cleanText(remarks),
            type_id: "",
            type_name: "",
            link: href,
            vod_year: "",
            vod_director: "",
            vod_actor: "",
            vod_content: ""
        });
    });
    return list;
}

// ─── home ─────────────────────────────────
async function home(params, context) {
    try {
        var html = await httpGet(HOST + "/");
        var list = parseList(html);
        log("info", "home 返回 " + list.length + " 条");
        return { class: CLASSES, list: list };
    } catch (e) {
        log("error", "home: " + e.message);
        return { class: CLASSES, list: [] };
    }
}

// ─── category ─────────────────────────────
async function category(params, context) {
    try {
        var id = (params.t || params.categoryId || params.id || "china-porn").toString();
        var pg = parseInt(params.pg || params.page || 1) || 1;
        var url = pg === 1
            ? HOST + "/" + id
            : HOST + "/" + id + "/page/" + pg;
        var html = await httpGet(url);
        var list = parseList(html);

        // 计算 pagecount：找最后一页链接
        var pagecount = 1;
        var lastPageMatch = html.match(/\/page\/(\d+)/);
        if (lastPageMatch) pagecount = parseInt(lastPageMatch[1]) || 1;

        log("info", "category id=" + id + " pg=" + pg + " 返回 " + list.length + " 条");
        return { list: list, page: pg, pagecount: pagecount };
    } catch (e) {
        log("error", "category: " + e.message);
        return { list: [], page: 1, pagecount: 1 };
    }
}

// ─── search ─────────────────────────────
async function search(params, context) {
    try {
        var keyword = (params.keyword || params.wd || "").trim();
        if (!keyword) return { list: [] };
        var pg = parseInt(params.pg || params.page || 1) || 1;
        var url = HOST + "/search/?key=" + encodeURIComponent(keyword);
        var html = await httpGet(url);
        var list = parseList(html);
        log("info", "search " + keyword + " 返回 " + list.length + " 条");
        return { list: list, page: pg, pagecount: pg + 1 };
    } catch (e) {
        log("error", "search: " + e.message);
        return { list: [] };
    }
}

// ─── detail ─────────────────────────────
async function detail(params, context) {
    try {
        var id = (params.videoId || params.id || params.ids || "").toString();
        if (Array.isArray(id)) id = id[0];
        if (!id) return { list: [] };

        // id 可能是完整 URL 或 slug
        var slug = id;
        if (id.indexOf("cnporn.org") !== -1) {
            var m = id.match(/cnporn\.org\/(.+?)\.html/);
            if (m) slug = m[1];
        }

        var url = slug.indexOf(".html") === -1
            ? HOST + "/" + slug + ".html"
            : (slug.indexOf("http") === -1 ? HOST + "/" + slug : slug);

        var html = await httpGet(url);
        var $ = cheerio.load(html);

        // 标题
        var title = cleanText($("h1#video-name").first().text())
            || cleanText($("h1[itemprop=name]").first().text())
            || $("meta[property=og:title]").attr("content") || "";
        // 封面
        var pic = formatPic($("meta[property=og:image]").attr("content") || "");

        // TW.video_id
        var videoId = 0;
        try {
            var twMatch = html.match(/TW\.video_id\s*=\s*(\d+)/);
            if (twMatch) videoId = parseInt(twMatch[1]);
        } catch (_) {}

        // 从 iframe[data-type=lazy] 提取 embed UUID
        var embedUuid = "";
        var iframeSrc = $("iframe[data-type=lazy]").first().attr("data-src") || "";
        var uuidMatch = iframeSrc.match(/embed\/([a-f0-9-]+)/i);
        if (uuidMatch) embedUuid = uuidMatch[1];

        // model
        var actor = cleanText($("[itemprop=actor] h2[itemprop=name]").first().text()) || "";

        // genres
        var genres = [];
        $(".attr a[href]").each(function () {
            var t = cleanText($(this).text());
            if (t) genres.push(t);
        });

        // upload_date
        var uploadDate = $("[itemprop=uploadDate]").attr("content") || "";

        // rating
        var rating = cleanText($(".btn-rating span").first().text()) || "";

        // description
        var description = $("[itemprop=description]").attr("content") || "";

        // 播放源：单视频，embed UUID 作为 playId
        var playSources = [{
            name: "默认线路",
            episodes: [{ name: "播放", playId: embedUuid }]
        }];

        log("info", "detail " + slug + " embedUuid=" + embedUuid);
        return {
            list: [{
                vod_id: slug,
                vod_name: title,
                vod_pic: pic,
                vod_remarks: rating,
                type_id: "movie",
                type_name: "Movie",
                link: url,
                vod_year: uploadDate ? uploadDate.split("T")[0] : "",
                vod_director: "",
                vod_actor: actor,
                vod_content: (genres.length ? "类型: " + genres.join(", ") + "\n" : "") + description,
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
        if (!raw) return { urls: [], parse: 0, flag: "play" };

        // 如果已经是 m3u8 直链
        if (/\.(m3u8|mp4|flv)/i.test(raw)) {
            return {
                urls: [{ name: "HD", url: raw }],
                parse: 0,
                flag: "play",
                header: { "User-Agent": UA }
            };
        }

        // 提取 embed UUID
        var embedUuid = raw;
        if (raw.indexOf("embed/") !== -1) {
            var m = raw.match(/embed\/([a-f0-9-]+)/i);
            if (m) embedUuid = m[1];
        } else if (raw.indexOf("-") === -1 && /^\d+$/.test(raw)) {
            // 纯数字 video_id，查 TW.video_id -> iframe 映射找不到，只能走 embed 拼 UUID
            // 此处 raw 应为 embed UUID
        }

        var embedUrl = HOST + "/embed/" + embedUuid;

        // OK影视 端 (parse:1 客户端嗅探)
        if (context && context.from === "mobile") {
            return {
                urls: [{ name: "播放", url: embedUrl }],
                parse: 1,
                flag: "play",
                header: { "User-Agent": UA, "Referer": HOST + "/" }
            };
        }

        // Web 端 + 其他客户端：正则提取 m3u8，CDN 支持 CORS 直连，不传 header 避免触发代理
        var embedHtml = await httpGet(embedUrl);
        var m3u8Match = embedHtml.match(/"file"\s*:\s*"([^"]+\.m3u8)"/);
        if (m3u8Match) {
            var m3u8Url = m3u8Match[1].replace(/\\\//g, "/");
            return {
                urls: [{ name: "HD", url: m3u8Url }],
                parse: 0,
                flag: "play"
            };
        }

        // 兜底：返回 embed URL parse:1
        return {
            urls: [{ name: "播放", url: embedUrl }],
            parse: 1,
            flag: "play",
            header: { "User-Agent": UA, "Referer": HOST + "/" }
        };
    } catch (e) {
        log("error", "play: " + e.message);
        return { urls: [], parse: 0, flag: "play" };
    }
}

// ═══════════════════════════════════════════
module.exports = { home, category, search, detail, play };
require("spider_runner").run(module.exports);
