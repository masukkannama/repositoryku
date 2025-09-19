const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0";

const Empty = new Response(null, { status: 404 });
const GroupMap = {
  category: "category/",
  maker: "category/maker/",
  cast: "category/cast/",
  tag: "tag/",
};

type MediaItem = {
  id: string;
  title: string;
  thumb: string;
};

type MediaItemWithURL = MediaItem & {
  m3u8Url: string | null;
};

async function handler(req: Request) {
  const uri = new URL(req.url);
  let lang = uri.searchParams.get("lang") || "en";
  const count = parseInt(uri.searchParams.get("count") || "10");

  if (req.method !== "GET") return Empty;
  if (lang !== "zh" && lang !== "en" && lang !== "ja") {
    lang = "en";
  }

  // ========== ENDPOINT: /json/all/... ==========
  if (uri.pathname.startsWith("/json/all/")) {
    const idsPart = uri.pathname.replace("/json/all/", "").trim();

    let idList: string[] = [];
    if (idsPart.startsWith("range/")) {
      const [start, end] = idsPart.replace("range/", "").split("-").map(Number);
      for (let i = start; i <= end; i++) {
        idList.push(String(i));
      }
    } else {
      idList = idsPart.split("-").map((id) => id.trim());
    }

    const items = await fetchSequential(idList.slice(0, count));

    return new Response(
      JSON.stringify({ page: 1, count: items.length, items }, null, 2),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // ========== ENDPOINT: /json/list/... ==========
  if (uri.pathname.match(/^\/json\/(day|week|month|search|category|maker|cast|tag)/)) {
    let list: MediaItemWithURL[] | null = null;
    let base: URL;

    const pathParts = uri.pathname.split("/");
    const type = pathParts[2];
    const param = pathParts.slice(3).join("/");

    if (type === "day" || type === "week" || type === "month") {
      base = new URL(`/${lang}/popular`, "https://supjav.com");
      base.searchParams.set("sort", type);
      list = await getList(base, count);
    } else if (type === "search") {
      base = new URL(`/${lang}/`, "https://supjav.com");
      base.searchParams.set("s", param);
      list = await getList(base, count);
    } else {
      const key = type;
      const pages = parseInt(uri.searchParams.get("page") || "1");

      let p = "/";
      if (lang !== "en") p += lang + "/";
      base = new URL(p + GroupMap[key as keyof typeof GroupMap] + param, "https://supjav.com");
      list = await getList(base, count, pages);
    }

    if (!list) return Empty;

    return new Response(JSON.stringify({ page: 1, count: list.length, items: list }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  return Empty;
}

// ===== Helper Functions =====
async function getM3U8ById(id: string): Promise<MediaItemWithURL> {
  try {
    const html = await fetchHTML(`https://supjav.com/${id}.html`);

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const thumbMatch = html.match(/https:\/\/[^"]+?\.jpg/);
    const thumb = thumbMatch ? thumbMatch[0] : "";

    const m3u8Match = html.match(/https:\/\/[^"]+\.m3u8/);
    const m3u8Url = m3u8Match ? m3u8Match[0] : null;

    return { id, title, thumb, m3u8Url };
  } catch (e) {
    return { id, title: "", thumb: "", m3u8Url: null };
  }
}

async function fetchSequential(ids: string[]) {
  const results: MediaItemWithURL[] = [];
  for (let id of ids) {
    const item = await getM3U8ById(id);
    results.push(item);
    await delay(500); // supaya tidak diblok Cloudflare
  }
  return results;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function extractMediaList(body: string): MediaItem[] | null {
  const list = body.match(
    /https:\/\/supjav\.com\/.*?\d+\.html.*?title=\".*?\".*?data-original=\".*?\"/gm
  );
  if (!list) return null;
  return list.map((item) => {
    const id = item.match(/supjav\.com\/.*?(\d+)\.html/)![1];
    const title = item.match(/title=\"(.*?)\"/)![1];
    const thumb = item.match(/data-original=\"(.*?)\"/)![1].split("!")[0];
    return { id, title, thumb };
  });
}

async function fetchHTML(url: string | URL) {
  const req = await fetch(url, {
    headers: { "user-agent": UA, referer: "https://supjav.com/" },
  });
  return await req.text();
}

async function getList(base: URL, count = 10, pages = 1) {
  const arr = [fetchHTML(base)];
  for (let i = 2; i <= pages; i++) {
    const u = new URL(base.href);
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname = u.pathname + "page/" + i;
    arr.push(fetchHTML(u));
  }
  const list = await Promise.all(arr);
  const mediaList = list.map(extractMediaList).filter((i) => !!i).flat() as MediaItem[];

  const updatedList: MediaItemWithURL[] = [];
  for (const item of mediaList.slice(0, count)) {
    const m3u8Url = (await getM3U8ById(item.id)).m3u8Url;
    updatedList.push({ ...item, m3u8Url });
    await delay(500); // supaya stabil
  }
  return updatedList;
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
