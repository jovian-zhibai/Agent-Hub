import { describe, expect, it } from "vitest";
import type { Prisma } from "../../../generated/prisma/client";
import { enforceAgentBudget } from "../budget";

type Tx = Prisma.TransactionClient;

interface MockTx {
  auditLogCreates: Array<Record<string, unknown>>;
  agentUpdates: Array<Record<string, unknown>>;
}

function createMockTx(): MockTx & Tx {
  const state: MockTx = { auditLogCreates: [], agentUpdates: [] };

  const tx = {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogCreates.push(data);
        return data;
      },
    },
    agent: {
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.agentUpdates.push({ where, data });
        return data;
      },
    },
  };

  return Object.assign(tx, state) as unknown as MockTx & Tx;
}

const baseParams = {
  agentId: "agent-1",
  accountId: "account-1",
  triggeredAt: "2026-11-28T00:00:00.000Z",
};

describe("Budget enforcement", () => {
  it("does not touch the transaction when no monthly budget is set", async () => {
    const tx = createMockTx();

    const result = await enforceAgentBudget(tx, {
      ...baseParams,
      prevSpent: 1,
      eventCost: 1,
      monthlyBudget: null,
      wasEnabled: true,
    });

    expect(result).toEqual({ warned80: false, disabled: false, ratio: null });
    expect(tx.auditLogCreates).toHaveLength(0);
    expect(tx.agentUpdates).toHaveLength(0);
  });

  it("writes an audit log when the 80% warning threshold is crossed", async () => {
    const tx = createMockTx();

    const result = await enforceAgentBudget(tx, {
      ...baseParams,
      prevSpent: 79,
      eventCost: 3,
      monthlyBudget: 100,
      wasEnabled: true,
    });

    expect(result.warned80).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.ratio).toBeCloseTo(0.82, 9);
    expect(tx.auditLogCreates[0]?.action).toBe("budget_warning_80");
    expect(tx.agentUpdates).toHaveLength(0);
  });

  it("disables the agent and audits the crossing when 100% budget is reached", async () => {
    const tx = createMockTx();

    const result = await enforceAgentBudget(tx, {
      ...baseParams,
      prevSpent: 99,
      eventCost: 2,
      monthlyBudget: 100,
      wasEnabled: true,
    });

    expect(result.disabled).toBe(true);
    expect(
      tx.auditLogCreates.some((entry: Record<string, unknown>) => entry.action === "budget_exceeded_auto_disable"),
    ).toBe(true);
    expect(tx.agentUpdates[0]?.data).toMatchObject({
      enabled: false,
      status: "disabled",
      disabledReason: "budget_exceeded",
    });
  });

  it("does not disable an already disabled agent again", async () => {
    const tx = createMockTx();

    const result = await enforceAgentBudget(tx, {
      ...baseParams,
      prevSpent: 99,
      eventCost: 2,
      monthlyBudget: 100,
      wasEnabled: false,
    });

    expect(result.disabled).toBe(false);
    expect(tx.agentUpdates).toHaveLength(0);
  });
});
