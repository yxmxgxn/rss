// 個人用RSS生成: ToMoKo のお知らせ / えりぽん情報局 → public/<FEED_TOKEN>/*.xml
// 本番: FEED_TOKEN=xxxx node generate-feeds.mjs
// テスト: FEED_TOKEN=test node generate-feeds.mjs tomoko.json eripon-script.js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const TOKEN = process.env.FEED_TOKEN;
if (!TOKEN || !/^[A-Za-z0-9_-]{12,}$/.test(TOKEN) && TOKEN !== "test") {
  throw new Error("FEED_TOKEN（12文字以上の英数字）を環境変数で指定してください");
}
const OUT = `public/${TOKEN}`;
const UA = { headers: { "User-Agent": "personal-rss-bridge" } };

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "2026-10-10" / "2026.10.10" のような日付のみは日本時間0時。タイムスタンプ付きはそのまま。
function toDate(s) {
  if (!s) return new Date(0);
  const str = String(s).trim().replace(/\./g, "-");
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T00:00:00+09:00` : str);
}

async function load(pathOrUrl) {
  if (!/^https?:/.test(pathOrUrl)) return readFileSync(pathOrUrl, "utf8");
  const r = await fetch(pathOrUrl, UA);
  if (!r.ok) throw new Error(`取得失敗 ${pathOrUrl}: ${r.status}`);
  return r.text();
}

function buildRss({ title, link, description, items }) {
  const now = new Date();
  const sorted = items
    .map((i) => ({ ...i, date: i.date > now ? now : i.date })) // 未来日付は今日扱い（リーダーで隠れないように）
    .sort((a, b) => b.date - a.date);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${esc(title)}</title>
<link>${esc(link)}</link>
<description>${esc(description)}</description>
<language>ja</language>
<lastBuildDate>${now.toUTCString()}</lastBuildDate>
${sorted
  .map(
    (i) => `<item>
<title>${esc(i.title)}</title>
<link>${esc(i.link)}</link>
<guid isPermaLink="false">${esc(i.guid)}</guid>
<pubDate>${i.date.toUTCString()}</pubDate>
<description>${esc(i.desc)}</description>
${(i.tags ?? []).map((t) => `<category>${esc(t)}</category>`).join("\n")}
</item>`
  )
  .join("\n")}
</channel>
</rss>
`;
}

/* ---------- ToMoKo ---------- */
async function tomoko(src) {
  const SITE = "https://hp-setlist.com";
  const json = JSON.parse(await load(src));
  const entries = json.details?.length ? json.details : json.dashboard?.releases ?? [];
  if (!entries.length) throw new Error("ToMoKo: お知らせが0件。JSONの形式が変わった可能性");
  const items = entries.map((e) => ({
    title: e.title,
    link: `${SITE}/release/${e.releaseId}`,
    guid: `${SITE}/release/${e.releaseId}`,
    date: toDate(e.releasedAt),
    desc: e.summary,
    tags: e.tags,
  }));
  return { name: "tomoko", count: items.length, xml: buildRss({
    title: "ToMoKo お知らせ（非公式・個人用）",
    link: `${SITE}/articles`,
    description: "ToMoKoのお知らせを個人用にRSS化",
    items,
  }) };
}

/* ---------- えりぽん情報局 ---------- */
// script.js 内の `const xxxData = [ ... ];` を、コードを実行せずに取り出してJSON化する。
function extractArrayLiteral(src, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\[`).exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, quote = null, esc_ = false, out = "", seg = "";
  const flush = () => {
    out += seg
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3') // キーに引用符
      .replace(/,(\s*[}\]])/g, "$1"); // 末尾カンマ除去
    seg = "";
  };
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      out += c;
      if (esc_) esc_ = false;
      else if (c === "\\") esc_ = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"') { flush(); out += c; quote = c; continue; }
    if (c === "'" || c === "`") throw new Error(`${name}: 未対応の引用符 ${c}`);
    if (c === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j + 2) + 1; continue; }
    if (c === "/" && src[j + 1] === "/") { const e = src.indexOf("\n", j); j = e < 0 ? src.length : e - 1; continue; }
    seg += c;
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) { flush(); return JSON.parse(out); }
  }
  throw new Error(`${name}: 配列の終わりが見つからない`);
}

async function eripon(src) {
  const SITE = "https://eripon-info.netlify.app";
  const js = await load(src);
  const kinds = [
    ["newsData", "NEWS", (i) => i.url],
    ["eventData", "イベント", (i) => i.detailUrl || i.officialUrl || i.ticketUrl],
    ["liveData", "生配信", (i) => i.liveUrl],
    ["youtubeData", "YouTube", (i) => i.url],
    ["fcData", "FC配信", (i) => i.url],
    ["tverData", "TVer", (i) => i.url],
  ];
  const items = [];
  for (const [name, label, getUrl] of kinds) {
    const arr = extractArrayLiteral(js, name);
    if (arr === null) { console.warn(`警告: ${name} が見つかりません`); continue; }
    for (const i of arr) {
      const url = getUrl(i);
      const stamp = label === "イベント" ? `（${i.date}）` : "";
      items.push({
        title: `[${label}] ${i.title}${stamp}`,
        link: url || SITE,
        guid: url ? `${label}:${url}` : `${label}:${i.date}:${i.title}`,
        date: toDate(i.date),
        desc: i.description || "",
      });
    }
  }
  if (!items.length) throw new Error("えりぽん: 項目が0件。script.jsの形式が変わった可能性");
  return { name: "eripon", count: items.length, xml: buildRss({
    title: "えりぽん情報局（非公式・個人用）",
    link: SITE,
    description: "生田衣梨奈さん情報ページの更新を個人用にRSS化",
    items,
  }) };
}

/* ---------- 実行 ---------- */
const [tomokoSrc = "https://hp-setlist.com/data/announcements.json", eriponSrc = "https://eripon-info.netlify.app/script.js"] =
  process.argv.slice(2);

mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const job of [() => tomoko(tomokoSrc), () => eripon(eriponSrc)]) {
  try {
    const r = await job();
    writeFileSync(`${OUT}/${r.name}.xml`, r.xml);
    console.log(`${r.name}: ${r.count}件`);
  } catch (e) {
    failed++;
    console.error(`失敗: ${e.message}`); // 片方が壊れてももう片方は公開する
  }
}
// ルートはインデックス拒否のみ。フィードへのリンクは置かない。
writeFileSync("public/index.html", `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title></title>`);
if (failed === 2) process.exit(1);
