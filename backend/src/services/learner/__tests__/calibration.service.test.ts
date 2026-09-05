import { computeCalibrationBias } from '../calibration.service';

describe('computeCalibrationBias', () => {
  it('样本不足时返回 accurate（无 FSRS 痕迹）', async () => {
    const bias = await computeCalibrationBias('no-such-user');
    expect(bias).toBe('accurate');
  });
});