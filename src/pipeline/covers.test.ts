import { describe, expect, it } from "vitest";
import {
  downloadCover,
  imageSize,
  storeCoverCandidates,
} from "@/pipeline/covers";
import {
  FakeHost,
  type FakeResponse,
  jpeg,
  pad,
  png,
} from "@/pipeline/test-host";

describe("downloadCover", () => {
  it("accepts a large JPEG and reports its size", async () => {
    const host = new FakeHost((url) => {
      if (url === "https://is1.example/1000x1000bb.jpg") {
        return { status: 200, contentType: "image/jpeg", body: jpeg() };
      }
      return null;
    });

    const cover = await downloadCover(
      host,
      { source: "itunes", url: "https://is1.example/1000x1000bb.jpg" },
      "/work/candidates",
    );

    expect(cover).toEqual({
      source: "itunes",
      path: "/work/candidates/itunes.jpg",
      width: 662,
      height: 1000,
    });
    expect(host.files.has("/work/candidates/itunes.jpg")).toBe(true);
    expect(host.files.has("/work/candidates/itunes.download")).toBe(false);
  });

  it("accepts a PNG and keeps the right extension", async () => {
    const host = new FakeHost(() => ({
      status: 200,
      contentType: "image/png",
      body: png(),
    }));

    const cover = await downloadCover(
      host,
      { source: "open_library", url: "https://covers.example/1-L.jpg" },
      "/work/candidates",
    );
    expect(cover?.path).toBe("/work/candidates/open_library.png");
    expect(cover?.width).toBe(800);
  });

  it("rejects a missing cover, a non-image, a tiny file, and a small image", async () => {
    const cases: Array<[string, FakeResponse]> = [
      ["404", { status: 404, contentType: "text/html" }],
      [
        "html",
        {
          status: 200,
          contentType: "text/html",
          body: pad(new Uint8Array([1])),
        },
      ],
      ["webp", { status: 200, contentType: "image/webp", body: jpeg() }],
      [
        "tiny",
        { status: 200, contentType: "image/jpeg", body: jpeg().slice(0, 100) },
      ],
      [
        "small",
        { status: 200, contentType: "image/jpeg", body: jpeg(150, 200) },
      ],
    ];

    for (const [name, response] of cases) {
      const host = new FakeHost(() => response);
      const cover = await downloadCover(
        host,
        { source: "itunes", url: `https://example/${name}` },
        "/work/candidates",
      );
      expect(cover, name).toBeNull();
    }
  });
});

describe("storeCoverCandidates", () => {
  it("copies covers into app data with unique names", async () => {
    const host = new FakeHost();
    host.files.set("/work/candidates/itunes.jpg", jpeg());
    host.files.set("/work/candidates/open_library.png", png());

    const stored = await storeCoverCandidates(host, "/home", "abcd1234", [
      {
        source: "itunes",
        path: "/work/candidates/itunes.jpg",
        width: 662,
        height: 1000,
      },
      {
        source: "open_library",
        path: "/work/candidates/open_library.png",
        width: 800,
        height: 1200,
      },
    ]);

    expect(stored[0].path).toMatch(
      /^candidates\/abcd1234\/itunes-[a-z0-9-]+\.jpg$/u,
    );
    expect(stored[1].path).toMatch(
      /^candidates\/abcd1234\/open_library-[a-z0-9-]+\.png$/u,
    );
    expect(host.files.has(`/home/${stored[0].path}`)).toBe(true);
    expect(host.files.has(`/home/${stored[1].path}`)).toBe(true);
  });

  it("does nothing for an empty download list", async () => {
    const host = new FakeHost();
    expect(await storeCoverCandidates(host, "/home", "abcd1234", [])).toEqual(
      [],
    );
    expect(host.dirs.size).toBe(0);
  });
});

describe("imageSize", () => {
  it("reads a JPEG", () => {
    expect(imageSize(jpeg(327, 500))).toEqual({ width: 327, height: 500 });
  });

  it("reads a PNG", () => {
    expect(imageSize(png(400, 600))).toEqual({ width: 400, height: 600 });
  });

  it("returns null for something that is not an image", () => {
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
