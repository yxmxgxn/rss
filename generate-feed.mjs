// ToMoKo (hp-setlist.com) のお知らせJSONから RSS 2.0 の feed.xml を生成する個人用スクリプト。
// 使い方: node generate-feed.mjs [入力JSONのパス]   （省略時は本番URLを取得）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SITE = "https://hp-setlist.com";
const SOURCE = `${SITE}/data/announcements.json`;
const OUT_DIR = "public";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// "2026-10-10"（日付のみ）は日本時間の0時として扱う。タイムスタンプ付きはそのまま。
function toDate(s) {
  if (!s) return new Date(0);
  const str = String(s);
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T00:00:00+09:00` : str);
}

const inputPath = process.argv[2];
const json = inputPath
  ? JSON.parse(readFileSync(inputPath, "utf8"))
  : await fetch(SOURCE, { headers: { "User-Agent": "personal-rss-bridge" } }).then((r) => {
      if (!r.ok) throw new Error(`取得失敗: ${r.status}`);
      return r.json();
    });

// details が本体。無ければ dashboard.releases を使う。
const entries = json.details?.length ? json.details : json.dashboard?.releases ?? [];
if (!entries.length) throw new Error("お知らせが0件でした。JSONの形式が変わった可能性があります");

const items = entries
  .map((e) => ({
    title: e.title,
    link: `${SITE}/release/${e.releaseId}`,
    guid: `${SITE}/release/${e.releaseId}`,
    date: toDate(e.releasedAt),
    desc: e.summary,
    tags: e.tags ?? [],
  }))
  .sort((a, b) => b.date - a.date);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>ToMoKo お知らせ（非公式・個人用）</title>
<link>${SITE}/articles</link>
<description>ハロプロセトリ検索システム ToMoKo のお知らせを個人用にRSS化したものです</description>
<language>ja</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items
  .map(
    (i) => `<item>
<title>${esc(i.title)}</title>
<link>${esc(i.link)}</link>
<guid isPermaLink="true">${esc(i.guid)}</guid>
<pubDate>${i.date.toUTCString()}</pubDate>
<description>${esc(i.desc)}</description>
${i.tags.map((t) => `<category>${esc(t)}</category>`).join("\n")}
</item>`
  )
  .join("\n")}
</channel>
</rss>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/feed.xml`, xml);
writeFileSync(
  `${OUT_DIR}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>ToMoKo お知らせ RSS</title><p><a href="feed.xml">feed.xml</a>（非公式・個人用）</p>`
);
console.log(`feed.xml: ${items.length}件 (最新: ${items[0].title})`);
