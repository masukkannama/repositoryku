export interface MediaItem {
  id: string;
  title: string;
  thumb: string;
  m3u8Url: string | null;
}

const BASE_URL = "https://supjav.com";

async function fetchList(url: string, page: number, count: number): Promise<any> {
  const res = await fetch(`${url}?page=${page}`);
  const text = await res.text();

  const regex = /<a href="\/video\/(\d+)".*?title="([^"]+)".*?<img[^>]+src="([^"]+)"/gs;
  const items: MediaItem[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    items.push({
      id: match[1],
      title: match[2],
      thumb: match[3],
      m3u8Url: null,
    });
  }

  const start = (page - 1) * count;
  const end = start + count;
  return {
    page,
    count,
    items: items.slice(start, end),
  };
}

async function fetchFullById(id: string): Promise<MediaItem> {
  const res = await fetch(`${BASE_URL}/video/${id}`);
  const text = await res.text();

  const titleMatch = text.match(/<title>(.*?)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(" - SupJAV.com", "") : "";

  const thumbMatch = text.match(/property="og:image" content="([^"]+)"/);
  const thumb = thumbMatch ? thumbMatch[1] : "";

  const m3u8Match =
    text.match(/https?:\/\/[^"]+\.m3u8/) ||
    text.match(/"file":"(https?:\/\/[^"]+\.m3u8)"/);

  const m3u8Url = m3u8Match ? m3u8Match[1] : null;

  return { id, title, thumb, m3u8Url };
}

async function fetchIds(ids: string[]): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  for (const id of ids) {
    try {
      const item = await fetchFullById(id);
      items.push(item);
      // delay kecil supaya tidak overload
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      console.error("Error fetch id", id, e);
    }
  }
  return items;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    const page = parseInt(url.searchParams.get("page") || "1");
    const count = parseInt(url.searchParams.get("count") || "10");

    try {
      // ✅ list endpoints
      if (parts[0] === "json" && parts[1] === "list") {
        if (parts[2] === "day") {
          return new Response(
            JSON.stringify(await fetchList(`${BASE_URL}/day`, page, count), null, 2),
            { headers: { "content-type": "application/json" } }
          );
        }
        if (parts[2] === "week") {
          return new Response(
            JSON.stringify(await fetchList(`${BASE_URL}/week`, page, count), null, 2),
            { headers: { "content-type": "application/json" } }
          );
        }
        if (parts[2] === "month") {
          return new Response(
            JSON.stringify(await fetchList(`${BASE_URL}/month`, page, count), null, 2),
            { headers: { "content-type": "application/json" } }
          );
        }
        if (parts[2] === "search") {
          const keyword = parts[3];
          return new Response(
            JSON.stringify(
              await fetchList(`${BASE_URL}/search/${keyword}`, page, count),
              null,
              2
            ),
            { headers: { "content-type": "application/json" } }
          );
        }
        if (parts[2].startsWith("category")) {
          const cat = parts[2].replace("category", "");
          return new Response(
            JSON.stringify(await fetchList(`${BASE_URL}/category/${cat}`, page, count), null, 2),
            { headers: { "content-type": "application/json" } }
          );
        }
        if (parts[2] === "tag") {
          const tag = parts[3];
          return new Response(
            JSON.stringify(await fetchList(`${BASE_URL}/tag/${tag}`, page, count), null, 2),
            { headers: { "content-type": "application/json" } }
          );
        }
        if (parts[2] === "cast") {
          const cast = parts[3];
          return new Response(
            JSON.stringify(await fetchList(`${BASE_URL}/cast/${cast}`, page, count), null, 2),
            { headers: { "content-type": "application/json" } }
          );
        }
        if (parts[2] === "maker") {
          const maker = parts[3];
          return new Response(
            JSON.stringify(await fetchList(`${BASE_URL}/maker/${maker}`, page, count), null, 2),
            { headers: { "content-type": "application/json" } }
          );
        }
      }

      // ✅ all endpoints
      if (parts[0] === "json" && parts[1] === "all") {
        // manual id list
        if (parts[2] && !parts[2].startsWith("range")) {
          const ids = parts[2].split("-").slice(0, count);
          const items = await fetchIds(ids);
          return new Response(JSON.stringify(items, null, 2), {
            headers: { "content-type": "application/json" },
          });
        }

        // range id
        if (parts[2] === "range" && parts[3]) {
          const [start, end] = parts[3].split("-").map((x) => parseInt(x, 10));
          let ids: string[] = [];
          for (let i = start; i <= end; i++) ids.push(String(i));
          ids = ids.slice(0, count);
          const items = await fetchIds(ids);
          return new Response(JSON.stringify(items, null, 2), {
            headers: { "content-type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        headers: { "content-type": "application/json" },
        status: 500,
      });
    }
  },
};
