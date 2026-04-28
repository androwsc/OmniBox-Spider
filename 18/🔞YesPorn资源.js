// @name YesPorn
// @version 1.7.0
// @description YesPorn.vip - KVS成人站聚合
// @changelog
// 1.7.0 (2026-04-18) 基于v1.1.0：去掉推荐分类，单线路720p，双端分流
// 1.1.0 (2026-04-18) 双端分流：App端parse:1秒开，Web端sniffVideo直链
// 1.0.0 (2026-04-18) 初始版本，支持分类/列表/详情/搜索/播放
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/main/NEW/YesPorn.js


const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://yesporn.vip";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept": "text/html", "Connection": "keep-alive" };

// ─── 分类定义 ─────────────────────────────
var CLASSES = [
    { type_id: "latest", type_name: "首页最新" },
    { type_id: "onlyfans", type_name: "Onlyfans" },
    { type_id: "vixen-g7g6z5", type_name: "Vixen" },
    { type_id: "puretaboo-g7g6z5", type_name: "pureTaboo" }
];

// ─── 工具函数 ─────────────────────────────
function log(level, msg) {
    OmniBox.log(level, "[yesporn] " + msg);
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

function getVideoId(href) {
    if (!href) return "";
    var m = href.match(/\/video\/(\d+)\//);
    return m ? m[1] : "";
}

function extractGroup(id) {
    // 68498 -> 68000 (KVS group = floor(id/1000)*1000)
    var n = parseInt(id) || 0;
    return String(Math.floor(n / 1000) * 1000);
}

async function httpGet(url, headers) {
    var opts = { method: "GET", headers: {}, timeout: 15000 };
    for (var k in HEADERS) opts.headers[k] = HEADERS[k];
    if (headers) {
        for (var k2 in headers) opts.headers[k2] = headers[k2];
    }
    opts.headers["Connection"] = "keep-alive";
    var res = await OmniBox.request(url, opts);
    // 处理301/302重定向（OmniBox不自动跟随）
    if ((res.statusCode === 301 || res.statusCode === 302) && res.headers) {
        var loc = res.headers.location || res.headers.Location || "";
        if (loc) {
            if (loc.charAt(0) === "/") loc = HOST + loc;
            log("info", "httpGet: " + res.statusCode + " -> " + loc);
            res = await OmniBox.request(loc, opts);
        }
    }
    return res.body || "";
}

// ─── 解析视频列表 ─────────────────────────
function parseList(html, limit) {
    var $ = cheerio.load(html);
    var list = [];
    $("div.thumb.item, div.thumb_rel.item").each(function () {
        if (limit && list.length >= limit) return false;
        var $el = $(this);
        var $a = $el.find("a[href*='/video/']").first();
        var href = $a.attr("href") || "";
        var id = getVideoId(href);
        if (!id) return;

        var $img = $el.find("img").first();
        var pic = formatPic($img.attr("data-original") || $img.attr("src") || "");
        var title = cleanText($a.attr("title") || $img.attr("alt") || "");
        var duration = cleanText($el.find(".item-bottom .time").text() || "");
        var quality = cleanText($el.find(".item-bottom .qualtiy").text() || "");

        list.push({
            vod_id: id,
            vod_name: title,
            vod_pic: pic,
            vod_remarks: quality ? (duration + " " + quality) : duration,
            vod_year: "",
            vod_director: "",
            vod_actor: "",
            vod_content: ""
        });
    });
    return list;
}

// ─── 解析分页参数 ─────────────────────────
function parsePagination(html) {
    var maxPage = 1;
    var matches = html.match(/data-parameters="[^"]*from:(\d+)"/g);
    if (matches) {
        for (var i = 0; i < matches.length; i++) {
            var m = matches[i].match(/from:(\d+)/);
            if (m) {
                var p = parseInt(m[1]);
                if (p > maxPage) maxPage = p;
            }
        }
    }
    return maxPage;
}

// ─── 带重定向跟踪的请求 ───────────────────
async function httpGetWithRedirect(url, headers) {
    var opts = { method: "GET", headers: {}, timeout: 15000 };
    for (var k in HEADERS) opts.headers[k] = HEADERS[k];
    if (headers) {
        for (var k2 in headers) opts.headers[k2] = headers[k2];
    }
    opts.headers["Connection"] = "keep-alive";
    var finalUrl = url;
    var res = await OmniBox.request(url, opts);
    // 处理301/302重定向（OmniBox不自动跟随）
    if ((res.statusCode === 301 || res.statusCode === 302) && res.headers) {
        var loc = res.headers.location || res.headers.Location || "";
        if (loc) {
            if (loc.charAt(0) === "/") loc = HOST + loc;
            finalUrl = loc;
            log("info", "redirect: " + res.statusCode + " -> " + loc);
            res = await OmniBox.request(loc, opts);
        }
    }
    return { body: res.body || "", finalUrl: finalUrl };
}

// ─── 解析AJAX分页URL ─────────────────────
function extractAjaxInfo(html, baseUrl) {
    var $ = cheerio.load(html);
    var result = { blockId: "", ajaxUrl: baseUrl };
    // 从分页链接提取 data-block-id 和 data-parameters
    var $pagLink = $('[data-action="ajax"][data-parameters*="from:"]').first();
    if ($pagLink.length) {
        result.blockId = $pagLink.attr("data-block-id") || "";
        // 提取容器基础URL（去掉查询参数）
        var base = baseUrl.split("?")[0];
        result.ajaxUrl = base;
    }
    return result;
}

// ─── home ─────────────────────────────────
async function home(params, context) {
    return { class: CLASSES, list: [] };
}

// ─── category ─────────────────────────────
async function category(params, context) {
    try {
        var id = (params.t || params.categoryId || params.id || "latest").toString();
        var pg = parseInt(params.pg || params.page || 1) || 1;

        // 构造初始URL
        var pageUrl, blockId;
        if (id === "latest") {
            pageUrl = HOST + "/";
            blockId = "list_videos_most_recent_videos";
        } else {
            pageUrl = HOST + "/channels/" + id + "/";
            blockId = "list_videos_common_videos_list";
        }

        var html, finalUrl;

        if (pg <= 1) {
            // 第1页：直接请求，跟踪301
            var result = await httpGetWithRedirect(pageUrl);
            html = result.body;
            finalUrl = result.finalUrl;
            // 从页面提取实际block_id
            var ajaxInfo = extractAjaxInfo(html, finalUrl);
            if (ajaxInfo.blockId) blockId = ajaxInfo.blockId;
        } else {
            // 第2+页：先请求第1页获取最终URL和block_id，再发AJAX
            var result = await httpGetWithRedirect(pageUrl);
            var ajaxInfo = extractAjaxInfo(result.body, result.finalUrl);
            if (ajaxInfo.blockId) blockId = ajaxInfo.blockId;
            finalUrl = ajaxInfo.ajaxUrl || result.finalUrl;

            // AJAX分页
            var ts = Date.now();
            var ajaxUrl = finalUrl + "?mode=async&function=get_block&block_id=" + blockId +
                "&sort_by=post_date&from=" + pg + "&_=" + ts;
            html = await httpGet(ajaxUrl, { "X-Requested-With": "XMLHttpRequest" });
        }

        var list = parseList(html);
        var pagecount = parsePagination(html);
        if (pagecount < pg && list.length >= 20) pagecount = pg + 1;
        if (pagecount < 1) pagecount = 1;

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

        var searchUrl = HOST + "/search/?q=" + encodeURIComponent(keyword);
        if (pg > 1) {
            var ts = Date.now();
            searchUrl += "&mode=async&function=get_block&block_id=list_videos_common_videos_list" +
                "&sort_by=post_date&from=" + pg + "&_=" + ts;
        }

        var html = await httpGet(searchUrl, pg > 1 ? { "X-Requested-With": "XMLHttpRequest" } : {});
        var list = parseList(html);
        var pagecount = parsePagination(html);
        if (pagecount < pg && list.length >= 20) pagecount = pg + 1;
        if (pagecount < 1) pagecount = 1;

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
        // 兼容传入完整URL的情况
        var m = id.match(/\/video\/(\d+)\//);
        if (m) id = m[1];
        if (!/^\d+$/.test(id)) return { list: [] };

        // 并行请求embed页（元数据）+ 视频详情页（flashvars 1080p）
        var embedUrl = HOST + "/embed/" + id;
        var videoUrl = HOST + "/video/" + id + "/";
        var embedRes = await httpGetWithRedirect(embedUrl);
        var videoRes = await httpGetWithRedirect(videoUrl);
        var embedHtml = embedRes.body;
        var videoHtml = videoRes.body;

        // 从embed页提取元数据（更可靠）
        var $e = cheerio.load(embedHtml);
        var title = cleanText($e("meta[property='og:title']").attr("content") || "") ||
            cleanText($e("title").first().text()) || "";
        var pic = formatPic($e("meta[property='og:image']").attr("content") || "");
        var content = cleanText($e("meta[property='og:description']").attr("content") || "");

        // 从embed页JS变量提取信息（分类、演员、视频页URL）
        var categories = "";
        var models = "";
        var tags = "";
        var videoPageUrl = "";
        var jsVarMatch = embedHtml.match(/var\s+\w+\s*=\s*\{([\s\S]*?)\};/);
        if (jsVarMatch) {
            var jsText = jsVarMatch[1];
            var catM = jsText.match(/video_categories\s*:\s*'([^']+)'/);
            if (catM) categories = catM[1];
            var modM = jsText.match(/video_models\s*:\s*'([^']+)'/);
            if (modM) models = modM[1];
            var tagM = jsText.match(/video_tags\s*:\s*'([^']+)'/);
            if (tagM) tags = tagM[1];
            // 视频详情页URL（带slug）
            var altMatch = jsText.match(/video_alt_url\s*:\s*'([^']+)'/);
            if (altMatch) {
                videoPageUrl = altMatch[1];
                if (videoPageUrl.indexOf("function/0/") === 0) videoPageUrl = videoPageUrl.substring(11);
            }
        }

        // 从视频详情页提取flashvars获取1080p
        var playSources;
        if (videoPageUrl && videoPageUrl.indexOf("http") === 0) {
            var videoRes = await httpGetWithRedirect(videoPageUrl);
            var videoHtml = videoRes.body;
            playSources = parseFlashvars(videoHtml, id);
        }
        // 如果详情页没拿到flashvars，fallback到embed页
        if (!playSources || (playSources[0].episodes[0].playId === id)) {
            playSources = parseFlashvarsFromEmbed(embedHtml, id);
        }

        // 时长
        var durationSec = $e("meta[property='video:duration']").attr("content") || "";
        var remarks = "";
        if (durationSec) {
            var sec = parseInt(durationSec);
            var mm = Math.floor(sec / 60);
            var ss = sec % 60;
            remarks = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
        }

        return {
            list: [{
                vod_id: id,
                vod_name: title,
                vod_pic: pic,
                vod_remarks: remarks,
                vod_year: "",
                vod_director: categories || "",
                vod_actor: models || "",
                vod_content: content || tags || "",
                vod_play_sources: playSources
            }]
        };
    } catch (e) {
        log("error", "detail: " + e.message);
        return { list: [] };
    }
}

// ─── 从embed页解析播放地址（fallback）────
function parseFlashvarsFromEmbed(html, videoId) {
    var group = extractGroup(videoId);
    var jsVarMatch = html.match(/var\s+\w+\s*=\s*\{([\s\S]*?)\};/);
    if (!jsVarMatch) return [{ name: "默认线路", episodes: [{ name: "播放", playId: videoId }] }];

    var jsText = jsVarMatch[1];
    var episodes = [];

    // 480p - 直接get_file
    var url480 = jsText.match(/video_url\s*:\s*'([^']+)'/);
    if (url480) {
        var raw = url480[1];
        if (raw.indexOf("function/0/") === 0) raw = raw.substring(11);
        episodes.push({ name: "480p", playId: raw });
    }

    // 720p - 通过video_alt_url_redirect
    var altUrl = jsText.match(/video_alt_url\s*:\s*'([^']+)'/);
    var altRedirect = jsText.match(/video_alt_url_redirect\s*:\s*'([^']+)'/);
    if (altUrl && altRedirect && altRedirect[1] === "1") {
        // video_alt_url是视频页URL，redirect模式
        // 构造可能的1080p get_file URL
        var altRaw = altUrl[1];
        if (altRaw.indexOf("function/0/") === 0) altRaw = altRaw.substring(11);
        episodes.push({ name: "720p", playId: altRaw });
    }

    if (episodes.length === 0) {
        episodes.push({ name: "播放", playId: videoId });
    }

    return [{ name: "播放线路", episodes: episodes }];
}

// ─── 解析flashvars获取播放地址 ────────────
// 只返回720p一条线路
function parseFlashvars(html, videoId) {
    var fvMatch = html.match(/flashvars\s*=\s*\{([\s\S]*?)\};/);
    if (!fvMatch) return [{ name: "播放", episodes: [{ name: "720p", playId: videoId }] }];

    var fvText = fvMatch[1];

    // 只取720p
    var urlMatch = fvText.match(/video_alt_url\s*:\s*["']([^"']+)["']/);
    if (urlMatch) {
        var rawUrl = urlMatch[1];
        if (rawUrl.indexOf("function/0/") === 0) rawUrl = rawUrl.substring(11);
        return [{ name: "播放", episodes: [{ name: "默认", playId: rawUrl }] }];
    }

    return [{ name: "播放", episodes: [{ name: "默认", playId: videoId }] }];
}

// ─── play ─────────────────────────────────
// 双端分流：
//   App端 (TVBox/OK影视) → parse:1，客户端本地WebView加载embed页起播（秒开）
//   Web端 → sniffVideo服务端嗅探，返回直链 parse:0
async function play(params, context) {
    try {
        var raw = (params.playId || params.url || "").toString();
        if (!raw) return { urls: [], parse: 0 };

        // 提取视频ID
        var vid = "";
        var m = raw.match(/\/(\d+)(?:_\d+p)?\.mp4/);
        if (m) vid = m[1];
        if (!vid) {
            var m2 = raw.match(/\/(\d+)\//);
            if (m2) vid = m2[1];
        }

        // ── App端：parse:1 直接embed页 ──
        var from = (context && context.from) || "";
        if (from === "app" || from === "tvbox" || from === "uz" || from === "ok") {
            if (vid) {
                return {
                    urls: [{ name: "播放", url: HOST + "/embed/" + vid }],
                    parse: 1,
                    header: { "User-Agent": UA, "Referer": HOST + "/" }
                };
            }
            // 如果raw本身就是URL
            if (raw.indexOf("http") === 0) {
                return {
                    urls: [{ name: "播放", url: raw }],
                    parse: 1,
                    header: { "User-Agent": UA, "Referer": HOST + "/" }
                };
            }
            return { urls: [], parse: 0 };
        }

        // ── Web端：sniffVideo 获取直链 ──
        if (raw.indexOf("get_file") !== -1 && vid) {
            // 获取视频详情页URL
            var embedUrl2 = HOST + "/embed/" + vid;
            var sniffH = { "User-Agent": UA, "Referer": HOST + "/" };
            var embedBody = await httpGet(embedUrl2);
            var vPageUrl = "";
            var altM = embedBody.match(/video_alt_url\s*:\s*'([^']+)'/);
            if (altM) {
                vPageUrl = altM[1];
                if (vPageUrl.indexOf("function/0/") === 0) vPageUrl = vPageUrl.substring(11);
            }
            // 跟踪301
            if (vPageUrl && vPageUrl.indexOf("http") === 0) {
                try {
                    var hR = await OmniBox.request(vPageUrl, {method:"HEAD",headers:sniffH,timeout:10000});
                    if (hR && (hR.statusCode===301||hR.statusCode===302)) {
                        var l = (hR.headers||{}).location||"";
                        if (l) { if (l.charAt(0)==="/") l=HOST+l; vPageUrl=l; }
                    }
                } catch(e2) {}
            }
            // sniffVideo获取真实播放地址
            if (vPageUrl) {
                var sniffR = await OmniBox.sniffVideo(vPageUrl, sniffH);
                if (sniffR && sniffR.url) {
                    var q = sniffR.url.indexOf("1080p")!==-1 ? "1080p" :
                        sniffR.url.indexOf("720p")!==-1 ? "720p" : "480p";
                    return { urls:[{name:q,url:sniffR.url}], parse:0, header:sniffR.header||sniffH };
                }
            }
            // Fallback: sniffVideo embed页
            var sniffR2 = await OmniBox.sniffVideo(embedUrl2, sniffH);
            if (sniffR2 && sniffR2.url) {
                return { urls:[{name:"480p",url:sniffR2.url}], parse:0, header:sniffR2.header||sniffH };
            }
            return { urls:[], parse:0 };
        }

        // 直链MP4/m3u8（CDN直链，非get_file）
        if (/\.(m3u8|mp4|flv)/i.test(raw)) {
            return {
                urls: [{ name: "直链", url: raw }],
                parse: 0,
                header: { "User-Agent": UA, "Referer": HOST + "/" }
            };
        }

        return { urls: [], parse: 0 };
    } catch (e) {
        log("error", "play: " + e.message);
        return { urls: [], parse: 0 };
    }
}

module.exports = { home, category, search, detail, play };
require("spider_runner").run(module.exports);
