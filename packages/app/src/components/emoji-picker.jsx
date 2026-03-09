import { createSignal, For, Show, createMemo } from "solid-js";
const EMOJI_CATEGORIES = [
    {
        id: "smileys",
        label: "Smileys",
        icon: "\ud83d\ude00",
        emoji: [
            { name: "grinning", code: "1f600", char: "\ud83d\ude00", keywords: ["happy", "smile"] },
            { name: "smiley", code: "1f603", char: "\ud83d\ude03", keywords: ["happy"] },
            { name: "smile", code: "1f604", char: "\ud83d\ude04", keywords: ["happy"] },
            { name: "grin", code: "1f601", char: "\ud83d\ude01" },
            { name: "laughing", code: "1f606", char: "\ud83d\ude06", keywords: ["happy", "lol"] },
            { name: "sweat_smile", code: "1f605", char: "\ud83d\ude05" },
            { name: "joy", code: "1f602", char: "\ud83d\ude02", keywords: ["lol", "laugh", "cry"] },
            { name: "rofl", code: "1f923", char: "\ud83e\udd23", keywords: ["laugh"] },
            { name: "wink", code: "1f609", char: "\ud83d\ude09" },
            { name: "blush", code: "1f60a", char: "\ud83d\ude0a" },
            { name: "innocent", code: "1f607", char: "\ud83d\ude07", keywords: ["angel"] },
            { name: "heart_eyes", code: "1f60d", char: "\ud83d\ude0d", keywords: ["love"] },
            { name: "kissing_heart", code: "1f618", char: "\ud83d\ude18" },
            { name: "yum", code: "1f60b", char: "\ud83d\ude0b" },
            { name: "stuck_out_tongue", code: "1f61b", char: "\ud83d\ude1b" },
            { name: "stuck_out_tongue_winking_eye", code: "1f61c", char: "\ud83d\ude1c" },
            { name: "sunglasses", code: "1f60e", char: "\ud83d\ude0e", keywords: ["cool"] },
            { name: "nerd_face", code: "1f913", char: "\ud83e\udd13" },
            { name: "thinking", code: "1f914", char: "\ud83e\udd14", keywords: ["hmm"] },
            { name: "face_with_raised_eyebrow", code: "1f928", char: "\ud83e\udd28" },
            { name: "neutral_face", code: "1f610", char: "\ud83d\ude10" },
            { name: "expressionless", code: "1f611", char: "\ud83d\ude11" },
            { name: "unamused", code: "1f612", char: "\ud83d\ude12" },
            { name: "rolling_eyes", code: "1f644", char: "\ud83d\ude44" },
            { name: "grimacing", code: "1f62c", char: "\ud83d\ude2c" },
            { name: "relieved", code: "1f60c", char: "\ud83d\ude0c" },
            { name: "pensive", code: "1f614", char: "\ud83d\ude14" },
            { name: "sleepy", code: "1f62a", char: "\ud83d\ude2a" },
            { name: "sleeping", code: "1f634", char: "\ud83d\ude34" },
            { name: "mask", code: "1f637", char: "\ud83d\ude37" },
            { name: "confused", code: "1f615", char: "\ud83d\ude15" },
            { name: "worried", code: "1f61f", char: "\ud83d\ude1f" },
            { name: "frowning", code: "1f626", char: "\ud83d\ude26" },
            { name: "disappointed", code: "1f61e", char: "\ud83d\ude1e", keywords: ["sad"] },
            { name: "cry", code: "1f622", char: "\ud83d\ude22", keywords: ["sad", "tear"] },
            { name: "sob", code: "1f62d", char: "\ud83d\ude2d", keywords: ["sad", "cry"] },
            { name: "angry", code: "1f620", char: "\ud83d\ude20", keywords: ["mad"] },
            { name: "rage", code: "1f621", char: "\ud83d\ude21", keywords: ["angry"] },
            { name: "exploding_head", code: "1f92f", char: "\ud83e\udd2f" },
            { name: "flushed", code: "1f633", char: "\ud83d\ude33" },
            { name: "scream", code: "1f631", char: "\ud83d\ude31" },
            { name: "fearful", code: "1f628", char: "\ud83d\ude28" },
            { name: "cold_sweat", code: "1f630", char: "\ud83d\ude30" },
            { name: "skull", code: "1f480", char: "\ud83d\udc80", keywords: ["dead"] },
            { name: "clown_face", code: "1f921", char: "\ud83e\udd21" },
            { name: "shushing_face", code: "1f92b", char: "\ud83e\udd2b", keywords: ["quiet"] },
            { name: "smirk", code: "1f60f", char: "\ud83d\ude0f" },
            { name: "pleading_face", code: "1f97a", char: "\ud83e\udd7a", keywords: ["please"] },
        ],
    },
    {
        id: "people",
        label: "People",
        icon: "\ud83d\udc4b",
        emoji: [
            { name: "wave", code: "1f44b", char: "\ud83d\udc4b", keywords: ["hi", "hello"] },
            { name: "+1", code: "1f44d", char: "\ud83d\udc4d", keywords: ["thumbsup", "yes", "approve"] },
            { name: "-1", code: "1f44e", char: "\ud83d\udc4e", keywords: ["thumbsdown", "no"] },
            { name: "ok_hand", code: "1f44c", char: "\ud83d\udc4c", keywords: ["perfect"] },
            { name: "clap", code: "1f44f", char: "\ud83d\udc4f", keywords: ["applause"] },
            { name: "raised_hands", code: "1f64c", char: "\ud83d\ude4c", keywords: ["celebrate"] },
            { name: "pray", code: "1f64f", char: "\ud83d\ude4f", keywords: ["thanks", "please"] },
            { name: "handshake", code: "1f91d", char: "\ud83e\udd1d", keywords: ["deal", "agree"] },
            { name: "point_up", code: "261d", char: "\u261d\ufe0f" },
            { name: "point_down", code: "1f447", char: "\ud83d\udc47" },
            { name: "point_left", code: "1f448", char: "\ud83d\udc48" },
            { name: "point_right", code: "1f449", char: "\ud83d\udc49" },
            { name: "muscle", code: "1f4aa", char: "\ud83d\udcaa", keywords: ["strong", "flex"] },
            { name: "v", code: "270c", char: "\u270c\ufe0f", keywords: ["peace"] },
            { name: "crossed_fingers", code: "1f91e", char: "\ud83e\udd1e", keywords: ["luck"] },
            { name: "writing_hand", code: "270d", char: "\u270d\ufe0f" },
            { name: "eyes", code: "1f440", char: "\ud83d\udc40", keywords: ["look", "see"] },
            { name: "brain", code: "1f9e0", char: "\ud83e\udde0", keywords: ["smart", "think"] },
            { name: "speaking_head", code: "1f5e3", char: "\ud83d\udde3\ufe0f" },
            { name: "saluting_face", code: "1fae1", char: "\ud83e\udee1" },
        ],
    },
    {
        id: "nature",
        label: "Nature",
        icon: "\ud83c\udf3f",
        emoji: [
            { name: "dog", code: "1f436", char: "\ud83d\udc36" },
            { name: "cat", code: "1f431", char: "\ud83d\udc31" },
            { name: "bear", code: "1f43b", char: "\ud83d\udc3b" },
            { name: "monkey_face", code: "1f435", char: "\ud83d\udc35" },
            { name: "see_no_evil", code: "1f648", char: "\ud83d\ude48" },
            { name: "hear_no_evil", code: "1f649", char: "\ud83d\ude49" },
            { name: "speak_no_evil", code: "1f64a", char: "\ud83d\ude4a" },
            { name: "bug", code: "1f41b", char: "\ud83d\udc1b" },
            { name: "butterfly", code: "1f98b", char: "\ud83e\udd8b" },
            { name: "turtle", code: "1f422", char: "\ud83d\udc22" },
            { name: "snake", code: "1f40d", char: "\ud83d\udc0d" },
            { name: "unicorn", code: "1f984", char: "\ud83e\udd84" },
            { name: "sunflower", code: "1f33b", char: "\ud83c\udf3b" },
            { name: "evergreen_tree", code: "1f332", char: "\ud83c\udf32" },
            { name: "fire", code: "1f525", char: "\ud83d\udd25", keywords: ["hot", "lit"] },
            { name: "droplet", code: "1f4a7", char: "\ud83d\udca7", keywords: ["water"] },
            { name: "rainbow", code: "1f308", char: "\ud83c\udf08" },
            { name: "snowflake", code: "2744", char: "\u2744\ufe0f", keywords: ["cold", "winter"] },
            { name: "sun", code: "2600", char: "\u2600\ufe0f" },
            { name: "cloud", code: "2601", char: "\u2601\ufe0f" },
        ],
    },
    {
        id: "food",
        label: "Food",
        icon: "\ud83c\udf54",
        emoji: [
            { name: "coffee", code: "2615", char: "\u2615", keywords: ["cafe", "morning"] },
            { name: "tea", code: "1f375", char: "\ud83c\udf75" },
            { name: "beer", code: "1f37a", char: "\ud83c\udf7a" },
            { name: "wine_glass", code: "1f377", char: "\ud83c\udf77" },
            { name: "pizza", code: "1f355", char: "\ud83c\udf55" },
            { name: "hamburger", code: "1f354", char: "\ud83c\udf54" },
            { name: "taco", code: "1f32e", char: "\ud83c\udf2e" },
            { name: "cake", code: "1f370", char: "\ud83c\udf70", keywords: ["birthday"] },
            { name: "cookie", code: "1f36a", char: "\ud83c\udf6a" },
            { name: "apple", code: "1f34e", char: "\ud83c\udf4e" },
            { name: "avocado", code: "1f951", char: "\ud83e\udd51" },
            { name: "popcorn", code: "1f37f", char: "\ud83c\udf7f" },
        ],
    },
    {
        id: "activities",
        label: "Activities",
        icon: "\ud83c\udfc6",
        emoji: [
            { name: "tada", code: "1f389", char: "\ud83c\udf89", keywords: ["party", "celebrate"] },
            { name: "trophy", code: "1f3c6", char: "\ud83c\udfc6", keywords: ["win", "award"] },
            { name: "medal", code: "1f3c5", char: "\ud83c\udfc5" },
            { name: "soccer", code: "26bd", char: "\u26bd" },
            { name: "basketball", code: "1f3c0", char: "\ud83c\udfc0" },
            { name: "football", code: "1f3c8", char: "\ud83c\udfc8" },
            { name: "tennis", code: "1f3be", char: "\ud83c\udfbe" },
            { name: "video_game", code: "1f3ae", char: "\ud83c\udfae", keywords: ["gaming"] },
            { name: "dart", code: "1f3af", char: "\ud83c\udfaf", keywords: ["target", "bullseye"] },
            { name: "musical_note", code: "1f3b5", char: "\ud83c\udfb5", keywords: ["music"] },
            { name: "headphones", code: "1f3a7", char: "\ud83c\udfa7" },
            { name: "art", code: "1f3a8", char: "\ud83c\udfa8", keywords: ["paint", "palette"] },
        ],
    },
    {
        id: "objects",
        label: "Objects",
        icon: "\ud83d\udca1",
        emoji: [
            { name: "bulb", code: "1f4a1", char: "\ud83d\udca1", keywords: ["idea", "light"] },
            { name: "rocket", code: "1f680", char: "\ud83d\ude80", keywords: ["launch", "ship"] },
            { name: "airplane", code: "2708", char: "\u2708\ufe0f", keywords: ["travel", "flight"] },
            { name: "gear", code: "2699", char: "\u2699\ufe0f", keywords: ["settings"] },
            { name: "wrench", code: "1f527", char: "\ud83d\udd27", keywords: ["tool", "fix"] },
            { name: "hammer", code: "1f528", char: "\ud83d\udd28", keywords: ["build"] },
            { name: "link", code: "1f517", char: "\ud83d\udd17", keywords: ["url", "chain"] },
            { name: "memo", code: "1f4dd", char: "\ud83d\udcdd", keywords: ["note", "write"] },
            { name: "book", code: "1f4d6", char: "\ud83d\udcd6", keywords: ["read"] },
            { name: "calendar", code: "1f4c5", char: "\ud83d\udcc5", keywords: ["date", "schedule"] },
            { name: "chart_with_upwards_trend", code: "1f4c8", char: "\ud83d\udcc8", keywords: ["graph", "growth"] },
            { name: "package", code: "1f4e6", char: "\ud83d\udce6", keywords: ["box", "ship"] },
            { name: "lock", code: "1f512", char: "\ud83d\udd12", keywords: ["security"] },
            { name: "key", code: "1f511", char: "\ud83d\udd11" },
            { name: "bell", code: "1f514", char: "\ud83d\udd14", keywords: ["notification"] },
            { name: "hourglass", code: "231b", char: "\u231b", keywords: ["time", "wait"] },
            { name: "alarm_clock", code: "23f0", char: "\u23f0", keywords: ["time", "wake"] },
            { name: "computer", code: "1f4bb", char: "\ud83d\udcbb", keywords: ["laptop", "code"] },
            { name: "desktop_computer", code: "1f5a5", char: "\ud83d\udda5\ufe0f" },
            { name: "mobile_phone", code: "1f4f1", char: "\ud83d\udcf1", keywords: ["phone"] },
        ],
    },
    {
        id: "symbols",
        label: "Symbols",
        icon: "\u2764\ufe0f",
        emoji: [
            { name: "heart", code: "2764", char: "\u2764\ufe0f", keywords: ["love", "red"] },
            { name: "orange_heart", code: "1f9e1", char: "\ud83e\udde1" },
            { name: "yellow_heart", code: "1f49b", char: "\ud83d\udc9b" },
            { name: "green_heart", code: "1f49a", char: "\ud83d\udc9a" },
            { name: "blue_heart", code: "1f499", char: "\ud83d\udc99" },
            { name: "purple_heart", code: "1f49c", char: "\ud83d\udc9c" },
            { name: "broken_heart", code: "1f494", char: "\ud83d\udc94" },
            { name: "100", code: "1f4af", char: "\ud83d\udcaf", keywords: ["perfect", "score"] },
            { name: "sparkles", code: "2728", char: "\u2728", keywords: ["magic", "new"] },
            { name: "star", code: "2b50", char: "\u2b50", keywords: ["favorite"] },
            { name: "zap", code: "26a1", char: "\u26a1", keywords: ["lightning", "power"] },
            { name: "check_mark", code: "2705", char: "\u2705", keywords: ["yes", "done"] },
            { name: "x", code: "274c", char: "\u274c", keywords: ["no", "wrong"] },
            { name: "warning", code: "26a0", char: "\u26a0\ufe0f", keywords: ["alert", "caution"] },
            { name: "question", code: "2753", char: "\u2753", keywords: ["ask"] },
            { name: "exclamation", code: "2757", char: "\u2757", keywords: ["important"] },
            { name: "bangbang", code: "203c", char: "\u203c\ufe0f" },
            { name: "interrobang", code: "2049", char: "\u2049\ufe0f" },
            { name: "heavy_plus_sign", code: "2795", char: "\u2795", keywords: ["add"] },
            { name: "heavy_minus_sign", code: "2796", char: "\u2796" },
            { name: "infinity", code: "267e", char: "\u267e\ufe0f" },
            { name: "recycle", code: "267b", char: "\u267b\ufe0f" },
        ],
    },
];
// All emoji flattened for search
const ALL_EMOJI = EMOJI_CATEGORIES.flatMap(c => c.emoji);
export function EmojiPicker(props) {
    const [search, setSearch] = createSignal("");
    const [activeCategory, setActiveCategory] = createSignal("smileys");
    const filtered = createMemo(() => {
        const q = search().toLowerCase();
        if (!q)
            return null; // Show categories when not searching
        return ALL_EMOJI.filter(e => e.name.includes(q) ||
            e.keywords?.some(k => k.includes(q)));
    });
    const currentCategory = () => EMOJI_CATEGORIES.find(c => c.id === activeCategory());
    return (<div class="w-[280px] bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-md overflow-hidden" data-component="emoji-picker">
      {/* Search */}
      <div class="p-2 border-b border-[var(--border-default)]">
        <input type="text" placeholder="Search emoji..." value={search()} onInput={(e) => setSearch(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Escape")
        props.onClose(); }} class="w-full px-2 py-1 text-xs rounded border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--interactive-primary)]" autofocus/>
      </div>

      {/* Quick reactions */}
      <Show when={!filtered() && props.quickReactions && props.quickReactions.length > 0}>
        <div class="px-2 pt-2 pb-1 border-b border-[var(--border-default)]">
          <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider px-1 mb-1">
            {props.quickReactionsLabel ?? "Quick reactions"}
          </div>
          <div class="grid grid-cols-4 gap-1">
            <For each={props.quickReactions}>
              {(emoji) => (<button onClick={() => props.onSelect(emoji.name, emoji.code)} class="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--background-base)] hover:bg-[var(--background-elevated)] transition-colors text-lg" title={`:${emoji.name}:`}>
                  {emoji.char}
                </button>)}
            </For>
          </div>
        </div>
      </Show>

      {/* Category tabs */}
      <Show when={!filtered()}>
        <div class="flex items-center px-1 py-1 border-b border-[var(--border-default)] gap-0.5 overflow-x-auto">
          <For each={EMOJI_CATEGORIES}>
            {(cat) => (<button class="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-sm transition-colors" classList={{
                "bg-[var(--interactive-primary)]/10": activeCategory() === cat.id,
                "hover:bg-[var(--background-elevated)]": activeCategory() !== cat.id,
            }} onClick={() => setActiveCategory(cat.id)} title={cat.label}>
                {cat.icon}
              </button>)}
          </For>
        </div>
      </Show>

      {/* Emoji grid */}
      <div class="max-h-[220px] overflow-y-auto">
        {/* Search results */}
        <Show when={filtered()}>
          {(results) => (<div class="p-2">
              <Show when={results().length === 0}>
                <div class="text-xs text-[var(--text-tertiary)] text-center py-4">No emoji found</div>
              </Show>
              <div class="grid grid-cols-8 gap-0.5">
                <For each={results()}>
                  {(emoji) => (<button onClick={() => props.onSelect(emoji.name, emoji.code)} class="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--background-elevated)] transition-colors text-base" title={`:${emoji.name}:`}>
                      {emoji.char}
                    </button>)}
                </For>
              </div>
            </div>)}
        </Show>

        {/* Category view */}
        <Show when={!filtered() && currentCategory()}>
          {(cat) => (<div class="p-2">
              <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider px-1 mb-1">
                {cat().label}
              </div>
              <div class="grid grid-cols-8 gap-0.5">
                <For each={cat().emoji}>
                  {(emoji) => (<button onClick={() => props.onSelect(emoji.name, emoji.code)} class="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--background-elevated)] transition-colors text-base" title={`:${emoji.name}:`}>
                      {emoji.char}
                    </button>)}
                </For>
              </div>
            </div>)}
        </Show>
      </div>
    </div>);
}
