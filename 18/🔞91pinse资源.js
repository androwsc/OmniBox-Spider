// @name 91pinse.com
// @version 1.2.0
// @description 91pinse.com 爬虫 - 最新/热门/榜单/搜索，双端分流
// @changelog v1.2.0 双端分流：Web用sniffVideo提取直链(parse:0)，客户端embed+parse:1
// @changelog v1.1.0 home返回空列表(去推荐)、双端分流策略
// @changelog v1.0.0 初始版本，基于真实DOM结构编写
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/91pinse.js

const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://api.hop.qzz.io/p/oect?url=https://91pinse.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CLASSES = [
    { type_id: "latest", type_name: "最新视频" },
    { type_id: "hot", type_name: "热门视频" },
    { type_id: "rank", type_name: "热门榜单" }
];

// ─── 工具函数 ─────────────────────────────
function log(level, msg) {
    OmniBox.log(level, "[91pinse] " + msg);
}

function cleanText(html) {
    return (html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function processImageUrl(imageUrl) {
    if (!imageUrl) return "";
    if (imageUrl.indexOf("//") === 0) return "https:" + imageUrl;
    if (imageUrl.indexOf("http") === 0) return imageUrl;
    return "";
}

async function httpGet(url, referer) {
    var headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Connection": "keep-alive"
    };
    if (referer) headers["Referer"] = referer;
    var res = await OmniBox.request(url, { method: "GET", headers: headers, timeout: 15000 });
    return res.body || "";
}

// ─── 列表解析 ─────────────────────────────
// Tailwind 模板 DOM：
// <div class="group">
//   <a href="/v/{id}">
//     <div class="aspect-video">
//       <img src="..." alt="标题">
//       <span>0:00:59 HD</span>
//     </div>
//   </a>
// </div>
function parseList(html) {
    var $ = cheerio.load(html);
    var list = [];
    var seenIds = {};

    $("div.group").each(function () {
        var $group = $(this);
        var $a = $group.find("a[href*='/v/']").first();
        if (!$a.length) return;

        var href = $a.attr("href") || "";
        var idMatch = href.match(/\/v\/(\d+)/);
        if (!idMatch) return;
        var id = idMatch[1];
        if (id.length < 5) return;
        if (seenIds[id]) return;
        seenIds[id] = true;

        var title = cleanText($group.find("img").first().attr("alt") || "");
        var remarks = cleanText($group.find("span").first().text() || "");
        var pic = processImageUrl($group.find("img").first().attr("src") || "");

        list.push({
            vod_id: id,
            vod_name: title || ("Video " + id),
            vod_pic: pic,
            type_id: "latest",
            type_name: "最新视频",
            vod_remarks: remarks,
            vod_year: "",
            vod_director: "",
            vod_actor: "",
            vod_content: ""
        });
    });

    return list;
}

function parsePageCount(html) {
    var pages = [];
    var re = /(\d{4,6})\s*页/g, m;
    while ((m = re.exec(html)) !== null) pages.push(parseInt(m[1]));
    if (pages.length > 0) return Math.max.apply(null, pages);

    var $ = cheerio.load(html);
    $("a[href*='page=']").each(function () {
        var t = $(this).text() || "";
        var n = parseInt(t);
        if (n > 1) pages.push(n);
    });
    return pages.length > 0 ? Math.max.apply(null, pages) : 1;
}

// ─── home ─────────────────────────────────
async function home(params, context) {
    // 只返回分类，去掉推荐列表
    return { class: CLASSES, list: [] };
}

// ─── category ─────────────────────────────
async function category(params, context) {
    try {
        var id = (params.t || params.categoryId || params.id || "latest").toString();
        var pg = parseInt(params.pg || params.page || 1) || 1;
        var url;
        if (id === "latest") url = HOST + "/v/" + (pg > 1 ? "?page=" + pg : "");
        else if (id === "hot") url = HOST + "/v/hot/" + (pg > 1 ? "?page=" + pg : "");
        else if (id === "rank") url = HOST + "/rank/current-hot" + (pg > 1 ? "?page=" + pg : "");
        else url = HOST + "/" + id + (pg > 1 ? "?page=" + pg : "");

        var html = await httpGet(url);
        var list = parseList(html);
        var pagecount = parsePageCount(html);
        return { list: list, page: pg, pagecount: pagecount };
    } catch (e) {
        log("error", "category failed: " + e.message);
        return { list: [], page: 1, pagecount: 1 };
    }
}

// ─── search ───────────────────────────────
async function search(params, context) {
    try {
        var keyword = (params.keyword || params.wd || "").trim();
        if (!keyword) return { list: [] };
        var pg = parseInt(params.pg || params.page || 1) || 1;
        var url = HOST + "/v/search?keyword=" + encodeURIComponent(keyword) + (pg > 1 ? "&page=" + pg : "");
        var html = await httpGet(url);
        var list = parseList(html);
        var pagecount = parsePageCount(html);
        return { list: list, page: pg, pagecount: pagecount };
    } catch (e) {
        log("error", "search failed: " + e.message);
        return { list: [] };
    }
}

// ─── detail ───────────────────────────────
async function detail(params, context) {
    try {
        var id = (params.videoId || params.id || params.ids || "").toString();
        if (Array.isArray(id)) id = id[0];
        if (!id) return { list: [] };

        var detailUrl = HOST + "/v/" + id + "/";
        var html = await httpGet(detailUrl);
        var $ = cheerio.load(html);

        // 标题：og:title（h1=404时用og:title兜底）
        var title = cleanText($("meta[property='og:title']").attr("content") || "") ||
                     cleanText($("h1").first().text()) || "";
        title = title.replace(/\s*后续完整版请进群\s*$/, "").trim();

        // 封面
        var pic = processImageUrl($("meta[property='og:image']").attr("content") || "");

        // 时长
        var duration = "";
        var jsonLd = html.match(/"duration"\s*:\s*"([^"]+)"/)?.[1] || "";
        if (jsonLd) duration = jsonLd.replace("PT", "").toLowerCase();
        if (!duration) {
            var dm = $("timer, .duration, [class*=duration]").first().text().match(/(\d+:\d+(:\d+)?)/);
            if (dm) duration = dm[1];
        }

        // 作者
        var author = "";
        var authorMatch = html.match(/href\s*=\s*["']\/v\/author\/[^"']+["'][^>]*>([^<]+)<\/a>/);
        if (authorMatch) author = cleanText(authorMatch[1]);

        // 双端分流：
        // - 客户端（from!=web）：返回 embed URL + parse:1，让客户端嗅探
        // - Web 端：返回 embed URL，play() 里用 sniffVideo 提取直链
        var from = context?.from || "web";
        var embedUrl = HOST + "/v/" + id + "/";

        return {
            list: [{
                vod_id: id,
                vod_name: title || ("Video " + id),
                vod_pic: pic,
                type_id: "latest",
                type_name: "最新视频",
                vod_remarks: duration,
                vod_year: "",
                vod_director: "",
                vod_actor: author,
                vod_content: "",
                link: detailUrl,
                vod_play_sources: [{
                    name: "HLS 线路",
                    episodes: [{ name: duration || "播放", playId: embedUrl }]
                }]
            }]
        };
    } catch (e) {
        log("error", "detail failed: " + e.message);
        return { list: [] };
    }
}

// ─── play ─────────────────────────────────
// 双端分流：
// - Web 端 (from=web)：sniffVideo 提取直链 + parse:0 + Referer
// - 客户端 (from!=web)：透传 embed URL + parse:1（让客户端嗅探）
async function play(params, context) {
    try {
        var raw = (params.playId || params.url || "").toString();
        if (!raw) return { urls: [], parse: 0, flag: "play" };

        var from = context?.from || "web";

        // 客户端透传：直接返回 embed URL + parse:1
        if (from !== "web") {
            return {
                urls: [{ name: "HLS 线路", url: raw }],
                parse: 1,
                flag: "play"
            };
        }

        // Web 端：用 sniffVideo 提取直链
        var embedUrl = raw.indexOf("91pinse.com") !== -1 ? raw : (HOST + "/v/" + raw + "/");

        var sniffResult = await OmniBox.sniffVideo(embedUrl, {
            "User-Agent": UA,
            "Referer": embedUrl
        });

        if (sniffResult && sniffResult.url) {
            var header = {
                "User-Agent": UA,
                "Referer": embedUrl,
                "Origin": HOST
            };
            return {
                urls: [{ name: "HLS 线路", url: sniffResult.url }],
                parse: 0,
                flag: "play",
                header: sniffResult.header || header
            };
        }

        return { urls: [], parse: 0, flag: "play" };
    } catch (e) {
        log("error", "play failed: " + e.message);
        return { urls: [], parse: 0, flag: "play" };
    }
}

// ═══════════════════════════════════════════
module.exports = { home, category, search, detail, play };
require("spider_runner").run(module.exports);
