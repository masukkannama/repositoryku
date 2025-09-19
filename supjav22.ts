const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0";

const Empty = new Response(null, { status: 404 });

type MediaItem = {
  id: string;
  title: string;
  thumb: string;
  m3u8Url: string | null;
};

async function handler(req: Request) {
  const url = new URL(req.url);
  if (req.method !== "GET") return Empty;

  // endpoint list (day, week, month, search, category, tag, cast, maker)
  if (url.pathname.startsWith("/json/list/")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const type = parts[2];
    const keyword = parts[3] || "";
    return handleList(req, type, keyword);
  }

  // endpoint all by ids: /json/all/123-124-125
  if (url.pathname.startsWith("/json/all/")) {
    const parts = url.pathname.split("/").filter(Boolean);

    // range mode
    if (parts[2] === "range") {
      const [start, end] = parts[3].split("-").map((x) => parseInt(x, 10));
      const ids: string[] = [];
      for (let i = start; i <= end; i++) ids.push(String(i));
      const items = await Promise.all(ids.map(fetchFullById));
      return new Response(JSON.stringify(items, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    // manual list
    const ids = parts[2].split("-");
    const items = await Promise.all(ids.map(fetchFullById));
    return new Response(JSON.stringify(items, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  return Empty;
}

// -------------------- LIST HANDLER --------------------

async function handleList(req: Request, type: string, keyword?: string) {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const count = Math.min(
    parseInt(url.searchParams.get("count") || "10", 10),
    20
  ); // default 10, max 20

  let targetUrl = "";
  if (["day", "week", "month"].includes(type)) {
    targetUrl = `https://supjav.com/${type}/${page}`;
  } else if (type === "search" && keyword) {
    targetUrl = `https://supjav.com/search/${encodeURIComponent(keyword)}/${page}`;
  } else if (type === "category" && keyword) {
    targetUrl = `https://supjav.com/category/${encodeURIComponent(keyword)}/${page}`;
  } else if (type === "tag" && keyword) {
    targetUrl = `https://supjav.com/tag/${encodeURIComponent(keyword)}/${page}`;
  } else if (type === "cast" && keyword) {
    targetUrl = `https://supjav.com/cast/${encodeURIComponent(keyword)}/${page}`;
  } else if (type === "maker" && keyword) {
    targetUrl = `https://supjav.com/maker/${encodeURIComponent(keyword)}/${page}`;
  } else {
    return Empty;
  }

  const res = await fetch(targetUrl, {
    headers: { "user-agent": UA, referer: "https://supjav.com/" },
  });
  const html = await res.text();

  // ambil ID dari halaman
  const matches = [...html.matchAll(/href="\/(\d+)\.html"/g)];
  const ids = matches.map((m) => m[1]).slice(0, count);

  // ambil detail lengkap
  const items = await Promise.all(ids.map(fetchFullById));

  return new Response(JSON.stringify({ page, count, items }, null, 2), {
    headers: { "content-type": "application/json" },
  });
}

// -------------------- FETCH DETAIL --------------------

async function fetchFullById(id: string): Promise<MediaItem> {
  const url = `https://supjav.com/${id}.html`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, referer: "https://supjav.com/" },
  });
  const html = await res.text();

  // Title (meta og:title → fallback ke <title>)
  const titleMatch =
    html.match(/<meta\s+property="og:title"\s+content="(.*?)"/i) ||
    html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Thumbnail (meta og:image → fallback data-original/src)
  const imgMatch =
    html.match(/<meta\s+property="og:image"\s+content="(.*?)"/i) ||
    html.match(/data-original="(.*?)"/i) ||
    html.match(/src="(https:\/\/[^"]+\.jpg)"/i);
  const thumb = imgMatch ? imgMatch[1].split("!")[0] : "";

  // M3U8 URL
  const m3u8Url = await getM3U8FromHtml(html);

  return { id, title, thumb, m3u8Url };
}

async function getM3U8FromHtml(html: string): Promise<string | null> {
  const linkList = html.match(/data-link\=".*?">.*?</gm);
  if (!linkList) return null;

  const serverMap = makeServerList(linkList);
  if (!serverMap.TV) return null;

  const tvid = serverMap.TV.split("").reverse().join("");
  const res = await fetch(
    `https://lk1.supremejav.com/supjav.php?c=${tvid}`,
    { headers: { referer: "https://supjav.com/", "user-agent": UA } }
  );
  const text = await res.text();
  const urlMatch = text.match(/urlPlay.*?(https.*?\.m3u8)/m);
  return urlMatch ? urlMatch[1] : null;
}

function makeServerList(arr: RegExpMatchArray) {
  const result: Record<string, string> = {};
  for (const item of arr) {
    const i = item.indexOf(">");
    const key = item.slice(i + 1, -1);
    const val = item.slice(11, i - 1);
    result[key] = val;
  }
  return result;
}

export default { fetch: handler };
