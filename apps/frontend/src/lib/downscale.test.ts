import { describe, expect, it } from 'vitest';
import { fitWithin } from './downscale';

describe('fitWithin', () => {
  it('scales the long edge down, keeps aspect ratio, never upscales', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(5000, 10, 256)).toEqual({ width: 256, height: 1 });
  });
});
