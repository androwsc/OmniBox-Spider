// @name MemoJav 优化版
// @version 2.3.0
// @description OmniBox 影视爬虫 - MemoJav JAV 站点，支持分类/最佳/最新
// @indexs 0
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/MemoJav.js
// ========================================
// @changelog
// v2.3.0 (2026-04-14) - 全面修复：@indexs 0；演员名空格合并；去掉无意义video分类；play直连m3u8
// v2.2.0 (2026-04-14) - 修复演员名含/被TVBox分开；httpGet增加3次TLS重试；默认分类从video改为best
// v2.1.0 (2026-04-14) - 修正TVBox字段: vod_actor显示演员名、vod_remarks保留元数据格式、去除无效字段
// v1.9.0 - 去除缓存(kv可能阻塞)、修复演员头像提取
// v1.7.0 - 新增8个分类、禁用搜索(谷歌不可爬)
// ========================================

const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://memojav.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

// ========================================
// 工具函数
// ========================================
function formatPic(pic) {
    if (!pic) return "";
    if (pic.startsWith("//")) return "https:" + pic;
    if (pic.startsWith("http")) return pic;
    return HOST + (pic.startsWith("/") ? "" : "/") + pic;
}

// 1. 去HTML标签  2. 替换/分隔符为空格（TVBox按/分割演员名）  3. 规范化空白
function cleanText(html) {
    if (!html) return "";
    var t = String(html).replace(/<[^>]+>/g, "");
    t = t.replace(/\s*\/\s*/g, " ");
    return t.replace(/\s+/g, " ").trim();
}

// 从 "ID • STUDIO • Actress" 元数据中提演员名（可能含多个用逗号分隔）
function extractActressFromMeta(meta) {
    var parts = meta.split("•");
    if (parts.length < 3) return "";
    var actress = parts[parts.length - 1].trim();
    if (!actress || actress.length > 100) return "";
    return actress;
}

// ========================================
// 分类配置
// ========================================
var CLASSES = [
    { type_id: "best",                      type_name: "最佳" },
    { type_id: "categories/big-tits-lover", type_name: "Big Tits Lover" },
    { type_id: "categories/big-tits",       type_name: "Big Tits" },
    { type_id: "categories/bodysuit",        type_name: "Bodysuit" },
    { type_id: "categories/mature-woman",   type_name: "Mature Woman" },
    { type_id: "categories/stepfamily",     type_name: "Stepfamily" },
    { type_id: "categories/outdoor",        type_name: "Outdoor" },
    { type_id: "categories/milf",           type_name: "MILF" },
    { type_id: "categories/documentary",    type_name: "Documentary" },
];

// ----------------------------------------
// HTTP 请求（3次TLS重试）
// ----------------------------------------
async function httpGet(url) {
    var path = url;
    if (!path.startsWith("http")) path = HOST + (path.startsWith("/") ? "" : "/") + path;
    var lastErr = "";
    for (var i = 0; i < 3; i++) {
        try {
            var res = await OmniBox.request(path, {
                method: "GET",
                headers: { "User-Agent": UA, Referer: HOST + "/" },
                timeout: 12000
            });
            return res.body || "";
        } catch (e) {
            lastErr = e.message;
        }
    }
    OmniBox.log("error", "[MemoJav] HTTP失败 " + path + ": " + lastErr);
    return "";
}

// ========================================
// 列表解析
// DOM: <a href="/video/ID" class="video-item">
//   <img class="video-poster" src="...">
//   <div class="video-metadata">ID • STUDIO • Actress</div>
//   <div class="video-title">Full Title</div>
// </a>
// ========================================
function parseList(html, limit) {
    limit = limit || 20;
    if (!html) return [];
    var $ = cheerio.load(html);
    var list = [];
    var seen = {};

    $("a.video-item").each(function(i, el) {
        if (list.length >= limit) return false;
        var $el = $(el);
        var href = $el.attr("href") || "";
        var m = href.match(/\/video\/([A-Z]+-\d+[A-Z]?)$/i);
        if (!m) return true;
        var vodId = m[1].toUpperCase();
        if (seen[vodId]) return true;
        seen[vodId] = 1;

        var imgEl = $el.find("img.video-poster").first();
        var imgSrc = formatPic(imgEl.attr("src") || imgEl.attr("data-src") || "");

        var meta = $el.find(".video-metadata").text().trim();
        var title = $el.find(".video-title").first().text().trim();

        list.push({
            vod_id: vodId,
            vod_name: title || vodId,
            vod_pic: imgSrc,
            vod_remarks: meta
        });
    });
    return list;
}

// ----------------------------------------
// 页码解析
// ----------------------------------------
function parsePageCount(html, pg) {
    var pageCount = pg || 1;
    var m = html.match(/pageNav-page--current[^>]*>.*?page-(\d+)/);
    if (m) pageCount = parseInt(m[1]);
    var pages = html.match(/page-(\d+)/g) || [];
    for (var p of pages) {
        var n = parseInt(p.replace("page-", ""));
        if (n > pageCount) pageCount = n;
    }
    return pageCount || 1;
}

// ========================================
// 1. 首页 - 返回分类
// ========================================
async function home(params, context) {
    return { class: CLASSES };
}

// ========================================
// 2. 分类列表
// ========================================
async function category(params, context) {
    var tid = (params.t || params.tid || params.categoryId || params.id || "best").toString();
    var pg = parseInt(params.pg || params.page || 1) || 1;

    // ac=detail 透传
    if (params.ac === "detail") return detail({ id: tid }, context);

    // video 旧分类重定向 best
    if (tid === "video") tid = "best";

    var url;
    if (tid === "best") {
        url = pg === 1 ? "/best/" : "/best/page-" + pg;
    } else {
        url = pg === 1 ? "/" + tid + "/" : "/" + tid + "/page-" + pg;
    }

    var html = await httpGet(url);
    var list = parseList(html, 20);
    return { list: list, page: pg, pagecount: parsePageCount(html, pg) };
}

// ========================================
// 3. 详情页
// 提取：标题/海报/简介/演员/导演/年份/发行/Categories/Studio
// ========================================
async function detail(params, context) {
    var id = params.videoId || params.id || params.ids || "";
    if (Array.isArray(id)) id = id[0];
    if (!id) return { list: [] };
    id = String(id).toUpperCase();

    var html = await httpGet("/video/" + id);
    if (!html) return { list: [] };

    var $ = cheerio.load(html);

    // ---------- 标题 ----------
    var vodName = $("#title").first().text().replace(/\s*\|.+$/, "").trim() || id;

    // ---------- 海报 ----------
    var vodPic = formatPic($("meta[property='og:image']").attr("content") || "");

    // ---------- 简介 ----------
    var vodContent = $("meta[property='og:description']").attr("content") || "";

    // ---------- 演员 ----------
    var actressName = "";
    $("table tr").each(function() {
        var th = $(this).find("th").text().trim();
        if (th !== "Actress:") return;
        var $a = $(this).find("td a[href*='/actress/']").first();
        if ($a.length) {
            actressName = cleanText($a.find(".description-vertical").text()) || cleanText($a.text());
        }
    });

    // ---------- 导演 ----------
    var vodDirector = "";
    $("table tr").each(function() {
        if ($(this).find("th").text().trim() === "Director:") {
            vodDirector = cleanText($(this).find("td").text());
        }
    });

    // ---------- 年份 & 发行日期 ----------
    var vodYear = "";
    var releaseDate = "";
    $("table tr").each(function() {
        if ($(this).find("th").text().trim() === "Release Date:") {
            var txt = $(this).find("td").text().trim();
            var ym = txt.match(/(\d{4})/);
            if (ym) vodYear = ym[1];
            releaseDate = cleanText(txt);
        }
    });

    // ---------- Studio ----------
    var studioName = "";
    $("table tr").each(function() {
        if ($(this).find("th").text().trim() === "Studio:") {
            var $td = $(this).find("td");
            studioName = cleanText($td.find(".description-vertical").text()) || cleanText($td.text());
        }
    });

    // ---------- Categories (用于跳转) ----------
    var categories = [];
    $("table tr").each(function() {
        if ($(this).find("th").text().trim() === "Categories:") {
            $(this).find("td a[href*='/categories/']").each(function() {
                var catHref = $(this).attr("href") || "";
                var catName = cleanText($(this).text());
                var m = catHref.match(/\/categories\/([^\/]+)/);
                if (m && catName) {
                    categories.push({ name: catName, id: "categories/" + m[1] });
                }
            });
        }
    });

    // ---------- vod_remarks: ID • Studio • Actress • Date ----------
    var remarks = id;
    if (studioName) remarks += " • " + studioName;
    if (actressName) remarks += " • " + actressName;
    if (releaseDate) remarks += " • " + releaseDate;

    // ---------- 固定流地址 ----------
    var m3u8Url = "https://video10.memojav.net/stream/" + id + "/master.m3u8";

    // ---------- 组装 episodes ----------
    var episodes = [{ name: "正片", playId: m3u8Url }];

    var result = {
        list: [{
            vod_id: id,
            vod_name: vodName,
            vod_pic: vodPic,
            vod_remarks: remarks,
            vod_actor: actressName,
            vod_director: vodDirector,
            vod_year: vodYear,
            vod_content: vodContent,
            // Categories 供 TVBox UI 显示（点击可跳转对应分类）
            type: categories.map(function(c) { return c.name; }).join(" / "),
            vod_play_sources: [{
                name: "默认线路",
                episodes: episodes
            }]
        }]
    };

    // 附加播放页演员头像和Categories跳转信息（非TVBox标准字段，TVBox忽略）
    if (actressName) {
        result.list[0].vod_actor_pic = "https://pics.dmm.co.jp/mono/actjpgs/" +
            actressName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "") + ".jpg";
        result.list[0].vod_actor_url = HOST + "/actress/" +
            actressName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    if (categories.length > 0) {
        result.list[0].vod_categories = categories;
    }

    return result;
}

// ========================================
// 4. 搜索 (禁用 - 谷歌搜索无法服务端爬)
// ========================================
async function search(params, context) {
    return { list: [] };
}

// ========================================
// ========================================
// 5. 播放
// 双端策略：
//   - TVBox/猫vod：返回 embed URL，parse:1 客户端嗅探
//   - Web/App：OmniBox 代理直链 m3u8，parse:0
// ========================================
async function play(params, context) {
    var id = params.playId || params.url || "";
    if (!id) return { urls: [], parse: 1 };

    var from = context?.from || "web";
    var isTVBox = ["tvbox", "catvod"].includes(from);

    // 已经是完整 m3u8/mp4 链接
    if (/\.(m3u8|mp4)(\?|$)/i.test(id)) {
        if (isTVBox) {
            return { urls: [{ name: "默认线路", url: id }], parse: 1 };
        }
        return {
            urls: [{ name: "默认线路", url: id }],
            parse: 0,
            header: { "User-Agent": UA, Referer: HOST + "/" }
        };
    }

    // embed 播放页 URL（TVBox 客户端嗅探用）
    if (isTVBox) {
        // 构造 embed URL（ID 需转为小写）
        var embedId = id.toLowerCase();
        var embedUrl = HOST + "/embed/" + embedId;
        return {
            urls: [{ name: "默认线路", url: embedUrl }],
            parse: 1,
            header: { "User-Agent": UA, Referer: HOST + "/" }
        };
    }

    // Web/App：OmniBox 代理直链，带 header 走透明代理
    var m3u8Url = "https://video10.memojav.net/stream/" + id.toUpperCase() + "/master.m3u8";
    return {
        urls: [{ name: "默认线路", url: m3u8Url }],
        parse: 0,
        header: { "User-Agent": UA, Referer: HOST + "/" }
    };
}

module.exports = { home, category, detail, search, play };
require("spider_runner").run(module.exports);
