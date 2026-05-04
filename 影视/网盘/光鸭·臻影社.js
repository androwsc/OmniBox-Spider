// @name 光鸭·臻影社
// @author 梦
// @description 网盘资源站：https://guangya.qsxy.top ，支持首页、分类、搜索、详情、分类筛选排序、评论解锁与每日自动签到；Cookie 支持环境变量配置；可选使用光鸭云盘授权播放
// @version 1.3.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/光鸭·臻影社.js
// @dependencies axios,cheerio

const axios = require("axios");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const HOST = trimTrailingSlash(process.env.GUANGYA_HOST || "https://guangya.qsxy.top");
const PAN_HOST = trimTrailingSlash(process.env.GUANGYAPAN_HOST || "https://www.guangyapan.com");
const PAN_API = trimTrailingSlash(process.env.GUANGYAPAN_API || "https://api.guangyapan.com");
const SITE_COOKIE = String(process.env.GUANGYA_COOKIE || "").trim();
const PAN_AUTH_RAW = String(process.env.GUANGYA_PAN_AUTH || process.env.GUANGYAPAN_AUTH || "").trim();
const COMMENT_TEXT = String(process.env.GUANGYA_COMMENT_TEXT || "感谢分享资源").trim() || "感谢分享资源";
const UA = process.env.GUANGYA_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0";
const REQUEST_TIMEOUT = Math.max(5000, parseInt(process.env.GUANGYA_TIMEOUT || "20000", 10) || 20000);
const MAX_SHARE_DEPTH = Math.max(1, parseInt(process.env.GUANGYA_MAX_SHARE_DEPTH || "4", 10) || 4);
const MAX_SHARE_ITEMS = Math.max(20, parseInt(process.env.GUANGYA_MAX_SHARE_ITEMS || "200", 10) || 200);
const AUTO_CHECKIN_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.GUANGYA_AUTO_CHECKIN || "1").trim());
const CHECKIN_CACHE_KEY = "guangya:auto-checkin:v1";
const CHECKIN_TTL = 24 * 60 * 60;

const http = axios.create({
  timeout: REQUEST_TIMEOUT,
  validateStatus: () => true,
  responseType: "arraybuffer",
  maxRedirects: 0,
  decompress: true,
});

let autoCheckinPromise = null;

const CATEGORY_CONFIG = {
  film: {
    name: "电影",
    subcategories: [
      { name: "全部", value: "" },
      { name: "国产", value: "domestic" },
      { name: "欧美", value: "euramerican" },
      { name: "日韩", value: "japankorean" },
      { name: "其他", value: "other" },
    ],
  },
  show: {
    name: "电视剧",
    subcategories: [
      { name: "全部", value: "" },
      { name: "国产", value: "domestic-show" },
      { name: "欧美", value: "euramerican-show" },
      { name: "日韩", value: "japankorean-show" },
      { name: "其他", value: "other-show" },
    ],
  },
  animation: {
    name: "动漫",
    subcategories: [
      { name: "全部", value: "" },
      { name: "国产", value: "domestic-animation" },
      { name: "欧美", value: "euramerican-animation" },
      { name: "日韩", value: "japankorean-animation" },
      { name: "其他", value: "other-animation" },
    ],
  },
  reality: {
    name: "综艺",
    subcategories: [
      { name: "全部", value: "" },
      { name: "国产", value: "domestic-reality" },
      { name: "其他", value: "other-reality" },
    ],
  },
  documentary: {
    name: "纪录片",
    subcategories: [
      { name: "全部", value: "" },
      { name: "国产", value: "domestic-documentary" },
      { name: "其他", value: "other-documentary" },
    ],
  },
  music: {
    name: "音乐",
    subcategories: [{ name: "全部", value: "" }],
  },
};

const CLASS_LIST = Object.entries(CATEGORY_CONFIG).map(([type_id, config]) => ({
  type_id,
  type_name: config.name,
}));

const ORDERBY_OPTIONS = [
  { name: "更新", value: "modified" },
  { name: "浏览", value: "views" },
  { name: "点赞", value: "like" },
  { name: "评论", value: "comment_count" },
];

const FILTERS = Object.fromEntries(
  Object.entries(CATEGORY_CONFIG).map(([typeId, config]) => {
    const filters = [];
    if (Array.isArray(config.subcategories) && config.subcategories.length > 1) {
      filters.push({
        key: "subclass",
        name: "分类",
        init: "",
        value: config.subcategories.map((item) => ({ name: item.name, value: item.value })),
      });
    }
    filters.push({
      key: "orderby",
      name: "排序",
      init: "modified",
      value: ORDERBY_OPTIONS.map((item) => ({ name: item.name, value: item.value })),
    });
    return [typeId, filters];
  })
);

const VIDEO_EXTENSIONS = [
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v", ".mpg", ".mpeg", ".rmvb", ".ts", ".m2ts", ".webm", ".m3u8",
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body).toString();
  return String(body || "");
}

async function requestViaAxios(url, options = {}) {
  const response = await http.request({
    url,
    method: String(options.method || "GET").toUpperCase(),
    headers: options.headers || {},
    data: options.body,
    timeout: options.timeout || REQUEST_TIMEOUT,
    responseType: options.responseType || "arraybuffer",
    maxRedirects: Object.prototype.hasOwnProperty.call(options, "maxRedirects") ? options.maxRedirects : 0,
    validateStatus: () => true,
  });
  const data = response?.data;
  return {
    statusCode: Number(response?.status || 0),
    headers: response?.headers || {},
    body: Buffer.isBuffer(data) || data instanceof Uint8Array ? Buffer.from(data) : String(data || ""),
  };
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSiteSuffix(value) {
  return cleanText(value)
    .replace(/[-—–]\s*光鸭.*$/i, "")
    .replace(/-clearlogo$/i, "")
    .trim();
}

function absUrl(url, base = HOST) {
  const value = decodeHtmlEntities(String(url || "").trim());
  if (!value) return "";
  try {
    return new URL(value, `${base}/`).toString();
  } catch (_) {
    return value;
  }
}

function normalizePanAuthorization() {
  if (!PAN_AUTH_RAW) return "";
  return /^Bearer\s+/i.test(PAN_AUTH_RAW) ? PAN_AUTH_RAW : `Bearer ${PAN_AUTH_RAW}`;
}

function buildSiteHeaders(referer = `${HOST}/`, extra = {}) {
  return {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    Referer: referer,
    ...(SITE_COOKIE ? { Cookie: SITE_COOKIE } : {}),
    ...extra,
  };
}

function buildPanApiHeaders(referer = `${PAN_HOST}/`, extra = {}, withAuth = false) {
  const headers = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: PAN_HOST,
    Referer: referer,
    dt: "4",
    ...extra,
  };
  const auth = withAuth ? normalizePanAuthorization() : "";
  if (auth) headers.Authorization = auth;
  return headers;
}

function buildSharePageHeaders(referer = `${PAN_HOST}/`) {
  return {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: referer,
    Origin: PAN_HOST,
  };
}

function escapeCommentText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getCacheSafe(key) {
  try {
    return await OmniBox.getCache(key);
  } catch (_) {
    return "";
  }
}

async function setCacheSafe(key, value, ttl) {
  try {
    await OmniBox.setCache(key, String(value || ""), ttl);
  } catch (_) {}
}

function extractGlobalActionNonce(html) {
  const text = String(html || "");
  const match = text.match(/post_action_nonce\s*:\s*['\"]([^'\"]+)['\"]/i);
  return String(match?.[1] || "").trim();
}

function pickHeaderValue(headers = {}, name = "") {
  const target = String(name || "").toLowerCase();
  if (!target || !headers || typeof headers !== "object") return "";
  for (const [key, value] of Object.entries(headers)) {
    if (String(key || "").toLowerCase() !== target) continue;
    if (Array.isArray(value)) return String(value[0] || "").trim();
    return String(value || "").trim();
  }
  return "";
}

function startAutoCheckin(scene = "", seedHtml = "") {
  if (!AUTO_CHECKIN_ENABLED || !SITE_COOKIE || autoCheckinPromise) return;
  autoCheckinPromise = maybeAutoCheckin(scene, seedHtml)
    .catch(async (error) => {
      await setCacheSafe(CHECKIN_CACHE_KEY, `fail:${Date.now()}`, CHECKIN_TTL);
      await OmniBox.log("warn", `[光鸭][checkin] 自动签到失败 scene=${scene || "-"}: ${error.message}`);
      await OmniBox.log("info", `[光鸭][checkin] 已写入失败缓存 ttl=${CHECKIN_TTL}s，24小时内不再重试`);
    })
    .finally(() => {
      autoCheckinPromise = null;
    });
}

async function maybeAutoCheckin(scene = "", seedHtml = "") {
  const cached = await getCacheSafe(CHECKIN_CACHE_KEY);
  if (cached) {
    const cacheLabel = String(cached || "");
    const cacheState = /^fail:/i.test(cacheLabel) ? "failed" : "done";
    await OmniBox.log("info", `[光鸭][checkin] 命中${cacheState === "failed" ? "失败" : "成功"}缓存 scene=${scene || "-"} cache=${cacheLabel.slice(0, 40)}`);
    return false;
  }
  let html = String(seedHtml || "");
  if (!html) {
    html = await requestText(`${HOST}/`, { referer: `${HOST}/` }).catch(() => "");
  }
  const nonce = extractGlobalActionNonce(html);
  const payload = { action: "user_checkin" };
  if (nonce) {
    payload._wpnonce = nonce;
    payload.post_action_nonce = nonce;
  }
  const body = new URLSearchParams(payload).toString();
  await OmniBox.log("info", `[光鸭][checkin] 开始自动签到 scene=${scene || "-"} nonceLen=${nonce.length}`);
  const res = await requestViaAxios(`${HOST}/wp-admin/admin-ajax.php`, {
    method: "POST",
    headers: buildSiteHeaders(`${HOST}/`, {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: HOST,
    }),
    body,
    timeout: REQUEST_TIMEOUT,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  let summary = `raw=${JSON.stringify(String(text || "").slice(0, 160))}`;
  try {
    const json = JSON.parse(text || "{}");
    const code = Object.prototype.hasOwnProperty.call(json || {}, "code") ? Number(json.code || 0) : 0;
    const message = String(json?.msg || json?.message || "").trim();
    summary = `code=${Number.isFinite(code) ? code : ""} msg=${message.slice(0, 120)}`;
    if (json?.error || (Number.isFinite(code) && code !== 0 && !/已.*签到|success|成功/i.test(message))) {
      throw new Error(summary);
    }
  } catch (error) {
    if (error instanceof Error && /^code=/.test(error.message)) throw error;
  }
  if (statusCode !== 200) {
    throw new Error(`HTTP ${statusCode} ${summary}`.trim());
  }
  await setCacheSafe(CHECKIN_CACHE_KEY, String(Date.now()), CHECKIN_TTL);
  await OmniBox.log("info", `[光鸭][checkin] 自动签到完成 scene=${scene || "-"} status=${statusCode} ${summary}`);
  return true;
}

async function requestText(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  await OmniBox.log("info", `[光鸭][request] ${method} ${url}`);
  const res = await requestViaAxios(url, {
    method,
    headers: buildSiteHeaders(options.referer || `${HOST}/`, options.headers || {}),
    body: options.body,
    timeout: options.timeout || REQUEST_TIMEOUT,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  if (statusCode !== 200) {
    throw new Error(`HTTP ${statusCode} @ ${url}`);
  }
  return text;
}

async function panPost(path, body = {}, options = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${PAN_API}${path}`;
  await OmniBox.log("info", `[光鸭][pan] POST ${path}`);
  const res = await requestViaAxios(url, {
    method: "POST",
    headers: buildPanApiHeaders(options.referer || `${PAN_HOST}/`, options.headers || {}, !!options.withAuth),
    body: JSON.stringify(body || {}),
    timeout: options.timeout || REQUEST_TIMEOUT,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  if (statusCode !== 200) {
    throw new Error(`HTTP ${statusCode} @ ${path}`);
  }
  try {
    return JSON.parse(text || "{}");
  } catch (error) {
    throw new Error(`解析光鸭云盘接口失败: ${error.message}`);
  }
}

function getPanCode(json) {
  if (json && Object.prototype.hasOwnProperty.call(json, "code")) {
    const code = Number(json.code);
    return Number.isFinite(code) ? code : 0;
  }
  return 0;
}

function isPanSuccess(json) {
  const code = getPanCode(json);
  if (code !== 0) return false;
  const msg = String(json?.msg || "success").trim();
  return !msg || msg === "success";
}

function unwrapPanData(json, label) {
  if (!isPanSuccess(json)) {
    throw new Error(`${label}: ${String(json?.msg || "请求失败").trim() || "请求失败"}`);
  }
  return json?.data || {};
}

function safeBase64Decode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    return Buffer.from(`${normalized}${"=".repeat(padLength)}`, "base64").toString("utf8").trim();
  } catch (_) {
    return "";
  }
}

function extractGoLinkUrl(rawHref) {
  const href = absUrl(rawHref, HOST);
  if (!href) return "";
  if (/guangyapan\.com\/s\//i.test(href)) return href;
  try {
    const url = new URL(href);
    const goLink = url.searchParams.get("golink");
    if (!goLink) return "";
    const decoded = safeBase64Decode(goLink);
    return /^https?:\/\//i.test(decoded) ? decoded : "";
  } catch (_) {
    return "";
  }
}

function normalizeShareUrlCandidate(value) {
  const raw = decodeHtmlEntities(String(value || "").trim());
  if (!raw) return "";
  if (/guangyapan\.com\/s\//i.test(raw)) {
    const match = raw.match(/https?:\/\/[^\s"'<>]*guangyapan\.com\/s\/[^\s"'<>]+/i);
    return match ? absUrl(match[0], PAN_HOST) : absUrl(raw, PAN_HOST);
  }
  if (/golink=/i.test(raw)) {
    const match = raw.match(/https?:\/\/[^\s"'<>]+/i);
    return extractGoLinkUrl(match ? match[0] : raw);
  }
  return "";
}

function parseShareId(shareURL) {
  const match = String(shareURL || "").match(/\/s\/([^/?#]+)/i);
  return match ? String(match[1] || "").trim() : "";
}

function parseShareCode(shareURL) {
  try {
    const url = new URL(String(shareURL || ""));
    return String(url.searchParams.get("code") || url.searchParams.get("pwd") || "").trim();
  } catch (_) {
    return "";
  }
}

function extractGcid(value) {
  const match = String(value || "").match(/screenshot-thumbnails\/([A-Fa-f0-9]{20,})\//);
  return match ? String(match[1] || "").trim() : "";
}

function formatFileSize(size) {
  const n = Number(size || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(2)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)}MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)}GB`;
  return `${(n / 1024 ** 4).toFixed(2)}TB`;
}

function stripExt(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
}

function normalizeKeyword(value) {
  return cleanText(value || "").toLowerCase();
}

function getCategoryConfig(categoryId = "film") {
  return CATEGORY_CONFIG[String(categoryId || "").trim()] || CATEGORY_CONFIG.film;
}

function normalizeCategoryPath(categoryPath = "") {
  return String(categoryPath || "")
    .split("/")
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .join("/");
}

function normalizeFilterPayload(rawFilters) {
  if (!rawFilters) return {};
  if (typeof rawFilters === "string") {
    try {
      const parsed = JSON.parse(rawFilters);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return typeof rawFilters === "object" ? rawFilters : {};
}

function resolveCategoryState(categoryId, params = {}) {
  const config = getCategoryConfig(categoryId);
  const filterPayload = normalizeFilterPayload(params.filters || params.extend || params.ext || {});
  const allowedSubcategories = new Set((config.subcategories || []).map((item) => String(item.value || "")));
  let subclass = String(
    filterPayload.subclass ||
    filterPayload.type ||
    params.subclass ||
    params.subtype ||
    ""
  ).trim();
  if (!allowedSubcategories.has(subclass)) subclass = "";

  const allowedOrderby = new Set(ORDERBY_OPTIONS.map((item) => String(item.value || "")));
  let orderby = String(
    filterPayload.orderby ||
    filterPayload.sort ||
    filterPayload.by ||
    params.orderby ||
    params.sort ||
    ""
  ).trim();
  if (!allowedOrderby.has(orderby)) orderby = "modified";

  return {
    config,
    filters: { subclass, orderby },
    categoryPath: normalizeCategoryPath(subclass ? `${categoryId}/${subclass}` : categoryId) || "film",
  };
}

function dedupeVodList(list = []) {
  const seen = new Set();
  const results = [];
  for (const item of list || []) {
    const key = String(item?.vod_id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function buildCategoryUrl(categoryPath, page = 1, orderby = "") {
  const normalizedPath = normalizeCategoryPath(categoryPath) || "film";
  const base = `${HOST}/category/${normalizedPath}`;
  const pageUrl = page > 1 ? `${base}/page/${page}` : base;
  if (!orderby) return pageUrl;
  const query = new URLSearchParams({ orderby: String(orderby || "").trim() });
  return `${pageUrl}?${query.toString()}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCategoryPageCount(html, categoryPath, currentPage = 1) {
  const normalizedPath = normalizeCategoryPath(categoryPath) || "film";
  const re = new RegExp(`/category/${escapeRegExp(normalizedPath)}/page/(\\d+)`, "g");
  const pages = [];
  let match;
  while ((match = re.exec(html))) {
    const page = Number(match[1] || 0);
    if (Number.isFinite(page) && page > 0) pages.push(page);
  }
  const maxPage = pages.length ? Math.max(currentPage, ...pages) : currentPage;
  const hasNext = /next page|nextpostslink|下一页|fa-angle-right/i.test(html);
  return hasNext && maxPage <= currentPage ? currentPage + 1 : maxPage;
}

function pickCardImage($, card) {
  const img = card.find(".item-thumbnail img, .graphic img, img").first();
  return absUrl(
    img.attr("data-src") ||
    img.attr("data-original") ||
    img.attr("src") ||
    card.find("a img").first().attr("data-src") ||
    card.find("a img").first().attr("src") ||
    "",
    HOST,
  );
}

function buildVodItem({ id, title, pic, remarks = "", content = "" }) {
  return {
    vod_id: id,
    vod_name: stripSiteSuffix(title) || "未命名资源",
    vod_pic: pic || "",
    vod_remarks: cleanText(remarks),
    vod_content: cleanText(content),
  };
}

function extractPostsCards($) {
  const list = [];
  $("posts.posts-item.list.ajax-item.flex, .posts-item.list.ajax-item.flex").each((_, el) => {
    const card = $(el);
    const linkEl = card.find("h2.item-heading a").first();
    const href = absUrl(linkEl.attr("href") || card.find("a[href$='.html']").first().attr("href") || "", HOST);
    const title = stripSiteSuffix(linkEl.text() || card.find("img").attr("alt") || "");
    if (!href || !title) return;
    const pic = pickCardImage($, card);
    const excerpt = cleanText(card.find(".item-excerpt").first().text());
    const timeText = cleanText(card.find(".item-meta .icon-circle, .item-meta .meta-author span[title]").first().text()) || cleanText(card.find(".item-meta [title]").first().text());
    const viewText = cleanText(card.find(".meta-view").first().text());
    list.push(buildVodItem({
      id: href,
      title,
      pic,
      remarks: [timeText, viewText].filter(Boolean).join(" · "),
      content: excerpt,
    }));
  });
  return dedupeVodList(list);
}

function extractTermCards($) {
  const list = [];
  $(".hover-zoom-img, .term-title").each((_, el) => {
    const card = $(el);
    const linkEl = card.find(".term-title a[href$='.html'], a[href$='.html']").first();
    const href = absUrl(linkEl.attr("href") || "", HOST);
    const title = stripSiteSuffix(linkEl.text() || card.find("img").attr("alt") || "");
    if (!href || !title) return;
    const pic = absUrl(
      card.find(".graphic img").first().attr("data-src") ||
      card.find(".graphic img").first().attr("src") ||
      card.find("img").first().attr("data-src") ||
      card.find("img").first().attr("src") ||
      "",
      HOST,
    );
    const remarks = cleanText(card.find(".px12 span").first().text()) || cleanText(card.find(".badg").first().text());
    list.push(buildVodItem({ id: href, title, pic, remarks }));
  });
  return dedupeVodList(list);
}

function extractKeywordAnchors($, keyword) {
  const normalizedKeyword = normalizeKeyword(keyword);
  const list = [];
  $("a[href$='.html']").each((_, el) => {
    const a = $(el);
    const href = absUrl(a.attr("href") || "", HOST);
    const title = stripSiteSuffix(a.text() || a.attr("title") || a.find("img").attr("alt") || "");
    if (!href || !title) return;
    const excerpt = cleanText(a.closest(".posts-item, .hover-zoom-img, article, li, div").find(".item-excerpt").first().text());
    const haystack = `${normalizeKeyword(title)} ${normalizeKeyword(excerpt)}`;
    if (!normalizedKeyword || !haystack.includes(normalizedKeyword)) return;
    const pic = absUrl(
      a.find("img").first().attr("data-src") ||
      a.find("img").first().attr("src") ||
      a.closest(".posts-item, .hover-zoom-img, article, li, div").find("img").first().attr("data-src") ||
      a.closest(".posts-item, .hover-zoom-img, article, li, div").find("img").first().attr("src") ||
      "",
      HOST,
    );
    list.push(buildVodItem({ id: href, title, pic, content: excerpt }));
  });
  return dedupeVodList(list);
}

function extractDetailMeta($, detailUrl) {
  const title = stripSiteSuffix(
    $("h1.article-title a, h1.article-title, meta[property='og:title']").first().attr("content") ||
    $("h1.article-title a, h1.article-title").first().text() ||
    $("title").text() ||
    "光鸭资源"
  );
  const pic = absUrl(
    $(".wp-posts-content img").first().attr("data-full-url") ||
    $(".wp-posts-content img").first().attr("data-src") ||
    $(".wp-posts-content img").first().attr("src") ||
    $("meta[property='og:image']").attr("content") ||
    "",
    HOST,
  );
  const contentNode = $(".article-content .wp-posts-content").first().clone();
  contentNode.find(".tinymce-hide, .hidden-box, .hidden-text, script, style").remove();
  const content = cleanText(contentNode.text()) || cleanText($("meta[name='description']").attr("content") || "");
  const remarks = cleanText($(".article-header [title*='发布']").first().attr("title") || $(".article-header [title*='发布']").first().text() || "");
  return {
    vod_id: detailUrl,
    vod_name: title || "光鸭资源",
    vod_pic: pic,
    vod_remarks: remarks,
    vod_content: content,
  };
}

function isLockedHidden(html) {
  const text = String(html || "");
  return text.includes("此处内容已隐藏，请评论后刷新页面查看.") || /hidden-box[^>]*reply-show/i.test(text);
}

function findUnlockCommentForm($) {
  const selectors = [
    "#commentform",
    "#respond form",
    "form:has(#comment_post_ID)",
    "form:has(input[name='comment_post_ID'])",
    "form:has(textarea[name='comment'])",
    "form:has(#comment_parent)",
  ];
  for (const selector of selectors) {
    const form = $(selector).first();
    if (form.length) return form;
  }
  const anchorInput = $("input[name='comment_post_ID'], #comment_post_ID, textarea[name='comment']").first();
  if (anchorInput.length) {
    const form = anchorInput.closest("form");
    if (form.length) return form;
  }
  return null;
}

function extractFormFields($, form) {
  const fields = {};
  if (!form || !form.length) return fields;
  form.find("input[name], textarea[name], select[name]").each((_, el) => {
    const node = $(el);
    const name = String(node.attr("name") || "").trim();
    if (!name) return;
    const tagName = String(el.tagName || "").toLowerCase();
    const type = String(node.attr("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !node.is(":checked")) return;
    let value = "";
    if (tagName === "textarea") value = node.text() || "";
    else value = node.val();
    fields[name] = String(value || "").trim();
  });
  return fields;
}

function extractSubmitMeta($, form) {
  if (!form || !form.length) {
    return {
      hasButton: false,
      id: "",
      ajaxHref: "",
      formAction: "",
      name: "",
      type: "",
      value: "",
      className: "",
      dataPostId: "",
      dataNonceLen: 0,
    };
  }
  const button = form.find("#submit, button[type='submit'], input[type='submit']").first();
  if (!button.length) {
    return {
      hasButton: false,
      id: "",
      ajaxHref: "",
      formAction: "",
      name: "",
      type: "",
      value: "",
      className: "",
      dataPostId: "",
      dataNonceLen: 0,
    };
  }
  return {
    hasButton: true,
    id: String(button.attr("id") || "").trim(),
    ajaxHref: absUrl(button.attr("ajax-href") || "", HOST),
    formAction: String(button.attr("form-action") || "").trim(),
    name: String(button.attr("name") || "").trim(),
    type: String(button.attr("type") || "").trim(),
    value: String(button.val() || button.attr("value") || "").trim(),
    className: cleanText(button.attr("class") || ""),
    dataPostId: String(button.attr("data-postid") || "").trim(),
    dataNonceLen: String(button.attr("data-nonce") || "").trim().length,
  };
}

function extractUnlockForm($) {
  const form = findUnlockCommentForm($);
  const fields = extractFormFields($, form);
  const submit = extractSubmitMeta($, form);
  const commentPostId = String(fields.comment_post_ID || fields.postid || fields.post_id || "").trim();
  const commentParent = String(fields.comment_parent || "0").trim() || "0";
  const nonce = String(fields._wpnonce || "").trim();
  return {
    hasForm: !!(form && form.length),
    formId: form && form.length ? String(form.attr("id") || "").trim() : "",
    action: form && form.length ? String(form.attr("action") || "").trim() : "",
    fieldNames: Object.keys(fields),
    fields,
    submit,
    commentPostId,
    commentParent,
    nonce,
  };
}

async function submitUnlockComment(detailUrl, form) {
  const action = "submit_comment";
  const targetUrl = form?.submit?.ajaxHref || `${HOST}/wp-admin/admin-ajax.php`;
  const payload = {
    comment: COMMENT_TEXT,
    comment_post_ID: String(form?.commentPostId || "").trim(),
    comment_parent: String(form?.commentParent || "0").trim() || "0",
    _wpnonce: String(form?.nonce || "").trim(),
    action,
  };
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === "") continue;
    body.set(key, String(value));
  }
  const bodyText = body.toString();
  await OmniBox.log("info", `[光鸭][unlock] 提交评论解锁 url=${targetUrl} mode=ajax-minimal action=${action} comment_post_ID=${payload.comment_post_ID} parent=${payload.comment_parent} nonceLen=${String(payload._wpnonce || "").length} cookieLen=${SITE_COOKIE.length} ua=${JSON.stringify(UA.slice(0, 80))} fieldCount=${Object.keys(payload).length} fields=${Object.keys(payload).join(",")}`);
  const res = await requestViaAxios(targetUrl, {
    method: "POST",
    headers: buildSiteHeaders(detailUrl, {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: HOST,
      DNT: "1",
      "Sec-GPC": "1",
      Priority: "u=1, i",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-CH-UA": '"Microsoft Edge";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Windows"',
    }),
    body: bodyText,
    timeout: REQUEST_TIMEOUT,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  try {
    const json = JSON.parse(text || "{}");
    await OmniBox.log("info", `[光鸭][unlock] 响应 status=${statusCode} len=${String(text || "").length} code=${json?.code ?? ""} msg=${String(json?.msg || "").slice(0, 120)} raw=${JSON.stringify(String(text || "").slice(0, 160))}`);
    return { statusCode, raw: text, json };
  } catch (_) {
    await OmniBox.log("info", `[光鸭][unlock] 响应 status=${statusCode} len=${String(text || "").length} raw=${JSON.stringify(String(text || "").slice(0, 160))}`);
    return { statusCode, raw: text, json: null };
  }
}

function shouldFallbackCommentPost(result) {
  if (!result) return true;
  const statusCode = Number(result.statusCode || 0);
  const raw = String(result.raw || "").trim();
  if (statusCode >= 400) return true;
  if (raw === "0") return true;
  if (result?.json?.error) return true;
  return false;
}

async function submitUnlockCommentFallback(detailUrl, form) {
  const targetUrl = absUrl(form?.action || `${HOST}/wp-comments-post.php`, HOST);
  const payload = {
    ...(form?.fields || {}),
    comment: COMMENT_TEXT,
    comment_post_ID: form.commentPostId,
    comment_parent: form.commentParent || "0",
    _wpnonce: form.nonce,
  };
  delete payload.action;
  delete payload.edit_comment_ID;
  delete payload.ak_js;
  delete payload.ak_hp_textarea;
  delete payload.ak_js_1;
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }
  await OmniBox.log("info", `[光鸭][unlock] 回退标准评论提交流程 url=${targetUrl} comment_post_ID=${form.commentPostId} parent=${form.commentParent || "0"} fieldCount=${Object.keys(payload).length} fields=${Object.keys(payload).slice(0, 20).join(",")}`);
  const res = await requestViaAxios(targetUrl, {
    method: "POST",
    headers: buildSiteHeaders(detailUrl, {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: HOST,
    }),
    body: body.toString(),
    timeout: REQUEST_TIMEOUT,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  const headers = res?.headers || {};
  const location = pickHeaderValue(headers, "location");
  const setCookie = headers["set-cookie"] || headers["Set-Cookie"] || headers["SET-COOKIE"] || [];
  const setCookieCount = Array.isArray(setCookie) ? setCookie.length : (setCookie ? 1 : 0);
  await OmniBox.log("info", `[光鸭][unlock] 回退响应 status=${statusCode} len=${String(text || "").length} location=${location || "-"} setCookie=${setCookieCount} raw=${JSON.stringify(String(text || "").slice(0, 160))}`);
  return { statusCode, raw: text, headers, location, setCookieCount };
}

async function maybeUnlockHiddenDetail(detailUrl, html) {
  if (!isLockedHidden(html)) return html;
  await OmniBox.log("warn", `[光鸭][detail] 命中隐藏内容: ${detailUrl}`);
  if (!SITE_COOKIE) {
    await OmniBox.log("warn", `[光鸭][detail] 未配置 GUANGYA_COOKIE，无法自动评论解锁`);
    return html;
  }
  const $ = cheerio.load(html);
  const form = extractUnlockForm($);
  let pendingApprovalSuspected = false;
  await OmniBox.log("info", `[光鸭][detail] 解锁表单 hasForm=${form.hasForm ? 1 : 0} formId=${form.formId || "-"} action=${form.action || "-"} comment_post_ID=${form.commentPostId || "-"} comment_parent=${form.commentParent || "-"} nonceLen=${String(form.nonce || "").length} fields=${form.fieldNames.slice(0, 20).join(",")} submitId=${form.submit?.id || "-"} submitAction=${form.submit?.formAction || "-"} submitAjax=${form.submit?.ajaxHref || "-"} submitNonceLen=${form.submit?.dataNonceLen || 0}`);
  if (!form.commentPostId || !form.nonce) {
    await OmniBox.log("warn", `[光鸭][detail] 未找到评论解锁参数，跳过自动评论`);
    return html;
  }
  try {
    const result = await submitUnlockComment(detailUrl, form);
    const summary = {
      status: result?.statusCode || 0,
      code: result?.json?.code,
      error: result?.json?.error,
      msg: result?.json?.msg || "",
      raw: String(result?.raw || "").slice(0, 160),
    };
    await OmniBox.log("info", `[光鸭][unlock] 提交结果: ${JSON.stringify(summary).slice(0, 400)}`);
    if (shouldFallbackCommentPost(result)) {
      await OmniBox.log("warn", `[光鸭][unlock] Ajax 评论疑似失败，尝试回退标准评论接口`);
      const fallback = await submitUnlockCommentFallback(detailUrl, form);
      pendingApprovalSuspected = (!!fallback?.location && /unapproved=|moderation-hash=|#comment-\d+/i.test(fallback.location)) || (Number(fallback?.statusCode || 0) === 200 && !String(fallback?.raw || "").trim());
      await OmniBox.log("info", `[光鸭][unlock] 回退提交结果: ${JSON.stringify({ status: fallback?.statusCode || 0, location: fallback?.location || "", raw: String(fallback?.raw || "").slice(0, 160) }).slice(0, 400)}`);
    }
  } catch (error) {
    await OmniBox.log("warn", `[光鸭][unlock] 提交评论失败: ${error.message}`);
  }
  try {
    const freshHtml = await requestText(detailUrl, { referer: detailUrl });
    const stillLocked = isLockedHidden(freshHtml);
    await OmniBox.log("info", `[光鸭][unlock] 刷新后隐藏状态: ${stillLocked ? "locked" : "unlocked"}`);
    if (stillLocked) {
      await OmniBox.log("warn", `[光鸭][unlock] 刷新后仍检测到隐藏内容，疑似评论未生效`);
      if (pendingApprovalSuspected) {
        await OmniBox.log("warn", `[光鸭][unlock] 站点前端仅在 comment_approved>0 时自动解锁；当前评论可能已受理但仍待审核`);
      }
    }
    return freshHtml;
  } catch (error) {
    await OmniBox.log("warn", `[光鸭][unlock] 解锁后刷新详情失败: ${error.message}`);
    return html;
  }
}

function extractShareEntries($, html = "") {
  const entries = [];
  const seen = new Set();
  let anchorCandidateCount = 0;
  let textCandidateCount = 0;

  const pushEntry = (shareURL, title) => {
    if (!shareURL || !/guangyapan\.com\/s\//i.test(shareURL)) return;
    if (seen.has(shareURL)) return;
    seen.add(shareURL);
    entries.push({
      shareURL,
      shareId: parseShareId(shareURL),
      code: parseShareCode(shareURL),
      title: stripSiteSuffix(title || "光鸭云盘资源") || "光鸭云盘资源",
    });
  };

  $(".tinymce-hide a, .wp-posts-content a, [data-clipboard-text], [data-url], [data-link], [data-href]").each((_, el) => {
    const a = $(el);
    const title =
      a.attr("title") ||
      a.text() ||
      a.closest("li, p, div").find("a[title]").first().attr("title") ||
      a.closest("li, p, div").text() ||
      "光鸭云盘资源";
    const candidates = [
      a.attr("href") || "",
      a.attr("data-clipboard-text") || "",
      a.attr("data-url") || "",
      a.attr("data-link") || "",
      a.attr("data-href") || "",
      a.text() || "",
    ];
    for (const candidate of candidates) {
      const shareURL = normalizeShareUrlCandidate(candidate);
      if (!shareURL) continue;
      anchorCandidateCount += 1;
      pushEntry(shareURL, title);
    }
  });

  const rawHtml = decodeHtmlEntities(String(html || ""));
  const textMatches = [
    ...(rawHtml.match(/https?:\/\/[^\s"'<>]*guangyapan\.com\/s\/[^\s"'<>]+/ig) || []),
    ...(rawHtml.match(/https?:\/\/[^\s"'<>]+\?golink=[A-Za-z0-9_\-=%]+/ig) || []),
  ];
  textCandidateCount = textMatches.length;
  for (const candidate of textMatches) {
    const shareURL = normalizeShareUrlCandidate(candidate);
    if (!shareURL) continue;
    pushEntry(shareURL, "光鸭云盘资源");
  }

  return {
    entries,
    diagnostics: {
      anchorCandidateCount,
      textCandidateCount,
    },
  };
}

async function getShareSummary(shareId) {
  return unwrapPanData(await panPost("/userres/v1/get_share_summary", { shareId }, { referer: `${PAN_HOST}/s/${shareId}` }), "获取分享摘要失败");
}

async function getShareAccessToken(shareId, code = "") {
  const payload = { shareId };
  if (code) payload.code = code;
  return unwrapPanData(await panPost("/userres/v1/get_share_access_token", payload, { referer: `${PAN_HOST}/s/${shareId}` }), "获取分享 accessToken 失败");
}

async function listShareFiles(accessToken, parentId = "") {
  const results = [];
  const seen = new Set();
  let cursor = undefined;
  for (let i = 0; i < 20; i += 1) {
    const payload = {
      accessToken,
      pageSize: Math.min(200, MAX_SHARE_ITEMS),
      orderBy: 0,
      sortType: 0,
      parentId,
    };
    if (cursor !== undefined && cursor !== null) payload.cursor = cursor;
    const data = unwrapPanData(await panPost("/userres/v1/get_share_page_files_list", payload), "获取分享文件列表失败");
    const list = Array.isArray(data?.list) ? data.list : [];
    for (const item of list) {
      const fileId = String(item?.fileId || "").trim();
      const key = `${parentId || "root"}|${fileId}`;
      if (!fileId || seen.has(key)) continue;
      seen.add(key);
      results.push(item);
      if (results.length >= MAX_SHARE_ITEMS) return results;
    }
    const total = Number(data?.total || 0);
    if (!data?.cursor || list.length === 0 || results.length >= total || data.cursor === cursor) break;
    cursor = data.cursor;
  }
  return results;
}

function isFolderItem(item) {
  return Number(item?.resType || 0) === 2;
}

function isVideoItem(item) {
  if (Number(item?.resType || 0) !== 1) return false;
  const fileName = String(item?.fileName || "").toLowerCase();
  const ext = String(item?.ext || "").toLowerCase();
  const mineType = String(item?.mineType || item?.mimeType || "").toLowerCase();
  return VIDEO_EXTENSIONS.some((suffix) => fileName.endsWith(suffix) || ext === suffix) || mineType.includes("video");
}

function normalizeShareVideoFile(shareId, item = {}) {
  const fileId = String(item?.fileId || "").trim();
  const fileName = String(item?.fileName || "").trim();
  return {
    shareId,
    mappingId: `${shareId}|${fileId}`,
    fileId,
    fileName,
    fileSize: Number(item?.fileSize || 0) || 0,
    gcid: extractGcid(item?.thumbnail || item?.gcid || ""),
    parentId: String(item?.parentId || "").trim(),
    thumbnail: String(item?.thumbnail || "").trim(),
    depth: Number(item?.depth || 0) || 0,
    ext: String(item?.ext || "").trim(),
  };
}

async function collectShareVideoFiles(shareId, accessToken, parentId = "", depth = 0, visited = new Set()) {
  if (depth > MAX_SHARE_DEPTH) return [];
  const visitKey = parentId || "__root__";
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);
  const items = await listShareFiles(accessToken, parentId);
  const results = [];
  for (const item of items) {
    if (isVideoItem(item)) {
      results.push(normalizeShareVideoFile(shareId, item));
      if (results.length >= MAX_SHARE_ITEMS) break;
      continue;
    }
    if (isFolderItem(item)) {
      const nextParentId = String(item?.fileId || "").trim();
      if (!nextParentId) continue;
      const children = await collectShareVideoFiles(shareId, accessToken, nextParentId, depth + 1, visited);
      results.push(...children);
      if (results.length >= MAX_SHARE_ITEMS) break;
    }
  }
  return results;
}

function extractEpisodeNumber(text) {
  const raw = stripExt(text);
  let match = raw.match(/S\d{1,2}E(\d{1,3})/i);
  if (match) return Number(match[1] || 0) || 0;
  match = raw.match(/第\s*(\d{1,4})\s*[集话期]/);
  if (match) return Number(match[1] || 0) || 0;
  match = raw.match(/EP?(\d{1,3})/i);
  if (match) return Number(match[1] || 0) || 0;
  return 0;
}

function buildEpisodeDisplayName(file, index, total) {
  const raw = stripSiteSuffix(stripExt(file?.fileName || ""));
  const episodeNumber = extractEpisodeNumber(raw);
  let name = "";
  if (total === 1) {
    name = "正片";
  } else if (episodeNumber > 0) {
    name = `第${episodeNumber}集`;
  } else {
    name = raw || `资源${index + 1}`;
  }
  const sizeText = formatFileSize(file?.fileSize || 0);
  return sizeText ? `${name} [${sizeText}]` : name;
}

function buildSharePlayId(meta) {
  try {
    return JSON.stringify(meta || {});
  } catch (_) {
    return "";
  }
}

function parseSharePlayId(playId) {
  try {
    return JSON.parse(String(playId || "{}"));
  } catch (_) {
    return null;
  }
}

async function tryShareDownload(meta) {
  const tokenData = await getShareAccessToken(meta.shareId, meta.code || "");
  const accessToken = String(tokenData?.accessToken || "").trim();
  if (!accessToken) throw new Error("分享 accessToken 为空");
  const json = await panPost("/userres/v1/get_share_download_url", {
    accessToken,
    fileId: meta.fileId,
  }, { referer: meta.shareURL || `${PAN_HOST}/s/${meta.shareId}` });
  if (isPanSuccess(json) && json?.data?.downloadUrl) {
    return json.data.downloadUrl;
  }
  const error = new Error(String(json?.msg || "获取免登录下载地址失败"));
  error.code = getPanCode(json);
  throw error;
}

async function tryPanVodPlay(meta) {
  const auth = normalizePanAuthorization();
  if (!auth) throw new Error("未配置 GUANGYA_PAN_AUTH");
  if (!meta.gcid) throw new Error("缺少视频 gcid");
  const json = await panPost("/userres/v1/file/get_vod_download_url", {
    fileId: meta.fileId,
    gcid: meta.gcid,
  }, {
    referer: meta.shareURL || `${PAN_HOST}/s/${meta.shareId}`,
    withAuth: true,
  });
  if (isPanSuccess(json) && json?.data?.signedURL) {
    return json.data.signedURL;
  }
  const error = new Error(String(json?.msg || "获取播放地址失败"));
  error.code = getPanCode(json);
  throw error;
}

async function home(params, context) {
  try {
    const html = await requestText(`${HOST}/`, { referer: `${HOST}/` });
    startAutoCheckin("home", html);
    const $ = cheerio.load(html);
    const list = dedupeVodList([
      ...extractPostsCards($),
      ...extractTermCards($),
    ]).slice(0, 20);
    await OmniBox.log("info", `[光鸭][home] list=${list.length}`);
    return {
      class: CLASS_LIST,
      filters: FILTERS,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[光鸭][home] ${error.message}`);
    return {
      class: CLASS_LIST,
      filters: FILTERS,
      list: [],
    };
  }
}

async function category(params, context) {
  const fallbackCategoryId = String(params?.categoryId || params?.type_id || params?.id || "film").trim() || "film";
  const fallbackPage = Math.max(1, parseInt(params?.page || 1, 10) || 1);
  try {
    const categoryId = fallbackCategoryId;
    const page = fallbackPage;
    const state = resolveCategoryState(categoryId, params || {});
    const url = buildCategoryUrl(state.categoryPath, page, state.filters.orderby);
    const html = await requestText(url, { referer: `${HOST}/` });
    const $ = cheerio.load(html);
    const list = extractPostsCards($);
    const pagecount = parseCategoryPageCount(html, state.categoryPath, page);
    await OmniBox.log("info", `[光鸭][category] category=${categoryId} subclass=${state.filters.subclass || "-"} orderby=${state.filters.orderby || "-"} page=${page} path=${state.categoryPath} list=${list.length} pagecount=${pagecount}`);
    return {
      page,
      pagecount,
      total: list.length,
      filters: FILTERS[categoryId] || [],
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[光鸭][category] ${error.message}`);
    return {
      page: fallbackPage,
      pagecount: 0,
      total: 0,
      filters: FILTERS[fallbackCategoryId] || [],
      list: [],
    };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    const page = Math.max(1, parseInt(params.page || 1, 10) || 1);
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };
    const url = `${HOST}/?s=${encodeURIComponent(keyword)}&type=post`;
    const html = await requestText(url, { referer: `${HOST}/` });
    startAutoCheckin(`search:${keyword}`, html);
    const $ = cheerio.load(html);
    const normalizedKeyword = normalizeKeyword(keyword);
    let list = dedupeVodList([
      ...extractPostsCards($),
      ...extractTermCards($),
      ...extractKeywordAnchors($, keyword),
    ]).filter((item) => {
      const haystack = `${normalizeKeyword(item.vod_name)} ${normalizeKeyword(item.vod_content)} ${normalizeKeyword(item.vod_remarks)}`;
      return haystack.includes(normalizedKeyword);
    });
    await OmniBox.log("info", `[光鸭][search] keyword=${keyword} list=${list.length}`);
    return {
      page,
      pagecount: 1,
      total: list.length,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[光鸭][search] ${error.message}`);
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || params.url || "").trim();
    if (!videoId) return { list: [] };
    const detailUrl = /^https?:\/\//i.test(videoId) ? videoId : absUrl(videoId, HOST);
    let html = await requestText(detailUrl, { referer: `${HOST}/` });
    html = await maybeUnlockHiddenDetail(detailUrl, html);
    const hiddenAfterUnlock = isLockedHidden(html);
    if (hiddenAfterUnlock) {
      await OmniBox.log("warn", `[光鸭][detail] 解锁后详情仍为隐藏状态: ${detailUrl}`);
    }
    const $ = cheerio.load(html);
    const meta = extractDetailMeta($, detailUrl);
    const shareResult = extractShareEntries($, html);
    const shareEntries = shareResult.entries || [];
    const shareDiagnostics = shareResult.diagnostics || { anchorCandidateCount: 0, textCandidateCount: 0 };
    await OmniBox.log("info", `[光鸭][detail] 分享提取 anchorCandidates=${shareDiagnostics.anchorCandidateCount || 0} textCandidates=${shareDiagnostics.textCandidateCount || 0} uniqueShares=${shareEntries.length}`);
    const playSources = [];
    const lineNameCount = {};

    for (const entry of shareEntries) {
      const shareId = entry.shareId || parseShareId(entry.shareURL);
      if (!shareId) continue;
      try {
        const summary = await getShareSummary(shareId).catch(() => ({}));
        const tokenData = await getShareAccessToken(shareId, entry.code || "");
        const accessToken = String(tokenData?.accessToken || "").trim();
        if (!accessToken) throw new Error("分享 accessToken 为空");
        const files = await collectShareVideoFiles(shareId, accessToken, "", 0, new Set());
        const baseLineName = stripSiteSuffix(entry.title || summary?.title || `光鸭云盘-${shareId.slice(0, 6)}`) || `光鸭云盘-${shareId.slice(0, 6)}`;
        lineNameCount[baseLineName] = (lineNameCount[baseLineName] || 0) + 1;
        const lineName = lineNameCount[baseLineName] > 1 ? `${baseLineName}-${lineNameCount[baseLineName]}` : baseLineName;

        if (!files.length) {
          playSources.push({
            name: lineName,
            episodes: [{
              name: "打开分享页",
              playId: `share|||${encodeURIComponent(entry.shareURL)}`,
            }],
          });
          await OmniBox.log("warn", `[光鸭][detail] share=${shareId} 未解析到视频文件，回退分享页`);
          continue;
        }

        const episodes = files.map((file, index) => ({
          name: buildEpisodeDisplayName(file, index, files.length),
          playId: buildSharePlayId({
            detailId: detailUrl,
            shareId,
            shareURL: entry.shareURL,
            code: entry.code || "",
            fileId: file.fileId,
            gcid: file.gcid,
            fileName: file.fileName,
            episodeName: buildEpisodeDisplayName(file, index, files.length),
            mappingId: file.mappingId,
            vodName: meta.vod_name,
            pic: meta.vod_pic,
          }),
        }));

        playSources.push({ name: lineName, episodes });
        await OmniBox.log("info", `[光鸭][detail] share=${shareId} files=${files.length} line=${lineName}`);
      } catch (error) {
        await OmniBox.log("warn", `[光鸭][detail] 处理分享失败 share=${shareId}: ${error.message}`);
        playSources.push({
          name: stripSiteSuffix(entry.title || `光鸭云盘-${shareId.slice(0, 6)}`),
          episodes: [{
            name: "打开分享页",
            playId: `share|||${encodeURIComponent(entry.shareURL)}`,
          }],
        });
      }
    }

    if (!playSources.length) {
      if (hiddenAfterUnlock) {
        meta.vod_content = `${meta.vod_content || ""}${meta.vod_content ? "\n\n" : ""}当前详情仍处于隐藏状态，评论解锁未生效，请检查 GUANGYA_COOKIE 与评论接口返回日志。`;
      }
      playSources.push({
        name: "详情页",
        episodes: [{ name: isLockedHidden(html) ? "当前资源暂未解锁" : "打开详情页", playId: `page|||${encodeURIComponent(detailUrl)}` }],
      });
    }

    await OmniBox.log("info", `[光鸭][detail] detail=${detailUrl} hidden=${hiddenAfterUnlock ? 1 : 0} shares=${shareEntries.length} playSources=${playSources.length}`);
    return {
      list: [{
        ...meta,
        vod_play_sources: playSources,
      }],
    };
  } catch (error) {
    await OmniBox.log("error", `[光鸭][detail] ${error.message}`);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params.playId || params.id || params.url || "").trim();
    if (!playId) return { parse: 0, url: "", urls: [], header: {}, headers: {}, flag: "guangya" };

    if (playId.startsWith("page|||")) {
      const pageUrl = decodeURIComponent(playId.slice("page|||".length));
      const header = buildSiteHeaders(pageUrl);
      return {
        parse: 1,
        jx: 0,
        url: pageUrl,
        urls: [{ name: "打开详情页", url: pageUrl }],
        header,
        headers: header,
        flag: "guangya-page",
      };
    }

    if (playId.startsWith("share|||")) {
      const shareUrl = decodeURIComponent(playId.slice("share|||".length));
      const header = buildSharePageHeaders(shareUrl);
      return {
        parse: 1,
        jx: 0,
        url: shareUrl,
        urls: [{ name: "打开分享页", url: shareUrl }],
        header,
        headers: header,
        flag: "guangya-share",
      };
    }

    const meta = parseSharePlayId(playId);
    if (!meta || !meta.shareId || !meta.fileId) {
      throw new Error("播放参数无效");
    }

    const shareUrl = String(meta.shareURL || `${PAN_HOST}/s/${meta.shareId}`).trim();
    const sharePageHeader = buildSharePageHeaders(shareUrl);

    try {
      const downloadUrl = await tryShareDownload(meta);
      await OmniBox.log("info", `[光鸭][play] 使用分享下载直链 shareId=${meta.shareId} fileId=${meta.fileId}`);
      return {
        parse: 0,
        jx: 0,
        url: downloadUrl,
        urls: [{ name: meta.episodeName || meta.fileName || "播放", url: downloadUrl }],
        header: {},
        headers: {},
        flag: "guangya-share-download",
      };
    } catch (error) {
      await OmniBox.log("warn", `[光鸭][play] 免登录下载失败: ${error.message}`);
    }

    try {
      const playUrl = await tryPanVodPlay(meta);
      await OmniBox.log("info", `[光鸭][play] 使用光鸭云盘授权播放 shareId=${meta.shareId} fileId=${meta.fileId}`);
      return {
        parse: 0,
        jx: 0,
        url: playUrl,
        urls: [{ name: meta.episodeName || meta.fileName || "播放", url: playUrl }],
        header: {},
        headers: {},
        flag: "guangya-pan-auth",
      };
    } catch (error) {
      await OmniBox.log("warn", `[光鸭][play] 授权播放失败: ${error.message}`);
    }

    await OmniBox.log("warn", `[光鸭][play] 回退分享页 shareId=${meta.shareId} fileId=${meta.fileId}`);
    return {
      parse: 1,
      jx: 0,
      url: shareUrl,
      urls: [{ name: meta.episodeName || meta.fileName || "打开分享页", url: shareUrl }],
      header: sharePageHeader,
      headers: sharePageHeader,
      flag: "guangya-share-fallback",
    };
  } catch (error) {
    await OmniBox.log("error", `[光鸭][play] ${error.message}`);
    return {
      parse: 0,
      jx: 0,
      url: "",
      urls: [],
      header: {},
      headers: {},
      flag: "guangya-error",
    };
  }
}
