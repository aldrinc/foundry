import type { LoginResult } from "@foundry/desktop/bindings"

export function createDemoLoginResult(): LoginResult {
  return {
    org_id: "demo-org-001",
    realm_name: "Foundry Demo",
    realm_icon: "",
    realm_url: "https://demo.foundry.invalid",
    zulip_feature_level: 500,
    // Keep uploads backend-driven; the desktop client should not invent a cap.
    max_file_upload_size_mib: null,
    realm_video_chat_provider: 1,
    realm_jitsi_server_url: "https://meet.jit.si",
    server_jitsi_server_url: "https://meet.jit.si",
    giphy_api_key: "",
    tenor_api_key: "",
    realm_gif_rating_policy: 2,
    queue_id: "demo-queue",
    user_id: 100,
    user_topics: [],
    unread_msgs: {
      count: 3,
      pms: [],
      streams: [
        { stream_id: 1, topic: "welcome", unread_message_ids: [1003, 1004, 1005] },
      ],
      huddles: [],
      mentions: [],
      old_unreads_missing: false,
    },
    recent_private_conversations: [
      { user_ids: [101], max_message_id: 2002 },
      { user_ids: [102, 103], max_message_id: 2004 },
    ],
    subscriptions: [
      { stream_id: 1, name: "general", color: "#76ce90", pin_to_top: true },
      { stream_id: 2, name: "engineering", color: "#fae589" },
      { stream_id: 3, name: "design", color: "#a6c5e2" },
      { stream_id: 4, name: "product", color: "#e4a5a5" },
      { stream_id: 5, name: "random", color: "#c2b0e2" },
      { stream_id: 6, name: "ops", color: "#e0ab76", is_muted: true },
    ],
    users: [
      { user_id: 100, email: "alice@foundry.dev", full_name: "Alice Chen", role: 200, is_active: true },
      { user_id: 101, email: "bob@foundry.dev", full_name: "Bob Martinez", role: 400, is_active: true },
      { user_id: 102, email: "carol@foundry.dev", full_name: "Carol Park", role: 400, is_active: true },
      { user_id: 103, email: "dave@foundry.dev", full_name: "Dave Wilson", role: 400, is_active: true },
    ],
  }
}
