import { describe, expect, it } from "vitest";
import { assertVideoAllowed, type VideoProbeInfo } from "../../src/utils/videoProcessor";

function probe(over: Partial<VideoProbeInfo> = {}): VideoProbeInfo {
  return {
    durationSec: 12,
    width: 1920,
    height: 1080,
    videoCodec: "h264",
    audioCodec: "aac",
    bitrate: 25_000_000,
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    ...over
  };
}

describe("assertVideoAllowed", () => {
  it("allows high-bitrate phone video when FFmpeg will transcode", () => {
    expect(() =>
      assertVideoAllowed(probe({ bitrate: 40_000_000, width: 3840, height: 2160 }), 18_000_000, {
        requireCompliantCodecs: false
      })
    ).not.toThrow();
  });

  it("rejects high bitrate when the original would be stored as-is", () => {
    expect(() =>
      assertVideoAllowed(probe({ bitrate: 40_000_000 }), 18_000_000, {
        requireCompliantCodecs: true
      })
    ).toThrow(/too high quality|bitrate/i);
  });

  it("still rejects oversize and over-duration before transcode", () => {
    expect(() =>
      assertVideoAllowed(probe({ durationSec: 90 }), 1_000_000, { requireCompliantCodecs: false })
    ).toThrow(/≤ 60 seconds/);
    expect(() =>
      assertVideoAllowed(probe(), 60 * 1024 * 1024, { requireCompliantCodecs: false })
    ).toThrow(/exceeds/);
  });
});
