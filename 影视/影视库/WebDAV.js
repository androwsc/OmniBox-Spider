// @name WebDAV
// @author lampon
// @description 
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/影视库/WebDAV.js
// @dependencies: crypto

/**
 * 定时任务：将 WebDAV 数据源中的视频写入本地影视库（media_library_items）
 *
 * 参考 scheduled_task_drive_batch_to_library.js：
 * - batch 模式：分类文件夹 / 影片文件夹 / 多集视频...
 * - flat  模式：分类文件夹 / 单集视频文件...
 *
 * 本脚本通过 WebDAV 标准 PROPFIND 列目录（后端 /api/spider/omnibox/request 支持任意 Method），
 * 不依赖额外 npm 依赖。
 *
 * 环境变量：
 *   OMNIBOX_API_URL=http://127.0.0.1:端口/api/spider/omnibox
 *
 *   # 必填：WebDAV 入口（以 http/https 开头）
 *   WEBDAV_BASE_URL=https://dav.example.com/dav/
 *
 *   # 可选：Basic Auth（若不填则不带 Authorization）
 *   # 凭证以 Authorization: Basic ... 存储在 header 中，不会嵌入播放地址 URL
 *   WEBDAV_USERNAME=xxx
 *   WEBDAV_PASSWORD=yyy
 *
 *   # 可选：从哪个路径开始扫（相对 WEBDAV_BASE_URL），如 /影视/ 或 影视/
 *   WEBDAV_ROOT_PATH=/
 *
 *   # 导入模式：batch / flat（默认 batch）
 *   WEBDAV_IMPORT_MODE=batch
 *
 */

const crypto = require("crypto");
const OmniBox = require("omnibox_sdk");

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

function normalizeFolderName(s) {
  const t = String(s || "").trim();
  return t || "未命名";
}

function stripExtension(fileName) {
  const s = String(fileName || "").trim();
  const dot = s.lastIndexOf(".");
  return dot > 0 ? s.slice(0, dot) : s;
}

function isVideoName(name) {
  const fileName = String(name || "").toLowerCase();
  const videoExtensions = [
    ".mp4",
    ".mkv",
    ".avi",
    ".flv",
    ".mov",
    ".wmv",
    ".m3u8",
    ".ts",
    ".webm",
    ".m4v",
    ".iso",
  ];
  return videoExtensions.some((ext) => fileName.endsWith(ext));
}

// 全量扫描仍需一个硬上限，避免异常目录结构导致无限递归
const MAX_WALK_DEPTH = 64;
const DEFAULT_CATEGORY = "未分类";

function ensureLeadingSlash(p) {
  const s = String(p || "").trim();
  if (!s) return "/";
  return s.startsWith("/") ? s : "/" + s;
}

function ensureTrailingSlash(p) {
  const s = String(p || "").trim();
  if (!s) return "/";
  return s.endsWith("/") ? s : s + "/";
}

function buildBasicAuthHeader(user, pass) {
  const u = String(user || "");
  const p = String(pass || "");
  if (!u) return "";
  return "Basic " + Buffer.from(`${u}:${p}`, "utf8").toString("base64");
}

function buildWebdavUrl(baseUrlObj, path) {
  return new URL(path, baseUrlObj).toString();
}

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 解析 PROPFIND 的 XML（最小可用实现，避免引入 xml2js）
 * 返回：[{ href, isDir, size }]
 */
function parsePropfindXml(xmlText) {
  const xml = String(xmlText || "");
  const responses = [];
  const blocks =
    xml.match(/<[^:>]*:?response[\s\S]*?<\/[^:>]*:?response>/gi) || [];
  for (const block of blocks) {
    const hrefMatch = block.match(
      /<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/i,
    );
    const hrefRaw =
      hrefMatch && hrefMatch[1] ? decodeXmlEntities(hrefMatch[1]).trim() : "";
    if (!hrefRaw) continue;

    const isDir = /<[^:>]*:?collection\b/i.test(block) || hrefRaw.endsWith("/");
    const lenMatch = block.match(
      /<[^:>]*:?getcontentlength[^>]*>([\s\S]*?)<\/[^:>]*:?getcontentlength>/i,
    );
    const size =
      lenMatch && lenMatch[1]
        ? parseInt(String(lenMatch[1]).trim(), 10) || 0
        : 0;

    responses.push({ href: hrefRaw, isDir, size });
  }
  return responses;
}

function normalizeHrefToPath(href, baseUrlObj) {
  try {
    const u = new URL(href, baseUrlObj);
    let p = u.pathname || "/";
    // 解码（注意 WebDAV 服务可能返回已编码路径）
    try {
      p = decodeURIComponent(p);
    } catch (_) {
      // ignore
    }
    return ensureLeadingSlash(p);
  } catch (_) {
    return ensureLeadingSlash(href);
  }
}

function headerGet(headers, key) {
  if (!headers) return "";
  const lower = String(key || "").toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === lower)
      return Array.isArray(v) ? String(v[0] || "") : String(v || "");
  }
  return "";
}

function isRedirectStatus(code) {
  return (
    code === 301 || code === 302 || code === 303 || code === 307 || code === 308
  );
}

async function requestWithRedirects(url, options, maxHops) {
  let currentUrl = String(url);
  let hops = Math.max(0, Number(maxHops) || 0);

  // 保留原始 method；对 303 允许退化为 GET（少见，但更符合语义）
  let method = String((options && options.method) || "GET").toUpperCase();
  let body = options && options.body;

  while (true) {
    const resp = await OmniBox.request(currentUrl, {
      ...(options || {}),
      method,
      body,
    });
    if (!isRedirectStatus(resp.statusCode) || hops <= 0) {
      return { url: currentUrl, resp };
    }

    const loc = headerGet(resp.headers, "location");
    if (!loc) return { url: currentUrl, resp };
    const next = new URL(loc, currentUrl).toString();

    // 303：通常要求客户端用 GET 拉取结果
    if (resp.statusCode === 303) {
      method = "GET";
      body = undefined;
    }

    currentUrl = next;
    hops--;
  }
}

async function propfindOnce(fullUrl, authHeader) {
  const headers = {
    Depth: "1",
    "Content-Type": "application/xml; charset=utf-8",
    "User-Agent": "OmniBox-WebDAV/1.0",
  };
  if (authHeader) headers.Authorization = authHeader;

  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
  </d:prop>
</d:propfind>`;

  return await requestWithRedirects(
    fullUrl,
    {
      method: "PROPFIND",
      headers,
      body,
    },
    5,
  );
}

async function propfindList(baseUrlObj, path, authHeader) {
  const fullUrlA = new URL(path, baseUrlObj).toString();
  const fullUrlB = new URL(
    path.endsWith("/") ? path.replace(/\/+$/g, "") : ensureTrailingSlash(path),
    baseUrlObj,
  ).toString();

  const tried = [];
  for (const fullUrl of Array.from(new Set([fullUrlA, fullUrlB]))) {
    tried.push(fullUrl);
    const { resp, url } = await propfindOnce(fullUrl, authHeader);

    if (resp.statusCode === 207 || resp.statusCode === 200) {
      const items = parsePropfindXml(resp.body || "");
      const out = [];
      for (const it of items) {
        const p = normalizeHrefToPath(it.href, baseUrlObj);
        out.push({ path: p, isDir: !!it.isDir, size: it.size || 0 });
      }
      return out;
    }

    // 405：常见于“地址不是 WebDAV/被反代拦了/需要换路径”
    if (resp.statusCode === 405) {
      const allow = headerGet(resp.headers, "allow");
      const dav = headerGet(resp.headers, "dav");
      const preview = String(resp.body || "").slice(0, 300);
      console.warn(
        `[webdav] PROPFIND 405: url=${url} allow=${allow || "-"} dav=${dav || "-"} body=${preview || "-"}`,
      );
      continue;
    }

    const preview = String(resp.body || "").slice(0, 300);
    throw new Error(
      `PROPFIND失败: HTTP ${resp.statusCode} url=${url} body=${preview || "-"}`,
    );
  }

  throw new Error(`PROPFIND失败: HTTP 405 (tried ${tried.join(" , ")})`);
}

function basenameFromPath(p) {
  const s = String(p || "");
  const parts = s.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function categoryAndMovieFromPath(
  pathFromRoot,
  defaultCategory,
  rootDisplayName,
) {
  const p = (pathFromRoot || []).map(normalizeFolderName).filter(Boolean);
  const dc = normalizeFolderName(defaultCategory || "未分类");
  const rd = normalizeFolderName(rootDisplayName || "WebDAV");

  if (p.length >= 2) {
    return { category: p[p.length - 2], movieName: p[p.length - 1] };
  }
  if (p.length === 1) {
    return { category: dc, movieName: p[0] };
  }
  return { category: dc, movieName: rd };
}

function groupKey(category, movieName) {
  return `${category}\n${movieName}`;
}

function sortEpisodesNatural(episodes) {
  const arr = (episodes || []).slice();
  arr.sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return arr;
}

async function walkWebdav(state, currentDavPath, pathFromRoot, depth) {
  if (depth > MAX_WALK_DEPTH) return;

  const items = await propfindList(
    state.baseUrlObj,
    ensureTrailingSlash(currentDavPath),
    state.authHeader,
  );
  state.listRequests++;

  const subTasks = [];
  for (const it of items) {
    const childPath = it.path;
    // PROPFIND 会包含当前目录自身，跳过
    if (ensureTrailingSlash(childPath) === ensureTrailingSlash(currentDavPath))
      continue;

    const name = basenameFromPath(childPath);
    if (!name) continue;

    if (it.isDir) {
      subTasks.push(
        walkWebdav(state, childPath, [...pathFromRoot, name], depth + 1).catch(
          async (e) => {
            console.warn(`[webdav] 子目录失败 path=${childPath}: ${e.message}`);
          },
        ),
      );
      continue;
    }

    if (!isVideoName(name)) continue;

    if (state.importMode === "flat") {
      const category =
        pathFromRoot.length > 0
          ? normalizeFolderName(pathFromRoot[pathFromRoot.length - 1])
          : DEFAULT_CATEGORY;
      const title = stripExtension(name);
      const playId = buildWebdavUrl(state.baseUrlObj, childPath);
      state.flatItems.push({
        category,
        title,
        originalTitle: title,
        fileName: name,
        playId,
        size: it.size || 0,
        path: [...pathFromRoot, name].join("/"),
      });
      state.videoCount++;
      continue;
    }

    // batch 模式：按 分类/影片 分组
    const { category, movieName } = categoryAndMovieFromPath(
      pathFromRoot,
      DEFAULT_CATEGORY,
      state.rootDisplayName,
    );
    const gk = groupKey(category, movieName);
    if (!state.groups.has(gk)) {
      state.groups.set(gk, { category, movieName, episodes: [] });
    }
    const playId = buildWebdavUrl(state.baseUrlObj, childPath);
    state.groups.get(gk).episodes.push({
      name,
      playId,
      size: it.size || 0,
      path: [...pathFromRoot, name].join("/"),
    });
    state.videoCount++;
  }

  if (subTasks.length) {
    await Promise.all(subTasks);
  }
}

async function upsertBatchGroups(state) {
  const payloads = [];
  for (const [, grp] of Array.from(state.groups.entries())) {
    const { category, movieName, episodes } = grp;
    const dedup = [];
    const seen = new Set();
    for (const ep of episodes || []) {
      if (!ep.playId || seen.has(ep.playId)) continue;
      seen.add(ep.playId);
      dedup.push(ep);
    }
    const eps = sortEpisodesNatural(dedup);
    if (!eps.length) continue;

    const sourceKey = sha256Hex(
      `${state.baseUrlObj.toString()}\n${state.rootPath}\n${category}\n${movieName}`,
    );
    const title =
      String(movieName || "")
        .slice(0, 250)
        .trim() || movieName;

    payloads.push({
      sourceType: "webdav",
      sourceKey,
      from: state.baseUrlObj.toString(),
      title,
      originalTitle: movieName,
      year: "",
      genres: [category],
      description: `WebDAV · 分类「${category}」· 共 ${eps.length} 个视频`,
      coverUrl: "",
      playbackPayload: {
        kind: "webdav",
        baseUrl: state.baseUrlObj.toString(),
        rootPath: state.rootPath,
        category,
        movieName,
        episodes: eps,
        header: state.playHeader,
      },
      extra: {
        baseUrl: state.baseUrlObj.toString(),
        rootPath: state.rootPath,
        category,
        movieName,
        importedAt: new Date().toISOString(),
        episodeCount: eps.length,
        listRequests: state.listRequests,
      },
    });
  }

  const BATCH_SIZE = 50;
  let written = 0;
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    written += await OmniBox.upsertMediaItems(
      payloads.slice(i, i + BATCH_SIZE),
    );
  }
  return written;
}

async function upsertFlatItems(state) {
  // playId 去重
  const seen = new Set();
  const items = [];
  for (const it of state.flatItems) {
    if (!it.playId || seen.has(it.playId)) continue;
    seen.add(it.playId);
    items.push(it);
  }

  const payloads = [];
  for (const it of items) {
    const sourceKey = sha256Hex(
      `${state.baseUrlObj.toString()}\n${state.rootPath}\n${it.playId}`,
    );
    const title =
      String(it.title || "")
        .slice(0, 250)
        .trim() || it.title;

    payloads.push({
      sourceType: "webdav",
      sourceKey,
      from: state.baseUrlObj.toString(),
      title,
      originalTitle: it.originalTitle,
      year: "",
      genres: [it.category],
      description: `WebDAV · 分类「${it.category}」`,
      coverUrl: "",
      playbackPayload: {
        kind: "webdav",
        baseUrl: state.baseUrlObj.toString(),
        rootPath: state.rootPath,
        category: it.category,
        movieName: it.title,
        episodes: [
          {
            name: it.fileName,
            playId: it.playId,
            size: it.size,
            path: it.path,
          },
        ],
        header: state.playHeader,
      },
      extra: {
        baseUrl: state.baseUrlObj.toString(),
        rootPath: state.rootPath,
        category: it.category,
        fileName: it.fileName,
        importedAt: new Date().toISOString(),
        listRequests: state.listRequests,
      },
    });
  }

  const BATCH_SIZE = 50;
  let written = 0;
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    written += await OmniBox.upsertMediaItems(
      payloads.slice(i, i + BATCH_SIZE),
    );
  }
  return written;
}

async function main() {
  const baseUrlRaw = String(
    process.env.WEBDAV_BASE_URL || "http://host.docker.internal:5244/dav/夸克/",
  ).trim();
  if (!baseUrlRaw) {
    throw new Error("请配置环境变量 WEBDAV_BASE_URL");
  }
  const baseUrlObj = new URL(baseUrlRaw);
  const user = String(process.env.WEBDAV_USERNAME || "admin").trim();
  const pass = String(process.env.WEBDAV_PASSWORD || "123456").trim();
  const authHeader = buildBasicAuthHeader(user, pass);
  const rootPathRaw = process.env.WEBDAV_ROOT_PATH || "/";
  const rootPath = ensureTrailingSlash(ensureLeadingSlash(rootPathRaw));
  const importMode =
    String(process.env.WEBDAV_IMPORT_MODE || "batch")
      .trim()
      .toLowerCase() === "flat"
      ? "flat"
      : "batch";

  // 凭证存储在 Authorization header 中，playId URL 不内嵌账号密码
  const playHeader = {};
  if (authHeader) {
    playHeader.Authorization = authHeader;
  }

  const state = {
    baseUrlObj,
    authHeader,
    rootPath,
    rootDisplayName: basenameFromPath(rootPath) || "WebDAV",
    importMode,
    playHeader,
    listRequests: 0,
    videoCount: 0,
    groups: new Map(),
    flatItems: [],
  };

  await walkWebdav(state, rootPath, [], 0);

  const writtenCount =
    importMode === "flat"
      ? await upsertFlatItems(state)
      : await upsertBatchGroups(state);

  const summary = {
    success: true,
    baseUrl: baseUrlObj.toString(),
    rootPath,
    importMode,
    listRequests: state.listRequests,
    videoFilesScanned: state.videoCount,
    writtenCount,
  };
  console.log(JSON.stringify(summary));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
