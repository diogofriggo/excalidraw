import { pointFrom } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { vi } from "vitest";

vi.mock("perfect-freehand", () => ({
  getStroke: vi.fn(() => []),
}));

import { getStroke } from "perfect-freehand";

import { getFreedrawOutlinePoints, ShapeCache } from "../src/shape";

describe("freedraw stroke shape", () => {
  beforeEach(() => {
    vi.mocked(getStroke).mockClear();
    ShapeCache.destroy();
  });

  it("renders fixed strokes from the centerline path", () => {
    const element = API.createElement({
      type: "freedraw",
      strokeShape: "fixed",
      points: [pointFrom(0, 0), pointFrom(10, 10), pointFrom(20, 15)],
    });

    const shapes = ShapeCache.generateElementShape(element, null);

    expect(shapes).toEqual([expect.any(String)]);
    expect(shapes[0]).not.toContain("Z");
    expect(vi.mocked(getStroke)).not.toHaveBeenCalled();
  });

  it("rounds fixed stroke corners without flattening them", () => {
    const element = API.createElement({
      type: "freedraw",
      strokeShape: "fixed",
      strokeWidth: 1,
      points: [pointFrom(0, 0), pointFrom(10, 0), pointFrom(10, 10)],
    });

    const [path] = ShapeCache.generateElementShape(element, null);

    expect(path).toBe("M0,0 L8.5,0 Q10,0 10,1.5 L10,10 ");
  });

  it("does not round fixed stroke hairpin turns", () => {
    const element = API.createElement({
      type: "freedraw",
      strokeShape: "fixed",
      strokeWidth: 1,
      points: [pointFrom(0, 0), pointFrom(10, 0), pointFrom(9, 1)],
    });

    const [path] = ShapeCache.generateElementShape(element, null);

    expect(path).toBe("M0,0 L10,0 L9,1 ");
  });

  it("smooths dense fixed stroke points without dropping them", () => {
    const element = API.createElement({
      type: "freedraw",
      strokeShape: "fixed",
      points: [
        pointFrom(0, 0),
        pointFrom(0.3, 0.1),
        pointFrom(0.6, 0.35),
        pointFrom(1, 0.9),
      ],
    });

    const [path] = ShapeCache.generateElementShape(element, null);

    expect(path).toContain("Q0.3,0.1 ");
    expect(path).toContain("Q0.6,0.35 ");
  });

  it("drops synthetic loop closure for fixed strokes", () => {
    const element = API.createElement({
      type: "freedraw",
      strokeShape: "fixed",
      points: [pointFrom(0, 0), pointFrom(10, 0), pointFrom(0, 0)],
    });

    const [path] = ShapeCache.generateElementShape(element, null);

    expect(path).toBe("M0,0 L10,0 ");
  });

  it("uses fixed perfect-freehand settings for fixed strokes", () => {
    const element = API.createElement({
      type: "freedraw",
      strokeShape: "fixed",
      strokeWidth: 8,
      points: [pointFrom(0, 0), pointFrom(10, 10), pointFrom(20, 15)],
    });

    getFreedrawOutlinePoints(element);

    expect(vi.mocked(getStroke)).toHaveBeenCalledWith(
      element.points,
      expect.objectContaining({
        simulatePressure: false,
        size: element.strokeWidth,
        thinning: 0,
      }),
    );
  });

  it("keeps pressure-aware perfect-freehand settings for variable strokes", () => {
    const element = API.createElement({
      type: "freedraw",
      points: [pointFrom(0, 0), pointFrom(10, 10), pointFrom(20, 15)],
    });

    getFreedrawOutlinePoints({
      ...element,
      simulatePressure: false,
      pressures: [0.2, 0.8, 0.4],
    });

    expect(vi.mocked(getStroke)).toHaveBeenCalledWith(
      [
        [0, 0, 0.2],
        [10, 10, 0.8],
        [20, 15, 0.4],
      ],
      expect.objectContaining({
        simulatePressure: false,
        size: element.strokeWidth * 4.25,
        thinning: 0.6,
      }),
    );
  });
});
