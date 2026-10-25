import { describe, expect, it } from "bun:test";
import worker, {
  handleRequest,
  type Env,
  type R2BucketReader,
  type R2ObjectBodyLike,
} from "../src/index";

class MemoryBucket implements R2BucketReader {
  readonly objects = new Map<string, string>();
  readonly reads: string[] = [];

  async get(key: string): Promise<R2ObjectBodyLike | null> {
    this.reads.push(key);
    const value = this.objects.get(key);
    if (value === undefined) return null;
    const body = new Response(value).body;
    if (!body) throw new Error("Test stream was not created");
    return { body, size: new TextEncoder().encode(value).byteLength };
  }
}

function fixture(): { bucket: MemoryBucket; env: Env } {
  const bucket = new MemoryBucket();
  bucket.objects.set(
    "host-manifests/shop.example.test.json",
    JSON.stringify({ sitePrefix: "sites/landing-1/version-1/" }),
  );
  bucket.objects.set(
    "host-manifests/second.example.test.json",
    JSON.stringify({ sitePrefix: "sites/landing-2/version-3/" }),
  );
  bucket.objects.set("sites/landing-1/version-1/index.html", "<h1>Shop</h1>");
  bucket.objects.set("sites/landing-1/version-1/assets/site.css", "body{color:#123}");
  bucket.objects.set("sites/landing-2/version-3/index.html", "<h1>Second shop</h1>");
  return { bucket, env: { LANDING_BUCKET: bucket } };
}

describe("isolated Cloudflare R2 landing worker", () => {
  it("routes exact hostnames to their manifest and serves the root index", async () => {
    const { bucket, env } = fixture();
    const response = await worker.fetch(new Request("https://shop.example.test/"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("<h1>Shop</h1>");
    expect(bucket.reads).toEqual([
      "host-manifests/shop.example.test.json",
      "sites/landing-1/version-1/index.html",
    ]);
  });

  it("does not match an unknown hostname by suffix or wildcard", async () => {
    const { bucket, env } = fixture();
    const response = await handleRequest(new Request("https://not-shop.example.test/"), env);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(bucket.reads).toEqual(["host-manifests/not-shop.example.test.json"]);
  });

  it("serves multiple registered hostnames from separate site prefixes", async () => {
    const { env } = fixture();
    const first = await handleRequest(new Request("https://shop.example.test/"), env);
    const second = await handleRequest(new Request("https://second.example.test/"), env);

    expect(await first.text()).toBe("<h1>Shop</h1>");
    expect(await second.text()).toBe("<h1>Second shop</h1>");
  });

  it("serves a requested asset with a safe content type", async () => {
    const { env } = fixture();
    const response = await handleRequest(
      new Request("https://shop.example.test/assets/site.css?cache=1"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await response.text()).toBe("body{color:#123}");
  });

  it("rejects traversal and hidden paths before reading an asset", async () => {
    const { bucket, env } = fixture();
    const traversal = await handleRequest(
      new Request("https://shop.example.test/%2e%2e%2fprivate.txt"),
      env,
    );
    const hiddenFile = await handleRequest(new Request("https://shop.example.test/.env"), env);

    expect(traversal.status).toBe(400);
    expect(hiddenFile.status).toBe(400);
    expect(bucket.reads).toEqual([]);
  });

  it("rejects malformed encoding and encoded backslashes before storage access", async () => {
    const { bucket, env } = fixture();
    const malformed = await handleRequest(new Request("https://shop.example.test/%ZZ"), env);
    const backslash = await handleRequest(
      new Request("https://shop.example.test/%5c..%5cprivate.txt"),
      env,
    );

    expect(malformed.status).toBe(400);
    expect(backslash.status).toBe(400);
    expect(bucket.reads).toEqual([]);
  });

  it("rejects a manifest that attempts to escape the sites prefix", async () => {
    const { bucket, env } = fixture();
    bucket.objects.set(
      "host-manifests/shop.example.test.json",
      JSON.stringify({ sitePrefix: "sites/../private/" }),
    );

    const response = await handleRequest(new Request("https://shop.example.test/"), env);

    expect(response.status).toBe(404);
    expect(bucket.reads).toEqual(["host-manifests/shop.example.test.json"]);
  });

  it("supports HEAD and rejects write methods", async () => {
    const { env } = fixture();
    const head = await handleRequest(
      new Request("https://shop.example.test/", { method: "HEAD" }),
      env,
    );
    const post = await handleRequest(
      new Request("https://shop.example.test/", { method: "POST" }),
      env,
    );

    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("rejects public write methods without touching the R2 binding", async () => {
    const { bucket, env } = fixture();
    const responses = await Promise.all(
      ["POST", "PUT", "DELETE"].map((method) =>
        handleRequest(new Request("https://shop.example.test/", { method }), env),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([405, 405, 405]);
    expect(bucket.reads).toEqual([]);
  });

  it("returns 404 for a missing file without listing a directory", async () => {
    const { env } = fixture();
    const response = await handleRequest(new Request("https://shop.example.test/missing/"), env);

    expect(response.status).toBe(404);
  });
});
