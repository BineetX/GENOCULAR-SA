import assert from "node:assert/strict";
import test from "node:test";

import {
  copyTextToClipboard,
  forgetJobAccessKey,
  getJobAccessKey,
  jobAccessFromInput,
  jobIdFromApiPath,
  privateJobPath,
  registerJobAccessKey,
} from "./jobAccess.js";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const ACCESS_KEY = `gja_${"a".repeat(43)}`;

test("keeps a valid access key in memory and builds a fragment link", () => {
  assert.equal(registerJobAccessKey(JOB_ID, ACCESS_KEY), true);
  assert.equal(getJobAccessKey(JOB_ID), ACCESS_KEY);
  assert.equal(
    privateJobPath(JOB_ID, ACCESS_KEY),
    `/run?job_id=${JOB_ID}#access=${ACCESS_KEY}`,
  );
  assert.equal(forgetJobAccessKey(JOB_ID), true);
  assert.equal(getJobAccessKey(JOB_ID), "");
});

test("only recognizes job-scoped API paths", () => {
  assert.equal(jobIdFromApiPath(`/jobs/${JOB_ID}/status`), JOB_ID);
  assert.equal(jobIdFromApiPath("/admin/jobs"), "");
  assert.equal(jobIdFromApiPath("/uploads/multipart/sign"), "");
  assert.equal(registerJobAccessKey(JOB_ID, "short"), false);
});

test("parses private URLs and JSON recovery documents", () => {
  const privateUrl = `https://genocular.example/run?job_id=${JOB_ID}#access=${ACCESS_KEY}`;
  assert.deepEqual(jobAccessFromInput(privateUrl), {
    jobId: JOB_ID,
    accessKey: ACCESS_KEY,
  });
  assert.deepEqual(jobAccessFromInput(JSON.stringify({
    format: "genocular-job-recovery",
    version: 1,
    job_id: JOB_ID,
    analysis_url: privateUrl.replace("/run?", "/analysis?"),
  })), {
    jobId: JOB_ID,
    accessKey: ACCESS_KEY,
  });
  assert.deepEqual(jobAccessFromInput({
    job_id: JOB_ID,
    access_key: ACCESS_KEY,
  }), {
    jobId: JOB_ID,
    accessKey: ACCESS_KEY,
  });
});

test("keeps legacy recovery text compatible and rejects incomplete references", () => {
  const privateUrl = `/run?job_id=${JOB_ID}#access=${ACCESS_KEY}`;
  assert.deepEqual(jobAccessFromInput(`GENOCULAR private job recovery\n\nPrivate link: ${privateUrl}`), {
    jobId: JOB_ID,
    accessKey: ACCESS_KEY,
  });
  assert.throws(() => jobAccessFromInput(`/run?job_id=${JOB_ID}`), /access key/i);
  assert.throws(() => jobAccessFromInput("{broken"), /JSON is not valid/i);
});

test("copies with the modern Clipboard API when it is available", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let copied = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (value) => { copied = value; } } },
  });
  try {
    assert.equal(await copyTextToClipboard("private-link"), true);
    assert.equal(copied, "private-link");
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }
});

test("falls back to selection-copy when the Clipboard API is unavailable", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let selectedValue = "";
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    focus() {},
    select() { selectedValue = this.value; },
    setSelectionRange() {},
    remove() {},
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body: { appendChild() {} },
      createElement: () => textarea,
      execCommand: (command) => command === "copy",
    },
  });
  try {
    assert.equal(await copyTextToClipboard("fallback-link"), true);
    assert.equal(selectedValue, "fallback-link");
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  }
});
