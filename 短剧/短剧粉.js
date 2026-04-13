// @name 短剧粉
// @author 梦
// @description 页面解析：分类/详情/播放已接入；播放页直接解析 player_aaaa.url m3u8
// @dependencies cheerio
// @version 1.1.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/短剧/短剧粉.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = "https://www.djfen.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const CLASS_LIST = [
  { type_id: "21", type_name: "现代都市" },
  { type_id: "2", type_name: "女频恋爱" },
  { type_id: "3", type_name: "反转爽剧" },
  { type_id: "5", type_name: "年代穿越" },
  { type_id: "4", type_name: "脑洞悬疑" },
  { type_id: "20", type_name: "古装仙侠" }
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function absUrl(url, base = BASE_URL) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  try {
    return new URL(value, /^https?:\/\//i.test(base) ? base : `${BASE_URL}/`).toString();
  } catch {
    if (value.startsWith("/")) return `${BASE_URL}${value}`;
    return `${BASE_URL}/${value.replace(/^\/+/, "")}`;
  }
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function dedupeBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchText(url, options = {}) {
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      Referer: options.referer || `${BASE_URL}/`,
      ...(options.headers || {})
    },
    timeout: options.timeout || 20000,
    body: options.body
  });

  if (!res || Number(res.statusCode) < 200 || Number(res.statusCode) >= 400) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }

  return getBodyText(res);
}

function parseVodCards(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const list = [];

  $(".pic-list .card a.pic-item[href*='/duanju/']").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    const vodId = (href.match(/\/duanju\/(\d+)\//i) || [])[1] || "";
    if (!vodId) return;

    const img = $a.find("img").first();
    const title = img.attr("alt") || stripHtml($a.closest(".card").find("h4 a").first().text()) || "";
    const pic = img.attr("data-original") || img.attr("data-src") || img.attr("src") || "";
    const score = stripHtml($a.closest(".card").find(".text-success").first().text());
    const metaText = stripHtml($a.closest(".card").find(".text-success").parent().text());
    const year = (metaText.match(/(20\d{2})/) || [])[1] || "";
    const status = stripHtml($a.find(".tips").first().text());
    const remarks = [year, status].filter(Boolean).join(" · ") || metaText;

    list.push({
      vod_id: vodId,
      vod_name: title,
      vod_pic: absUrl(pic),
      vod_year: year,
      vod_douban_score: score,
      vod_remarks: remarks
    });
  });

  return dedupeBy(list, (item) => item.vod_id);
}

function extractPageCount(html, currentPage = 1) {
  const pages = [...String(html || "").matchAll(/\/list\/\d+\/(\d+)\.html/gi)].map((m) => Number(m[1]));
  const maxPage = pages.length ? Math.max(...pages) : currentPage;
  return maxPage || currentPage;
}

async function home(params, context) {
  try {
    const html = await fetchText(`${BASE_URL}/`);
    const list = parseVodCards(html).slice(0, 40);
    await OmniBox.log("info", `[短剧粉][home] list=${list.length}`);
    return { class: CLASS_LIST, list };
  } catch (e) {
    await OmniBox.log("error", `[短剧粉][home] ${e.message}`);
    return { class: CLASS_LIST, list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = String(params?.categoryId || "21").trim();
    const page = Math.max(1, Number(params?.page || 1) || 1);
    const path = page > 1 ? `/list/${categoryId}/${page}.html` : `/list/${categoryId}/`;
    const url = absUrl(path);
    const html = await fetchText(url);
    const list = parseVodCards(html);
    const pagecount = Math.max(page, extractPageCount(html, page));
    await OmniBox.log("info", `[短剧粉][category] category=${categoryId} page=${page} list=${list.length} pagecount=${pagecount}`);
    return { page, pagecount, total: list.length, list };
  } catch (e) {
    await OmniBox.log("error", `[短剧粉][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params?.videoId || "").trim();
    if (!videoId) return { list: [] };

    const detailUrl = /^https?:\/\//i.test(videoId) ? videoId : `${BASE_URL}/duanju/${videoId}/`;
    const html = await fetchText(detailUrl);
    const $ = cheerio.load(html, { decodeEntities: false });

    const vodName = stripHtml($("h1.fs-2").first().text()) || stripHtml($("title").first().text()).replace(/短剧免费观看.*$/, "").trim();
    const poster = $(".vod-pic img").first();
    const vodPic = absUrl(poster.attr("data-original") || poster.attr("src") || "");
    const remarks = stripHtml($(".vod-doc p:contains('状态')").first().text()).replace(/^状态[:：]?/, "").trim();
    const actor = stripHtml($(".vod-doc p:contains('主演')").first().text()).replace(/^主演[:：]?/, "").trim();
    const year = stripHtml($(".vod-detail-guild a[href*='/vod/show/year/']").first().text()) || (stripHtml($(".vod-doc p:contains('更新')").first().text()).match(/(20\d{2})/) || [])[1] || "";
    const score = stripHtml($(".text-success.fw-bold").first().text()) || "";
    const content = stripHtml($(".detail, .content, .vod-content, .introduce").first().text());

    const episodes = [];
    $("#myList a[href*='/play/']").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href") || "";
      const name = stripHtml($a.text()) || stripHtml($a.attr("title") || "");
      if (!href) return;
      episodes.push({
        name: name || `第${episodes.length + 1}集`,
        playId: absUrl(href, detailUrl)
      });
    });

    const vodPlaySources = episodes.length ? [{ name: "云播", episodes }] : [];
    await OmniBox.log("info", `[短剧粉][detail] videoId=${videoId} episodes=${episodes.length}`);

    return {
      list: [
        {
          vod_id: videoId,
          vod_name: vodName,
          vod_pic: vodPic,
          type_name: "短剧",
          vod_content: content,
          vod_actor: actor,
          vod_year: year,
          vod_douban_score: score,
          vod_remarks: [year, remarks].filter(Boolean).join(" · "),
          vod_play_sources: vodPlaySources
        }
      ]
    };
  } catch (e) {
    await OmniBox.log("error", `[短剧粉][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params?.keyword || params?.wd || "").trim();
    const page = Math.max(1, Number(params?.page || 1) || 1);
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    // 站内搜索路径暂未确定，首版先做首页+分类首页聚合匹配。
    const pages = [`${BASE_URL}/`, ...CLASS_LIST.map((item) => `${BASE_URL}/list/${item.type_id}/`)];
    const all = [];
    for (const url of pages) {
      try {
        const html = await fetchText(url);
        all.push(...parseVodCards(html));
      } catch (err) {
        await OmniBox.log("warn", `[短剧粉][search] page.skip url=${url} message=${err.message}`);
      }
    }

    const merged = dedupeBy(all, (item) => item.vod_id);
    const key = keyword.toLowerCase();
    const list = merged.filter((item) => String(item.vod_name || "").toLowerCase().includes(key));
    await OmniBox.log("info", `[短剧粉][search] keyword=${keyword} totalScanned=${merged.length} list=${list.length}`);
    return { page, pagecount: 1, total: list.length, list };
  } catch (e) {
    await OmniBox.log("error", `[短剧粉][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params?.playId || "").trim();
    if (!playId) return { urls: [], parse: 0, header: {} };

    const html = await fetchText(playId, { referer: `${BASE_URL}/` });
    const match = String(html).match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})<\/script>/i);
    if (!match) {
      await OmniBox.log("warn", `[短剧粉][play] no player_aaaa playId=${playId}`);
      return { urls: [{ name: "播放页", url: playId }], parse: 1, header: { "User-Agent": UA, Referer: playId } };
    }

    let player = {};
    try {
      player = JSON.parse(match[1].replace(/\\\//g, '/'));
    } catch (err) {
      await OmniBox.log("error", `[短剧粉][play] player_aaaa parse error ${err.message}`);
    }

    const playUrl = String(player.url || '').trim();
    await OmniBox.log("info", `[短剧粉][play] playId=${playId} from=${player.from || ''} url=${playUrl}`);

    if (!/^https?:\/\//i.test(playUrl)) {
      return { urls: [{ name: "播放页", url: playId }], parse: 1, header: { "User-Agent": UA, Referer: playId } };
    }

    return {
      urls: [{ name: player.from || '默认线路', url: playUrl }],
      parse: 0,
      header: {
        "User-Agent": UA,
        Referer: playId
      }
    };
  } catch (e) {
    await OmniBox.log("error", `[短剧粉][play] ${e.message}`);
    return { urls: [], parse: 0, header: {} };
  }
}
