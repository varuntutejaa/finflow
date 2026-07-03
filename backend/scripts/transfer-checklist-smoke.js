import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-transfer-check-"));
process.env.DATA_DIR = tempRoot;

const { createUser, listAccounts, transfer, listTransactions, upsertBudgets, listBudgets } = await import("../src/config/database.js");

function createDemoUser(label) {
  const token = randomUUID().slice(0, 8);
  return createUser({
    username: `${label}_${token}`,
    email: `${label}_${token}@example.test`,
    passwordHash: "hash",
    upiPinHash: "pin",
    name: label,
  });
}

const sender = createDemoUser("sender");
const receiver = createDemoUser("receiver");
const senderAccount = listAccounts(sender.id)[0];
const receiverAccount = listAccounts(receiver.id)[0];

const exactBalanceAmount = senderAccount.balance;
const exactBalanceTransfer = transfer({
  userId: sender.id,
  fromAccountId: senderAccount.id,
  toUsername: receiver.username,
  category: "other",
  amount: exactBalanceAmount,
  idempotencyKey: `exact_${randomUUID()}`,
});

assert.equal(exactBalanceTransfer.replayed, false);
assert.equal(exactBalanceTransfer.transaction.status, "completed");
assert.equal(listAccounts(sender.id)[0].balance, 0);
assert.equal(listAccounts(receiver.id)[0].balance, receiverAccount.balance + exactBalanceAmount);

const senderTwo = createDemoUser("sender_two");
const receiverTwo = createDemoUser("receiver_two");
const senderTwoAccount = listAccounts(senderTwo.id)[0];
const senderTwoOriginalBalance = senderTwoAccount.balance;

let insufficientFundsError = null;
try {
  transfer({
    userId: senderTwo.id,
    fromAccountId: senderTwoAccount.id,
    toUsername: receiverTwo.username,
    category: "bills",
    amount: senderTwoOriginalBalance + 1,
    idempotencyKey: `insufficient_${randomUUID()}`,
  });
} catch (err) {
  insufficientFundsError = err;
}

assert.ok(insufficientFundsError);
assert.equal(insufficientFundsError.code, "INSUFFICIENT_FUNDS");
assert.equal(listAccounts(senderTwo.id)[0].balance, senderTwoOriginalBalance);
assert.equal(insufficientFundsError.transaction.status, "failed");
assert.ok(listTransactions({ userId: senderTwo.id }).some((tx) => tx.id === insufficientFundsError.transaction.id));

const senderThree = createDemoUser("sender_three");
const receiverThree = createDemoUser("receiver_three");
const senderThreeAccount = listAccounts(senderThree.id)[0];
const receiverThreeAccount = listAccounts(receiverThree.id)[0];
const idempotencyKey = `idem_${randomUUID()}`;

const firstTransfer = transfer({
  userId: senderThree.id,
  fromAccountId: senderThreeAccount.id,
  toUsername: receiverThree.username,
  category: "shopping",
  amount: 1250,
  idempotencyKey,
});

const replayedTransfer = transfer({
  userId: senderThree.id,
  fromAccountId: senderThreeAccount.id,
  toUsername: receiverThree.username,
  category: "shopping",
  amount: 1250,
  idempotencyKey,
});

assert.equal(firstTransfer.replayed, false);
assert.equal(replayedTransfer.replayed, true);
assert.equal(firstTransfer.transaction.id, replayedTransfer.transaction.id);
assert.equal(listAccounts(senderThree.id)[0].balance, senderThreeAccount.balance - 1250);
assert.equal(listAccounts(receiverThree.id)[0].balance, receiverThreeAccount.balance + 1250);

let idempotencyConflictError = null;
try {
  transfer({
    userId: senderThree.id,
    fromAccountId: senderThreeAccount.id,
    toUsername: receiverThree.username,
    category: "food",
    amount: 1251,
    idempotencyKey,
  });
} catch (err) {
  idempotencyConflictError = err;
}

assert.ok(idempotencyConflictError);
assert.equal(idempotencyConflictError.code, "IDEMPOTENCY_KEY_REUSED");

let selfTransferError = null;
try {
  transfer({
    userId: senderThree.id,
    fromAccountId: senderThreeAccount.id,
    toUsername: senderThree.username,
    category: "other",
    amount: 100,
    idempotencyKey: `self_${randomUUID()}`,
  });
} catch (err) {
  selfTransferError = err;
}

assert.ok(selfTransferError);
assert.equal(selfTransferError.code, "SELF_TRANSFER_BLOCKED");

const senderThreeTransactions = listTransactions({ userId: senderThree.id });
assert.ok(senderThreeTransactions.some((tx) => tx.id === firstTransfer.transaction.id));
assert.equal(firstTransfer.transaction.category, "shopping");

const budgetRows = upsertBudgets(senderThree.id, [
  { category: "shopping", monthlyLimit: 5000, thresholdPercent: 70 },
  { category: "food", monthlyLimit: 10000, thresholdPercent: 80 },
]);

const shoppingBudget = budgetRows.find((budget) => budget.category === "shopping");
assert.ok(shoppingBudget);
assert.equal(shoppingBudget.spent, 1250);
assert.equal(shoppingBudget.status, "healthy");
assert.equal(listBudgets(senderThree.id).length >= 2, true);

console.log("transfer checklist smoke passed");
