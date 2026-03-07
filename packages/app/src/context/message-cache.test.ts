import { describe, expect, test } from "bun:test";

import {
  ALL_MESSAGES_NARROW,
  cacheKeysForMessage,
  mergeMessagesById,
  primaryNarrowForMessage,
  STARRED_NARROW,
} from "./message-cache";

describe("message cache helpers", () => {
  test("merges by id and keeps the newest copy", () => {
    const existing = [
      {
        id: 10,
        type: "stream",
        subject: "deploy",
        stream_id: 5,
        display_recipient: "ops",
        flags: ["read"],
      },
      {
        id: 11,
        type: "stream",
        subject: "deploy",
        stream_id: 5,
        display_recipient: "ops",
        flags: [],
      },
    ];
    const incoming = [
      {
        id: 11,
        type: "stream",
        subject: "deploy",
        stream_id: 5,
        display_recipient: "ops",
        flags: ["read", "starred"],
      },
      {
        id: 12,
        type: "stream",
        subject: "deploy",
        stream_id: 5,
        display_recipient: "ops",
        flags: [],
      },
    ];

    expect(mergeMessagesById(existing, incoming)).toEqual([
      {
        id: 10,
        type: "stream",
        subject: "deploy",
        stream_id: 5,
        display_recipient: "ops",
        flags: ["read"],
      },
      {
        id: 11,
        type: "stream",
        subject: "deploy",
        stream_id: 5,
        display_recipient: "ops",
        flags: ["read", "starred"],
      },
      {
        id: 12,
        type: "stream",
        subject: "deploy",
        stream_id: 5,
        display_recipient: "ops",
        flags: [],
      },
    ]);
  });

  test("derives primary narrow for stream messages", () => {
    expect(
      primaryNarrowForMessage({
        id: 20,
        type: "stream",
        subject: "incident",
        stream_id: 8,
        display_recipient: "ops",
      }),
    ).toBe("stream:8/topic:incident");
  });

  test("derives primary narrow for dm messages", () => {
    expect(
      primaryNarrowForMessage({
        id: 21,
        type: "private",
        subject: "",
        stream_id: null,
        display_recipient: [{ id: 9 }, { id: 2 }],
      }),
    ).toBe("dm:2,9");
  });

  test("routes incoming messages into shared cache keys", () => {
    expect(
      cacheKeysForMessage({
        id: 22,
        type: "stream",
        subject: "project",
        stream_id: 3,
        display_recipient: "engineering",
        flags: ["read", "starred"],
      }),
    ).toEqual(["stream:3/topic:project", ALL_MESSAGES_NARROW, STARRED_NARROW]);
  });
});
