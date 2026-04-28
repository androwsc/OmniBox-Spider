// @name hentaiworld.tv
// @version 1.0.0
// @changelog
// - v1.0.0: 初始版本
// @downloadURL https://github.com/your-repo/hentaiworld.tv.js
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/Hentaiworld.js


const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://hentaiworld.tv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.102 Safari/537.36";

const CLASSES = [
    { type_id: "all-episodes", type_name: "All Episodes" },
    { type_id: "uncensored", type_name: "Uncensored" },
    { type_id: "3d-rule34-hentai", type_name: "3D Rule34 Hentai" },
    { type_id: "most-viewed", type_name: "Most Watched" },
    { type_id: "preview", type_name: "Preview" }
];

function log(level, msg) {
    OmniBox.log(level, "[hentaiworld] " + msg);
}

function cleanText(t) {
    return (t || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function formatPic(pic) {
    if (!pic) return "";
    if (pic.startsWith("//")) return "https:" + pic;
    if (pic.startsWith("http")) return pic;
    return HOST + (pic.charAt(0) === "/" ? "" : "/") + pic;
}

async function httpGet(url, extraHeaders) {
    var headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": HOST + "/",
        "Connection": "keep-alive"
    };
    if (extraHeaders) {
        Object.keys(extraHeaders).forEach(function(k) { headers[k] = extraHeaders[k]; });
    }
    var res = await OmniBox.request(url, { method: "GET", headers: headers, timeout: 15000 });
    return res.body || "";
}

function extractCdnUrl(html) {
    var m = html.match(/window\.open\(\'([^)]+\.mp4)/);
    if (m && m[1]) return m[1].replace(/\\\//g, "/");
    var iframeM = html.match(/iframe\.setAttribute\([\'\"](?:src|[^\'\"]*src[^\'\"]*)[\'\"]\s*,\s*[\'\"](https?:\/\/[^\'\"]+)[\'\"]/i);
    if (iframeM && iframeM[1]) {
        var src = iframeM[1];
        var fnameM = src.match(/videos=([^\&\?\s]+(?:\.mp4)?)/);
        if (fnameM && fnameM[1]) {
            return "https://www.porn-d.xyz/TbLwA66UuPu4LiuOCsKr/videos/" + fnameM[1];
        }
    }
    return "";
}

function parseCards($, html) {
    var list = [];
    $(".card-container[href*='/hentai-videos/']", html).each(function() {
        var $a = $(this);
        var href = $a.attr("href") || "";
        var m = href.match(/\/hentai-videos\/([^\/]+)\/?$/);
        if (!m) return;
        var title = $a.attr("title") || $a.find("img").attr("alt") || "";
        var pic = $a.find("img").attr("src") || "";
        if (pic.indexOf("data:image") !== -1) pic = "";
        list.push({
            vod_id: m[1],
            vod_name: cleanText(title),
            vod_pic: formatPic(pic),
            vod_remarks: "",
            type_id: "all-episodes",
            type_name: "All Episodes",
            link: href,
            vod_year: "", vod_director: "", vod_actor: "", vod_content: ""
        });
    });
    return list;
}

function parseSwipers($) {
    var list = [];
    $(".swiper-slide a[href*='/hentai-videos/']").each(function() {
        var $a = $(this);
        var href = $a.attr("href") || "";
        var m = href.match(/\/hentai-videos\/([^\/]+)\/?$/);
        if (!m) return;
        var title = $a.attr("title") || $a.find("img").attr("alt") || "";
        var pic = $a.find("img").attr("data-src") || $a.find("img").attr("src") || "";
        if (pic.indexOf("data:image") !== -1) pic = "";
        list.push({
            vod_id: m[1],
            vod_name: cleanText(title),
            vod_pic: formatPic(pic),
            vod_remarks: "",
            type_id: "all-episodes",
            type_name: "All Episodes",
            link: href,
            vod_year: "", vod_director: "", vod_actor: "", vod_content: ""
        });
    });
    return list;
}

// ─── home ─────────────────────────────────
async function home(params, context) {
    try {
        var html = await httpGet(HOST + "/");
        var $ = cheerio.load(html);
        var list = parseCards($, html);
        if (list.length === 0) list = parseSwipers($);
        return { class: CLASSES, list: list.slice(0, 30) };
    } catch (e) {
        log("error", "home: " + e.message);
        return { class: CLASSES, list: [] };
    }
}

// ─── category ─────────────────────────────
async function category(params, context) {
    try {
        var id = (params.t || params.categoryId || params.id || "all-episodes").toString();
        var pg = parseInt(params.pg || params.page || 1) || 1;
        var tag = (params.tag || params.tagName || "").toString();
        var url;
        if (tag) {
            url = pg > 1 ? HOST + "/hentai-videos/tag/" + tag + "/page/" + pg + "/" : HOST + "/hentai-videos/tag/" + tag + "/";
        } else {
            url = pg > 1 ? HOST + "/" + id + "/page/" + pg + "/" : HOST + "/" + id + "/";
        }
        var html = await httpGet(url);
        var $ = cheerio.load(html);
        var list = parseCards($, html);
        var pagecount = 1;
        var pageMatches = (html.match(/href='https:\/\/hentaiworld.tv\/[^'\/]+\/page\/(\d+)\/'/g) || []);
        var nums = [];
        pageMatches.forEach(function(s) {
            var n = s.match(/(\d+)/);
            if (n) nums.push(parseInt(n[1]));
        });
        if (nums.length > 0) pagecount = Math.max.apply(null, nums);
        return { list: list, page: pg, pagecount: pagecount || 1 };
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
        var url = HOST + "/?s=" + encodeURIComponent(keyword) + (pg > 1 ? "&paged=" + pg : "");
        var html = await httpGet(url);
        var $ = cheerio.load(html);
        var list = parseCards($, html);
        var pagecount = 1;
        var pageMatches = (html.match(/href='https:\/\/hentaiworld.tv\/[^'\/]+\/page\/(\d+)\/'/g) || []);
        var nums = [];
        pageMatches.forEach(function(s) {
            var n = s.match(/(\d+)/);
            if (n) nums.push(parseInt(n[1]));
        });
        if (nums.length > 0) pagecount = Math.max.apply(null, nums);
        return { list: list, page: pg, pagecount: pagecount || 1 };
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

        var url = HOST + "/hentai-videos/" + id + "/";
        var html = await httpGet(url);
        var $ = cheerio.load(html);

        var title = cleanText($("h1.entry-title").first().text()) ||
                    cleanText($("meta[property='og:title']").attr("content") || "");
        var pic = $("meta[property='og:image']").attr("content") || "";
        var desc = cleanText($("meta[name='description']").attr("content") || "") ||
                   cleanText($("meta[property='og:description']").attr("content") || "");

        var tags = [];
        $("a[href*='/tag/']").each(function() {
            var t = cleanText($(this).text());
            if (t) tags.push(t);
        });
        var categoryName = cleanText($("span.cat-links a, .category-links a").first().text() || "") || "Hentai";

        var cdnUrl = extractCdnUrl(html);
        var playSources = [];
        if (cdnUrl) {
            playSources.push({
                name: "Primary",
                episodes: [{ name: "1080p", playId: cdnUrl }]
            });
            playSources.push({
                name: "Backup",
                episodes: [{ name: "1080p", playId: cdnUrl.replace("www.porn-d.xyz", "jav-trailers.com") }]
            });
        }

        return {
            list: [{
                vod_id: id,
                vod_name: title || id,
                vod_pic: formatPic(pic),
                vod_remarks: "",
                type_id: "all-episodes",
                type_name: categoryName,
                link: url,
                vod_content: desc,
                vod_tag: tags.join(", "),
                vod_play_sources: playSources.length > 0 ? playSources : []
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

        if (/\.(m3u8|mp4|flv)/i.test(raw)) {
            return {
                urls: [{ name: "1080p", url: raw }],
                parse: 0,
                flag: "play",
                header: { "User-Agent": UA }
            };
        }

        var detailSlug = raw;
        if (raw.indexOf("http") === 0) {
            var m = raw.match(/\/hentai-videos\/([^\/]+)\/?/);
            if (m) detailSlug = m[1];
        }

        var detailUrl = HOST + "/hentai-videos/" + detailSlug + "/";
        var html = await httpGet(detailUrl);
        var cdnUrl = extractCdnUrl(html);
        if (cdnUrl) {
            return {
                urls: [{ name: "1080p", url: cdnUrl }],
                parse: 0,
                flag: "play",
                header: { "User-Agent": UA }
            };
        }

        return { urls: [], parse: 0, flag: "play" };
    } catch (e) {
        log("error", "play: " + e.message);
        return { urls: [], parse: 0, flag: "play" };
    }
}

// ═══════════════════════════════════════════
module.exports = { home, category, search, detail, play };
require("spider_runner").run(module.exports);
