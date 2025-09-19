const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0";

const Empty = new Response(null, { status: 404 });
const GroupMap = {
  category: "category/",
  maker: "category/maker/",
  cast: "category/cast/",
  tag: "tag/",
};

async function handler(req) {
  try {
    const uri = new URL(req.url);
    let lang = uri.searchParams.get("lang") || "en";
    if (!["zh", "en", "ja"].includes(lang)) lang = "en";
    if (req.method !== "GET") return Empty;

    // === endpoint list ===
    if (uri.pathname.match(/^\/json\/(day|week|month|search|category|maker|cast|tag)/)) {
      let base;
      const pathParts = uri.pathname.split("/");
      const type = pathParts[2] || "";
      const param = pathParts.slice(3).join("/");
      const page = parseInt(uri.searchParams.get("page") || "1");

      if (["day", "week", "month"].includes(type)) {
        base = new URL(`/${lang}/popular`, "https://supjav.com");
        base.searchParams.set("sort", type);
      } else if (type === "search") {
        base = new URL(`/${lang}/`, "https://supjav.com");
        base.searchParams.set("s", param);
      } else {
        let p = "/";
        if (lang !== "en") p += lang + "/";
        base = new URL(p + GroupMap[type] + param, "https://supjav.com");
      }

      // ambil list
      let list = await getListOnePage(base, page);
      if (!list) return Empty;

      // ambil m3u8 untuk 5 item pertama
      const firstFive = list.slice(0, 5);
      const enriched = await Promise.all(
        firstFive.map(async (item) => {
          const m3u8Url = await getM3U8ById(item.id);
          return { ...item, m3u8Url: m3u8Url || "" };
        })
      );

      // gabungkan hasil: 5 pertama ada m3u8, sisanya cuma meta
      list = [...enriched, ...list.slice(5)];

      return new Response(JSON.stringify(list, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    // === endpoint detail m3u8 ===
    if (uri.pathname.match(/^\/json\/m3u8\//)) {
      const idsParam = uri.pathname.split("/").pop();
      if (!idsParam) return Empty;
      const ids = idsParam.split("-").filter(Boolean);
      if (ids.length > 20) {
        return new Response("Max 20 IDs per request", { status: 400 });
      }

      const results = await Promise.all(
        ids.map(async (id) => {
          const m3u8Url = await getM3U8ById(id);
          return m3u8Url ? { id, m3u8Url } : null;
        })
      );

      return new Response(JSON.stringify(results.filter(Boolean), null, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    return Empty;
  } catch (err) {
    console.error("Worker error:", err);
    return new Response("Internal Error: " + err.message, { status: 500 });
  }
}

// === fungsi pendukung ===
async function getListOnePage(base, page = 1) {
  let u = new URL(base.href);
  if (page > 1) {
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname = u.pathname + "page/" + page;
  }
  const html = await fetchBody(u);
  return extractMediaList(html);
}

async function getM3U8ById(id) {
  const res = await fetch(`https://supjav.com/${id}.html`, {
    headers: { referer: "https://supjav.com/", "user-agent": UA },
  });
  const html = await res.text();

  const linkList = html.match(/data-link=".*?">.*?</g);
  if (!linkList) return null;
  const serverMap = makeServerList(linkList);
  const firstKey = Object.keys(serverMap)[0];
  if (!firstKey) return null;

  const tvid = serverMap[firstKey].split("").reverse().join("");
  const data2 = await (
    await fetch(`https://lk1.supremejav.com/supjav.php?c=${tvid}`, {
      headers: { referer: "https://supjav.com/", "user-agent": UA },
    })
  ).text();

  const match = data2.match(/urlPlay.*?(https.*?\.m3u8)/);
  return match ? match[1] : null;
}

function extractMediaList(body) {
  const list = body.match(/https:\/\/supjav\.com\/\d+\.html[^>]+/g);
  if (!list) return null;

  return list.map((item) => {
    const id = item.match(/supjav\.com\/(\d+)\.html/)?.[1] || "";
    const title = item.match(/title="([^"]+)"/)?.[1] || "";

    // thumbnail: coba beberapa atribut
    let thumb =
      item.match(/data-original="([^"]+)"/)?.[1] ||
      item.match(/data-src="([^"]+)"/)?.[1] ||
      item.match(/src="([^"]+)"/)?.[1] ||
      "";

    if (thumb.includes("!")) {
      thumb = thumb.split("!")[0];
    }

    return { id, title, thumb };
  });
}

async function fetchBody(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  return await res.text();
}

function makeServerList(arr) {
  const result = {};
  for (const item of arr) {
    const m = item.match(/data-link="([^"]+)">([^<]+)/);
    if (m) result[m[2]] = m[1];
  }
  return result;
}

export default { fetch: handler };
