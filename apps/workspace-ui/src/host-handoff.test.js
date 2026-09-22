import { describe, expect, it, vi } from "vitest";
import { copyHostHandoff } from "./host-handoff";

describe("host handoff", () => {
  it("copies only the visible request for every host", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue() };
    for (const hostId of ["antigravity", "claude-cowork", "chatgpt-work"]) {
      const handoff = await copyHostHandoff(hostId, "Review resume: Base resume using CareerCoach.", clipboard);
      expect(handoff.message).toBe("Review resume: Base resume using CareerCoach.");
    }
    expect(clipboard.writeText).toHaveBeenCalledTimes(3);
    expect(clipboard.writeText).not.toHaveBeenCalledWith(expect.stringContaining("context"));
  });

  it("fails visibly when clipboard access is unavailable", async () => {
    await expect(copyHostHandoff("antigravity", "Review job: Acme using CareerCoach.", null))
      .rejects.toThrow("Select and copy the visible request");
  });
});
