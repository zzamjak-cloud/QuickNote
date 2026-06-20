// 스케줄러 mutation 견고화 특성화 테스트 — 회귀 다발 구역이라 동작을 고정한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSchedulerMutation } from "../schedulerMutationResilience";

const reportNonFatalMock = vi.fn();
vi.mock("../../reportNonFatal", () => ({
  reportNonFatal: (...args: unknown[]) => reportNonFatalMock(...args),
}));

function networkError(): Error {
  return new Error("Failed to fetch");
}

function gqlError(message: string): { errors: Array<{ message: string }> } {
  return { errors: [{ message }] };
}

describe("runSchedulerMutation", () => {
  beforeEach(() => {
    reportNonFatalMock.mockClear();
  });

  it("성공 시 반환값을 그대로 전달하고 재시도·보고하지 않는다", async () => {
    const fn = vi.fn().mockResolvedValue({ id: "p1" });
    const result = await runSchedulerMutation(fn, { context: "test.success", retryable: true });
    expect(result).toEqual({ id: "p1" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(reportNonFatalMock).not.toHaveBeenCalled();
  });

  it("멱등 op 는 일시적 네트워크 오류 시 재시도 후 성공한다", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ id: "p1" });
    const result = await runSchedulerMutation(fn, {
      context: "test.retry",
      retryable: true,
      retryDelayMs: 0,
    });
    expect(result).toEqual({ id: "p1" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(reportNonFatalMock).not.toHaveBeenCalled();
  });

  it("재시도 한도(최초+2회) 소진 시 최종 실패를 보고하고 재던진다", async () => {
    const fn = vi.fn().mockRejectedValue(networkError());
    await expect(
      runSchedulerMutation(fn, { context: "test.exhaust", retryable: true, retryDelayMs: 0 }),
    ).rejects.toThrow("Failed to fetch");
    expect(fn).toHaveBeenCalledTimes(3); // 최초 1 + 재시도 2
    expect(reportNonFatalMock).toHaveBeenCalledTimes(1);
    expect(reportNonFatalMock).toHaveBeenCalledWith(expect.any(Error), "test.exhaust");
  });

  it("retryable=false(create 류) 는 일시적 오류여도 재시도하지 않고 즉시 보고·재던진다", async () => {
    const fn = vi.fn().mockRejectedValue(networkError());
    await expect(
      runSchedulerMutation(fn, { context: "test.create", retryable: false, retryDelayMs: 0 }),
    ).rejects.toThrow("Failed to fetch");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(reportNonFatalMock).toHaveBeenCalledTimes(1);
  });

  it("비일시적 오류(서버 검증 등)는 retryable 이어도 재시도하지 않고 보고·재던진다", async () => {
    const fn = vi.fn().mockRejectedValue(gqlError("Variable has an invalid value"));
    await expect(
      runSchedulerMutation(fn, { context: "test.validation", retryable: true, retryDelayMs: 0 }),
    ).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(reportNonFatalMock).toHaveBeenCalledTimes(1);
  });
});
